import { colorFromId, statusLabel } from '../../lib/format'
import type { JobStatus } from '../../api/types'

const ACTIVE: JobStatus[] = ['queued', 'running', 'paused']

/**
 * Non-blank cover for jobs without a rendered preview.
 * - queued/running/paused → generating state (spinner)
 * - failed/cancelled → muted failure mark
 * - done/other (e.g. done job caught in a stale cache before has_preview lands) → neutral "loading" spinner
 * Background reuses the card's identity gradient (colorFromId) for consistency.
 */
export function CoverPlaceholder({ status, id }: { status: JobStatus | string; id: string }) {
  const color = colorFromId(id)
  const isActive = ACTIVE.includes(status as JobStatus)
  const isFailed = status === 'failed' || status === 'cancelled'

  const gradient = isFailed
    ? 'linear-gradient(135deg, rgb(254 242 242 / 0.9), rgb(248 250 252 / 0.95))'
    : `linear-gradient(135deg, color-mix(in srgb, ${color} 15%, transparent), color-mix(in srgb, ${color} 6%, transparent))`

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 ${
        isFailed ? 'dark:bg-gradient-to-br dark:from-rose-950/50 dark:to-slate-900/80' : ''
      }`}
      style={{ background: gradient }}
    >
      {isActive || !isFailed ? (
        <span className="h-7 w-7 rounded-full border-2 border-slate-400/60 border-t-transparent animate-spin" />
      ) : (
        <span className="text-2xl text-rose-400/80">⚠</span>
      )}
      <span
        className={`text-xs ${
          isFailed
            ? 'text-rose-500/90 dark:text-rose-400/80'
            : isActive
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-slate-400/80'
        }`}
      >
        {isActive ? statusLabel(status) : isFailed ? '生成失败' : '封面加载中'}
      </span>
    </div>
  )
}
