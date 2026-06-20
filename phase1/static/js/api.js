// HTTP 客户端。封装 fetch：自动带 cookie、401 处理、统一错误。
// 所有视图都通过这个调后端，不直接 fetch。

let _onUnauthorized = null;

export function setOnUnauthorized(handler) {
  _onUnauthorized = handler;
}

/**
 * api(method, path, body?)
 *   - body: FormData | 普通对象 | undefined
 *   - 返回: parsed JSON / text / Response（如果是 SSE）
 *   - 抛出: Error with HTTP status and text
 */
export async function api(method, path, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    opt.body = body;
  } else if (body !== undefined && body !== null) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }

  const r = await fetch(path, opt);

  if (r.status === 401) {
    if (_onUnauthorized) _onUnauthorized();
    const text = await r.text().catch(() => '');
    throw new Error(`401: ${text}`);
  }

  if (!r.ok) {
    let text = '';
    try { text = await r.text(); } catch {}
    throw new Error(`${r.status}: ${text}`);
  }

  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return r.json();
  if (ct.includes('text/event-stream')) return r;
  return r.text();
}

/** 文件下载：用 <a download> 触发，不走 fetch */
export function downloadUrl(path, filename) {
  const a = document.createElement('a');
  a.href = path;
  if (filename) a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 直接 GET JSON 拿 SSE response stream（不通过 api() 因为它会试图 parse body） */
export async function openSse(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok || !r.body) {
    throw new Error(`SSE open failed: ${r.status}`);
  }
  return r.body.getReader();
}