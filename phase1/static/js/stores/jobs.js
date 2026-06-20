// Jobs store — list cache, refresh, upsert (used by SSE-driven updates).
import { api } from '../api.js';

let _pollingHandle = null;

export function registerJobsStore(Alpine) {
  Alpine.store('jobs', {
    list: [],          // sorted by updated_at desc
    byId: {},          // job_id → job object
    loading: false,
    lastFetched: null,

    get running() { return this.list.filter(j => j.status === 'running' || j.status === 'queued'); },

    get hasAny() { return this.list.length > 0; },

    async refresh() {
      if (this.loading) return;
      this.loading = true;
      try {
        const data = await api('GET', '/api/jobs');
        const arr = data.jobs || [];
        this.list = arr;
        this.byId = Object.fromEntries(arr.map(j => [j.id, j]));
        this.lastFetched = Date.now();
      } catch (e) {
        console.warn('jobs.refresh failed:', e);
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(id) {
      try {
        const j = await api('GET', `/api/jobs/${id}`);
        this.upsert(j);
        return j;
      } catch (e) {
        console.warn('jobs.fetchOne failed:', e);
        return null;
      }
    },

    upsert(job) {
      if (!job || !job.id) return;
      this.byId[job.id] = job;
      const idx = this.list.findIndex(j => j.id === job.id);
      if (idx >= 0) this.list[idx] = job;
      else this.list.unshift(job);
      this._resort();
    },

    remove(id) {
      delete this.byId[id];
      this.list = this.list.filter(j => j.id !== id);
    },

    _resort() {
      this.list.sort((a, b) => {
        const ta = new Date(a.updated_at || 0).getTime();
        const tb = new Date(b.updated_at || 0).getTime();
        return tb - ta;
      });
    },

    startPolling(intervalMs = 15000) {
      this.stopPolling();
      _pollingHandle = setInterval(() => this.refresh(), intervalMs);
    },

    stopPolling() {
      if (_pollingHandle) {
        clearInterval(_pollingHandle);
        _pollingHandle = null;
      }
    },
  });
}