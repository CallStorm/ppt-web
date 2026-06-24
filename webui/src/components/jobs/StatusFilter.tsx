export type StatusFilterValue = 'all' | 'running' | 'done' | 'failed'

const OPTIONS: { key: StatusFilterValue; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'done', label: '完成' },
  { key: 'failed', label: '失败' },
]

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue
  onChange: (v: StatusFilterValue) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1 text-xs transition-colors ${
            value === o.key
              ? 'bg-gemini-600 text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
