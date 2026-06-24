import { VISUAL_STYLE_OPTIONS, VISUAL_STYLE_SWATCH } from '../../lib/jobOptions'
import type { JobVisualStyle } from '../../lib/jobOptions'

export function VisualStyleChips({
  value,
  onChange,
  coreTopic,
}: {
  value: JobVisualStyle
  onChange: (v: JobVisualStyle) => void
  coreTopic: string
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {VISUAL_STYLE_OPTIONS.map((opt) => {
        const selected = value === opt.value
        const sw = VISUAL_STYLE_SWATCH[opt.value]
        const isAuto = opt.value === 'auto'
        const showAutoChip = isAuto && selected && coreTopic.trim().length > 0
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value as JobVisualStyle)}
            className={`group relative flex flex-col items-stretch overflow-hidden rounded-md border text-left transition-all
                        hover:-translate-y-0.5 hover:shadow-md
                        ${selected
                          ? 'border-gemini-500 ring-1 ring-gemini-500'
                          : 'border-slate-200 dark:border-slate-700'}
                        bg-white/80 dark:bg-slate-900/60`}
          >
            <div className={`flex h-14 items-center justify-center ${sw.bg}`}>
              {sw.glyph}
            </div>
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{opt.label}</span>
                {selected && (
                  <span className="text-[10px] text-gemini-600">✓</span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                {opt.label.includes('·') ? opt.label.split('·')[1].trim() : ''}
              </p>
            </div>
            {showAutoChip && (
              <span className="absolute right-1 top-1 rounded-full bg-gemini-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
                AI 已自动选择
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
