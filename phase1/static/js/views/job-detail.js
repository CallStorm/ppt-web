// Job detail view — Overview / Timeline / Files tabs + SSE + Resume 面板。
//
// 数据流：
//   1. boot(): 从 route.params.id 读 jobs.fetchOne → 拿到完整 job
//   2. subscribe SSE → 收到 event 更新本地 state + jobs store
//   3. 终态（done/failed/cancelled）时 SSE 自动 close（sse.js 检测）
//   4. destroy(): unsubscribe SSE（如果跳到别的 job）

import { api } from '../api.js';
import { subscribe } from '../sse.js';
import { fmtDateTime, fmtCost, truncate, fmtBytes } from '../format.js';
import { confirmDialog, notifySuccess, notifyError } from '../toast.js';

const TAB_OVERVIEW = 'overview';
const TAB_TIMELINE = 'timeline';
const TAB_FILES = 'files';

// Stage 可视化：与 core.py 的 STAGE_RULES 对齐（每个阶段显示为 segment）
const STAGES = [
  '1 解析素材',
  '2 建项目',
  '3 策略规划(八点确认)',
  '5 生图',
  '6 逐页生成 SVG',
  '7 质检',
  '8 后处理',
  '8 导出 PPTX',
];

export function renderJobDetail() {
  window.Alpine.data('jobDetailView', () => ({
    // ── state ──
    job: null,
    loading: true,
    error: '',
    tab: TAB_OVERVIEW,
    timeline: [],          // {type, payload, ts}
    stage: null,           // 当前 SSE stage event payload
    sseStatus: 'connecting',  // 'connecting' | 'connected' | 'error'
    confirmText: '',       // resume 表单
    submittingResume: false,
    _unsubSse: null,

    // ── lifecycle ──
    async init() {
      // route.params 在 jobDetailView 上访问需要绕一下：读 window.location.hash 解析
      const m = window.location.hash.match(/^#?\/jobs\/([a-zA-Z0-9-]+)$/);
      const id = m ? m[1] : null;
      if (!id) { this.error = '无效的 job id'; this.loading = false; return; }
      this.jobId = id;
      await this.load();
      this._subscribe();
    },

    destroy() {
      if (this._unsubSse) { this._unsubSse(); this._unsubSse = null; }
    },

    async load() {
      this.loading = true;
      this.error = '';
      try {
        const j = await api('GET', `/api/jobs/${this.jobId}`);
        this.job = j;
        window.Alpine.store('jobs').upsert(j);
      } catch (e) {
        this.error = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    _subscribe() {
      const lastSeq = this.job?.last_event_seq || 0;
      this._unsubSse = subscribe(this.jobId, lastSeq, (ev) => {
        this.sseStatus = 'connected';
        if (ev.type === 'status') {
          this._reload();  // 简单：拉最新 job 拿 status / session 等
          if (ev.payload.status === 'paused') {
            this.confirmText = ev.payload.pending_confirm || '';
          }
        } else if (ev.type === 'stage') {
          this.stage = ev.payload;
        } else if (['tool', 'agent_text', 'result', 'error', 'spec'].includes(ev.type)) {
          this.timeline.push({ ...ev, ts: new Date() });
          // cap timeline to 500 rows
          if (this.timeline.length > 500) this.timeline = this.timeline.slice(-500);
        } else if (ev.type === 'pptx') {
          this._reload();
        }
      });
    },

    async _reload() {
      try {
        const j = await api('GET', `/api/jobs/${this.jobId}`);
        this.job = j;
        window.Alpine.store('jobs').upsert(j);
      } catch {}
    },

    // ── tabs ──
    setTab(t) { this.tab = t; },

    // ── actions ──
    async doCancel() {
      const ok = await confirmDialog({
        title: '取消任务',
        body: '确认取消这个任务？取消后无法恢复。',
        confirmText: '确认取消',
        cancelText: '不取消',
      });
      if (!ok) return;
      try {
        await api('POST', `/api/jobs/${this.jobId}/cancel`);
        notifySuccess('已取消');
        await this._reload();
      } catch (e) {
        notifyError('取消失败: ' + e.message);
      }
    },

    async doResume() {
      if (!this.confirmText.trim()) {
        notifyError('请输入确认内容');
        return;
      }
      this.submittingResume = true;
      try {
        await api('POST', `/api/jobs/${this.jobId}/resume`, { confirm: this.confirmText });
        notifySuccess('已提交确认，任务继续');
        this.confirmText = '';
        await this._reload();
      } catch (e) {
        notifyError('提交失败: ' + e.message);
      } finally {
        this.submittingResume = false;
      }
    },

    doDownload() {
      if (!this.hasPptx) return;
      const a = document.createElement('a');
      a.href = `/api/jobs/${this.jobId}/pptx`;
      a.download = `${this.job?.project_name || this.jobId}.pptx`;
      a.click();
    },

    // ── getters ──
    get hasPptx() { return !!this.job?.pptx_path; },
    get status() { return this.job?.status || 'queued'; },
    get isPaused() { return this.status === 'paused'; },
    get isActive() { return ['running', 'queued', 'paused'].includes(this.status); },
    get shortPrompt() {
      const p = this.job?.prompt || '';
      return p.length > 200 ? p.slice(0, 200) + '…' : p;
    },
    get sseClass() {
      if (this.sseStatus === 'connected') return 'sse-dot connected';
      if (this.sseStatus === 'error') return 'sse-dot error';
      return 'sse-dot';
    },
    get currentStageIdx() {
      if (!this.stage) return -1;
      const name = this.stage.stage || this.stage.name;
      if (!name) return -1;
      return STAGES.findIndex(s => s === name || s.startsWith(name));
    },
    fmtCost, fmtDateTime, fmtBytes, truncate,
  }));
}