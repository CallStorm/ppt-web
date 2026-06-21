export const DEFAULT_TIMEZONE =
  import.meta.env.VITE_DISPLAY_TIMEZONE?.trim() || 'Asia/Shanghai'

let configuredTimezone = DEFAULT_TIMEZONE

export function setDisplayTimezone(tz: string) {
  if (tz.trim()) configuredTimezone = tz.trim()
}

export function getDisplayTimezone(): string {
  return configuredTimezone
}

/** Parse server ISO timestamps; naive values are treated as UTC. */
export function parseServerDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const s = String(iso).trim()
  if (!s) return null
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(s)
  const d = new Date(hasOffset ? s : `${s}Z`)
  return isNaN(d.getTime()) ? null : d
}

export function fmtTime(iso: string | null | undefined): string {
  const d = parseServerDate(iso)
  if (!d) return '—'
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: getDisplayTimezone(),
  })
}

export function fmtDateTime(iso: string | null | undefined): string {
  const d = parseServerDate(iso)
  if (!d) return '—'
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: getDisplayTimezone(),
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
