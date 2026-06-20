// Helper for sse.js — return Alpine store('jobs') lazily.
// 用 getter 避免 sse.js 在 import 时就触发 Alpine（时机问题）。

export function jobs() {
  return window.Alpine.store('jobs');
}