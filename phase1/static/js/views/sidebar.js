// Sidebar view — Gemini 风格：搜索框 + 过滤 chips + 按日期分组的 job 列表。
//
// 数据来自 Alpine.store('jobs')；列表按 updated_at 倒序，按 dateGroup 分组。
// 搜索框 200ms debounce；过滤 chip 影响 jobs.filtered。

import { fmtTime, dateGroup, DATE_GROUP_LABELS, DATE_GROUP_ORDER } from '../format.js';

export function renderSidebar() {
  window.Alpine.data('sidebar', () => ({
    query: '',
    filter: 'all',  // 'all' | 'running' | 'done' | 'failed'
    _debounce: null,

    setFilter(f) { this.filter = f; },

    onQueryInput() {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => { this._debounce = null; }, 200);
    },

    get filtered() {
      const q = (this.query || '').trim().toLowerCase();
      return window.Alpine.store('jobs').list.filter(j => {
        if (this.filter === 'running' && !['running', 'queued'].includes(j.status)) return false;
        if (this.filter === 'done' && j.status !== 'done') return false;
        if (this.filter === 'failed' && !['failed', 'cancelled'].includes(j.status)) return false;
        if (!q) return true;
        return (j.project_name || '').toLowerCase().includes(q)
            || (j.prompt || '').toLowerCase().includes(q);
      });
    },

    get groups() {
      const f = this.filtered;
      const map = new Map(DATE_GROUP_ORDER.map(g => [g, []]));
      for (const j of f) {
        const g = dateGroup(j.updated_at);
        if (map.has(g)) map.get(g).push(j);
      }
      // drop empty groups
      return DATE_GROUP_ORDER
        .filter(g => map.get(g).length > 0)
        .map(g => ({ key: g, label: DATE_GROUP_LABELS[g], items: map.get(g) }));
    },

    get totalCount() { return window.Alpine.store('jobs').list.length; },
    get filteredCount() { return this.filtered.length; },
  }));
}