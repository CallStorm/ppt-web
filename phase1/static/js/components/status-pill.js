// Status pill — 单点真相：status 字符串 → CSS class（其它地方别再拼接）。

const STATUSES = ['queued', 'running', 'paused', 'done', 'failed', 'cancelled'];

const LABEL = {
  queued: '排队',
  running: '运行中',
  paused: '待确认',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
};

export function registerStatusPill() {
  window.Alpine.data('statusPill', (status) => ({
    status,
    get cls() {
      return STATUSES.includes(status) ? `status-${status}` : 'status-queued';
    },
    get label() {
      return LABEL[status] || status;
    },
  }));
}

export { STATUSES, LABEL };