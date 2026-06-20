// Hash-based router.
// 路由表（按 pattern 注册），匹配后返回 { view, params }。
// 监听 hashchange + 初始 load。view 名是字符串，main.js 决定渲染哪个 Alpine 组件。

const ROUTES = [
  { pattern: /^#?\/?$/,                              view: 'home' },
  { pattern: /^#?\/new$/,                            view: 'newJob' },
  { pattern: /^#?\/templates$/,                      view: 'templates' },
  { pattern: /^#?\/templates\/([a-zA-Z0-9_-]+)$/,    view: 'templateEditor', params: ['id'] },
  { pattern: /^#?\/jobs\/([a-zA-Z0-9-]+)$/,          view: 'jobDetail', params: ['id'] },
];

let _onChange = null;
let _currentView = null;
let _currentParams = {};

export function currentRoute() {
  return { view: _currentView, params: _currentParams };
}

export function onRouteChange(handler) {
  _onChange = handler;
}

export function navigate(path) {
  if (path.startsWith('#')) window.location.hash = path;
  else window.location.hash = '#' + path;
}

function _resolve() {
  const h = window.location.hash || '#/';
  for (const r of ROUTES) {
    const m = h.match(r.pattern);
    if (m) {
      const params = {};
      (r.params || []).forEach((name, i) => { params[name] = m[i + 1]; });
      _currentView = r.view;
      _currentParams = params;
      if (_onChange) _onChange({ view: r.view, params });
      return;
    }
  }
  // fallback
  _currentView = 'home';
  _currentParams = {};
  if (_onChange) _onChange({ view: 'home', params: {} });
}

export function startRouter() {
  window.addEventListener('hashchange', _resolve);
  _resolve();
}