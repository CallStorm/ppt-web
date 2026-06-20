// Toast / Modal helpers — 替换 alert() / confirm() 的统一出口。

export function showToast(message, kind = 'info', durationMs = 3500) {
  window.dispatchEvent(new CustomEvent('toast', {
    detail: { message, kind, durationMs },
  }));
}

export function confirmDialog({ title, body, confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const modal = window.Alpine.store('modal');
    modal.open({
      title, body, confirmText, cancelText,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export function notifySuccess(msg) { showToast(msg, 'success'); }
export function notifyError(msg)   { showToast(msg, 'error', 5000); }
export function notifyInfo(msg)    { showToast(msg, 'info'); }