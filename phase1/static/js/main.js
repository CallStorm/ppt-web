// 入口：注册 Alpine stores / data / 组件，启动路由 + 初始数据加载。
//
// Alpine CDN 是 defer 加载；ES module 也是 defer，但执行顺序不能假设 Alpine 已存在。
// 所有 Alpine.data/store 注册必须放到 `alpine:init` 事件里，否则会出现：
//   Cannot read properties of undefined (reading 'data')

import { registerThemeStore } from './stores/theme.js';
import { registerAuthStore } from './stores/auth.js';
import { registerJobsStore } from './stores/jobs.js';

import { startRouter, onRouteChange } from './router.js';
import { registerLayoutData } from './components/layout.js';
import { registerStatusPill } from './components/status-pill.js';
import { registerJobCard } from './components/job-card.js';
import { registerQueueBadge } from './components/queue-badge.js';
import { registerPromptEditor } from './components/prompt-editor.js';
import { registerVariableInput } from './components/variable-input.js';
import { registerFileDropzone } from './components/file-dropzone.js';

import { renderAuth } from './views/auth.js';
import { renderSidebar } from './views/sidebar.js';
import { renderNewJob } from './views/new-job.js';
import { renderJobDetail } from './views/job-detail.js';
import { renderTemplates } from './views/templates.js';
import { renderEmpty } from './views/empty.js';

import { extractVariables, highlightPrompt, MOCK_TEMPLATES, fillPrompt } from './mock-templates.js';

// 把模板 util 挂到 window，让 Alpine x-html / x-text 表达式能用。
window.extractVars = extractVariables;
window.highlightPrompt = highlightPrompt;
window.MOCK_TEMPLATES = MOCK_TEMPLATES;
window.fillPrompt = fillPrompt;

// ── Alpine registration ─────────────────────────────────────
document.addEventListener('alpine:init', () => {
  const Alpine = window.Alpine;

  // 1. 注册 stores
  registerThemeStore(Alpine);
  registerAuthStore(Alpine);
  registerJobsStore(Alpine);
  Alpine.store('modal', {
    open: false, title: '', body: '', confirmText: '确定', cancelText: '取消',
    _onConfirm: null, _onCancel: null,
    openWith(opts) {
      this.title = opts.title || '';
      this.body = opts.body || '';
      this.confirmText = opts.confirmText || '确定';
      this.cancelText = opts.cancelText || '取消';
      this._onConfirm = opts.onConfirm || null;
      this._onCancel = opts.onCancel || null;
      this.open = true;
    },
    confirm() { if (this._onConfirm) this._onConfirm(); this._close(); },
    close()  { if (this._onCancel) this._onCancel(); this._close(); },
    _close() { this.open = false; this._onConfirm = null; this._onCancel = null; },
  });

  // 2. 注册组件
  registerLayoutData();
  registerStatusPill();
  registerQueueBadge();
  registerJobCard();
  registerPromptEditor();
  registerVariableInput();
  registerFileDropzone();

  // 3. 注册视图
  renderAuth();
  renderSidebar();
  renderNewJob();
  renderJobDetail();
  renderTemplates();
  renderEmpty();

  // 4. App-level Alpine data
  Alpine.data('appShell', () => ({
    booted: false,
    route: { view: 'home', params: {} },
    sidebarOpen: false,

    async boot() {
      await Alpine.store('auth').refresh();

      onRouteChange((r) => {
        this.route = r;
        this.sidebarOpen = false;
      });
      startRouter();

      if (Alpine.store('auth').isAuthenticated()) {
        await Alpine.store('jobs').refresh();
        Alpine.store('jobs').startPolling();
      }

      this.booted = true;
    },
  }));
});