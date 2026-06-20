// Auth store — me, quota_credits, login/register/logout, refresh.
import { api, setOnUnauthorized } from '../api.js';

export function registerAuthStore(Alpine) {
  // Hook 401 → clear me + reload to auth view
  setOnUnauthorized(() => {
    Alpine.store('auth').me = null;
    window.location.hash = '';  // back to #/
  });

  Alpine.store('auth', {
    me: null,
    loading: false,

    isAuthenticated() { return !!this.me; },
    quota() { return this.me?.quota_credits ?? 0; },

    async refresh() {
      try {
        const me = await api('GET', '/api/auth/me');
        this.me = me;
      } catch {
        this.me = null;
      }
    },

    async login(email, password) {
      this.loading = true;
      try {
        const me = await api('POST', '/api/auth/login', { email, password });
        this.me = me;
        return true;
      } finally {
        this.loading = false;
      }
    },

    async register(email, password) {
      this.loading = true;
      try {
        const me = await api('POST', '/api/auth/register', { email, password });
        this.me = me;
        return true;
      } finally {
        this.loading = false;
      }
    },

    async logout() {
      try { await api('POST', '/api/auth/logout'); } catch {}
      this.me = null;
    },
  });
}