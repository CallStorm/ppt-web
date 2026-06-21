export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return '—'
  return `$${Number(usd).toFixed(3)}`
}

export function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function colorFromId(id: string | null | undefined): string {
  if (!id) return '#94a3b8'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue} 65% 55%)`
}

export function avatarLetter(name: string | null | undefined): string {
  if (!name) return '?'
  const s = String(name).trim()
  return s[s.length - 1] || '?'
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队',
  running: '运行中',
  paused: '待确认',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}
