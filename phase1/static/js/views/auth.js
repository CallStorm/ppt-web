// Auth view — login / register 切换 tab。
// 整体是个独立 x-data，与全局 shell 解耦；登录成功直接 reload（让 main.js 重新 boot）。

import { notifyError, notifySuccess } from '../toast.js';

export function renderAuth() {
  window.Alpine.data('authView', () => ({
    mode: 'login',  // 'login' | 'register'
    email: '',
    password: '',
    submitting: false,
    error: '',

    setMode(m) {
      this.mode = m;
      this.error = '';
    },

    async submit() {
      this.error = '';
      if (!this.email || !this.password) {
        this.error = '请填写邮箱和密码';
        return;
      }
      this.submitting = true;
      try {
        const fn = this.mode === 'login'
          ? () => window.Alpine.store('auth').login(this.email, this.password)
          : () => window.Alpine.store('auth').register(this.email, this.password);
        await fn();
        notifySuccess(this.mode === 'login' ? '登录成功' : '注册成功');
        // Reload so main.js boots fresh with auth cookie set
        setTimeout(() => window.location.reload(), 200);
      } catch (e) {
        this.error = e.message || '操作失败';
        notifyError(this.error);
      } finally {
        this.submitting = false;
      }
    },
  }));
}