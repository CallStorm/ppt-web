// Empty view — 没选中 job 时显示的 placeholder，CTA 引导用户去新建。

export function renderEmpty() {
  window.Alpine.data('emptyView', () => ({
    go(hash) { window.location.hash = hash; },
  }));
}