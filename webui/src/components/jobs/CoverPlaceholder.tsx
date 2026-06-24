import { colorFromId, statusLabel } from '../../lib/format'
import type { JobStatus } from '../../api/types'

const ACTIVE: JobStatus[] = ['queued', 'running', 'paused']

/**
 * Non-blank cover for jobs without a rendered preview.
 * - queued/running/paused → generating state (pulse + spinner ring)
 * - failed/cancelled → muted failure mark
 * Background reuses the card's identity gradient (colorFromId) for consistency.
 */
export function CoverPlaceholder({ status, id }: { status: JobStatus | string; id: string }) {
  const color = colorFromId(id)
  const gradient = `linear-gradient(135deg, color-mix(in srgb, ${color} 15%, transparent), color-mix(in srgb, ${color} 6%, transparent))`
  const isActive = ACTIVE.includes(status as JobStatus)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ background: gradient }}>
      {isActive ? (
        <span className="h-7 w-7 rounded-full border-2 border-slate-400/60 border-t-transparent animate-spin" />
      ) : (
        <span className="text-2xl text-slate-400/70">⚠</span>
      )}
      <span className={`text-xs ${isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400/80'}`}>
        {isActive ? statusLabel(status) : '生成失败'}
      </span>
    </div>
  )
}
