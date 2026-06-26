import type { GlobalRevisionKind } from '../../api/types'
import { GLOBAL_REVISION_KIND_OPTIONS } from '../../lib/jobOptions'

const KIND_HINTS: Record<GlobalRevisionKind, string> = {
  colors: '统一调整主色、背景、文字色',
  typography: '全文统一字体栈',
  visual_style: '整体换成另一种设计风格',
  content: '更简洁、更正式或翻译等',
  custom: '用自然语言描述任意全局变更',
}

export function GlobalEditTypeCards({
  value,
  onChange,
  disabledKinds,
}: {
  value: GlobalRevisionKind
  onChange: (k: GlobalRevisionKind) => void
  disabledKinds?: GlobalRevisionKind[]
}) {
  const disabled = new Set(disabledKinds ?? [])
  return (
    <div className="space-y-2">
      {GLOBAL_REVISION_KIND_OPTIONS.map((opt) => {
        const kind = opt.value
        const isDisabled = disabled.has(kind)
        const selected = value === kind
        return (
          <button
            key={kind}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(kind)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
              selected
                ? 'border-gemini-500 bg-gemini-50/50 ring-1 ring-gemini-500 dark:border-gemini-600 dark:bg-gemini-900/20'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            } ${isDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                selected
                  ? 'border-gemini-500 bg-gemini-500 text-white'
                  : 'border-slate-300 dark:border-slate-600'
              }`}
            >
              {selected && <span className="text-[10px]">✓</span>}
            </span>
            <span>
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {opt.label}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                {KIND_HINTS[kind]}
                {isDisabled && '（需要 spec_lock）'}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
