// 格式化工具函数。统一时间/费用/截断/转义。

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diff = (now - d) / 1000;  // seconds
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtCost(usd) {
  if (usd == null) return '—';
  return `$${Number(usd).toFixed(3)}`;
}

export function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function truncate(s, n = 60) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 给定日期返回分组 key: today / yesterday / this_week / earlier */
export function dateGroup(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'earlier';
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dDiff = (startOfDay(now) - startOfDay(d)) / 86400000;
  if (dDiff <= 0) return 'today';
  if (dDiff === 1) return 'yesterday';
  if (dDiff < 7) return 'this_week';
  return 'earlier';
}

export const DATE_GROUP_LABELS = {
  today: '今天',
  yesterday: '昨天',
  this_week: '本周',
  earlier: '更早',
};

export const DATE_GROUP_ORDER = ['today', 'yesterday', 'this_week', 'earlier'];

/** 给 id 生成稳定的颜色（基于 hash） */
export function colorFromId(id) {
  if (!id) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 65% 55%)`;
}

/** job 名首字母（中文取最后 1 字符） */
export function avatarLetter(name) {
  if (!name) return '?';
  const s = String(name).trim();
  return s[s.length - 1] || '?';
}