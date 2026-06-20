// SSE 管理器。订阅 job 的事件流，自动重连，typed event 分发。
//
// 设计：
//   - subscribe(jobId, lastSeq, onEvent) → 返回 unsubscribe()
//   - 重连：指数退避 1s → 2s → 5s → 10s → 30s（max）
//   - 终态（done/failed/cancelled）后停止重连
//   - 多个订阅同一 jobId 共用一个 EventSource（共享）
//   - 收到 status 事件自动 upsert 到 jobs store

import { jobs } from './stores/jobs-bridge.js';  // 见下

const _sources = new Map();      // jobId → { es, retry, subscribers: Set }
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

function _isTerminal(status) {
  return TERMINAL.has(status);
}

function _backoff(attempt) {
  return Math.min(30000, [1000, 2000, 5000, 10000, 30000][attempt] || 30000);
}

function _ensureSource(jobId, lastSeq) {
  let entry = _sources.get(jobId);
  if (entry && entry.es && entry.es.readyState !== EventSource.CLOSED) return entry;

  const url = `/api/jobs/${jobId}/events?from_seq=${lastSeq || 0}`;
  const es = new EventSource(url);
  entry = { es, retry: 0, subscribers: new Set(), lastSeq: lastSeq || 0 };
  _sources.set(jobId, entry);

  const handle = (type) => (e) => {
    let payload;
    try { payload = JSON.parse(e.data); } catch { payload = {}; }
    const seq = parseInt(e.lastEventId, 10) || 0;
    if (seq && seq <= entry.lastSeq) return;
    if (seq) entry.lastSeq = seq;

    // 自动 upsert 到 jobs store（status / result / pptx / agent_text）
    if (type === 'status') {
      const cur = jobs().byId[jobId];
      if (cur) jobs().upsert({ ...cur, status: payload.status, updated_at: new Date().toISOString() });
      // 终态后停止重连
      if (_isTerminal(payload.status)) {
        // 立即关 es
        setTimeout(() => { try { es.close(); } catch {} }, 100);
      }
    } else if (type === 'pptx') {
      const cur = jobs().byId[jobId];
      if (cur && payload.url) jobs().upsert({ ...cur, pptx_path: payload.url, status: 'done' });
    } else if (type === 'result' && payload.cost_usd != null) {
      const cur = jobs().byId[jobId];
      if (cur) jobs().upsert({ ...cur, cost_usd: payload.cost_usd });
    } else if (type === 'agent_text' && payload.text) {
      const cur = jobs().byId[jobId];
      if (cur) {
        const new_text = payload.text;
        if (!cur.last_agent_text || new_text.length >= (cur.last_agent_text || '').length) {
          jobs().upsert({ ...cur, last_agent_text: new_text });
        }
      }
    }

    // 通知所有订阅者
    for (const cb of entry.subscribers) {
      try { cb({ type, payload, seq }); } catch (e) { console.warn('sse subscriber error', e); }
    }
  };

  ['status', 'stage', 'tool', 'agent_text', 'result', 'spec', 'error', 'pptx']
    .forEach(t => es.addEventListener(t, handle(t)));

  es.onerror = () => {
    // EventSource 自动重试；我们额外跟踪 + 必要时手动重连（如果 closed）
    if (es.readyState === EventSource.CLOSED) {
      const cur = jobs().byId[jobId];
      if (cur && _isTerminal(cur.status)) return;  // 终态不重连
      entry.retry += 1;
      const delay = _backoff(entry.retry - 1);
      setTimeout(() => {
        // 重建
        _sources.delete(jobId);
        const fresh = _ensureSource(jobId, entry.lastSeq);
        // 把现有 subscribers 转移
        for (const cb of entry.subscribers) fresh.subscribers.add(cb);
      }, delay);
    }
  };

  return entry;
}

export function subscribe(jobId, lastSeq, onEvent) {
  const entry = _ensureSource(jobId, lastSeq);
  entry.subscribers.add(onEvent);
  let unsubscribed = false;
  return function unsubscribe() {
    if (unsubscribed) return;
    unsubscribed = true;
    entry.subscribers.delete(onEvent);
    // 如果没人订阅了，关掉 EventSource
    if (entry.subscribers.size === 0) {
      try { entry.es.close(); } catch {}
      _sources.delete(jobId);
    }
  };
}

export function closeAll() {
  for (const { es } of _sources.values()) {
    try { es.close(); } catch {}
  }
  _sources.clear();
}