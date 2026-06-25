export type StatusFilterValue = 'all' | 'running' | 'paused' | 'done' | 'failed'

export type StatusFilterCounts = Record<StatusFilterValue, number>

const OPTIONS: { key: StatusFilterValue; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'paused', label: '待确认' },
  { key: 'done', label: '完成' },
  { key: 'failed', label: '失败' },
]

export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue
  onChange: (v: StatusFilterValue) => void
  counts: StatusFilterCounts
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {OPTIONS.map((o) => {
        const count = counts[o.key]
        const isFailedTab = o.key === 'failed'
        const isPausedTab = o.key === 'paused'
        const highlightIdle =
          (isFailedTab && count > 0 && value !== o.key) ||
          (isPausedTab && count > 0 && value !== o.key)

        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              value === o.key
                ? 'bg-gemini-600 text-white'
                : highlightIdle
                  ? isFailedTab
                    ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40'
                    : 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {o.label}
            {count > 0 ? ` (${count})` : ''}
          </button>
        )
      })}
    </div>
  )
}
