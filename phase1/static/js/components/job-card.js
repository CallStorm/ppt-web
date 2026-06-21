// Job card — 历史列表里的卡片。
// 核心用户诉求：不需要点进详情就能下载（按钮永远可见，有 pptx 时显示）。

import { fmtTime, fmtCost, truncate, colorFromId, avatarLetter } from '../format.js';
import { downloadUrl } from '../api.js';

export function registerJobCard() {
  window.Alpine.data('jobCard', (job) => ({
    job,

    get avatarColor() { return colorFromId(job?.id); },
    get avatarLetter() { return avatarLetter(job?.project_name || job?.id); },
    get time() { return fmtTime(job?.updated_at); },
    get cost() { return fmtCost(job?.cost_usd); },
    get preview() { return truncate(job?.prompt || '', 80); },
    get hasPptx() { return !!job?.pptx_path; },
    get isSelected() { return this.$root?.route?.params?.id === job?.id; },
    get statusClass() { return `status-${job?.status || 'queued'}`; },
    get statusLabel() {
      return ({
        queued: '排队',
        running: '运行中',
        paused: '待确认',
        done: '完成',
        failed: '失败',
        cancelled: '已取消',
      })[job?.status] || job?.status || '排队';
    },

    navigate() {
      window.location.hash = `#/jobs/${job.id}`;
    },

    /** 卡片内下载 — 不冒泡到 navigate */
    download(ev) {
      ev.stopPropagation();
      if (!this.hasPptx) return;
      const filename = `${job.project_name || job.id}.pptx`;
      downloadUrl(`/api/jobs/${job.id}/pptx`, filename);
    },

    cancel(ev) {
      ev.stopPropagation();
      // delegate to modal — TODO M3
      if (confirm('确认取消这个任务？')) {
        // Will be wired in M3 (modal store)
      }
    },
  }));
}