// Queue badge — 当 job.status === 'queued' 且 queue_position > 0 时显示。

export function registerQueueBadge() {
  window.Alpine.data('queueBadge', (queuePosition) => ({
    get visible() {
      return typeof queuePosition === 'number' && queuePosition > 0;
    },
    get ahead() {
      return Math.max(0, (queuePosition || 0) - 1);
    },
    get pos() {
      return queuePosition || 0;
    },
  }));
}