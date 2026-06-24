import type { JSX } from 'react'
import { IMAGE_STRATEGY_OPTIONS } from '../../lib/jobOptions'
import type { JobImageStrategy } from '../../lib/jobOptions'

const GLYPHS: Record<JobImageStrategy, JSX.Element> = {
  web: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  provided: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M21 11.5l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
    </svg>
  ),
  placeholder: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" opacity="0.5" />
      <rect x="3" y="13" width="8" height="8" opacity="0.5" />
      <rect x="13" y="13" width="8" height="8" />
    </svg>
  ),
  none: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <line x1="5" y1="5" x2="19" y2="19" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
    </svg>
  ),
}

const TAGLINES: Record<JobImageStrategy, string> = {
  web: '默认 / 速度快',
  provided: '仅用您的素材',
  placeholder: '纯色块 / 无图',
  none: '纯文字排版',
  ai: '需配置 key / 可能失败',
}

export function ImageStrategyCards({
  value,
  onChange,
}: {
  value: JobImageStrategy
  onChange: (v: JobImageStrategy) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {IMAGE_STRATEGY_OPTIONS.map((opt) => {
        const selected = value === opt.value
        return (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors
                        ${selected
                          ? 'border-gemini-500 bg-gemini-50 dark:bg-gemini-950'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}
          >
            <input
              type="radio"
              name="image_strategy"
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value as JobImageStrategy)}
              className="sr-only"
            />
            <span className="text-gemini-600">{GLYPHS[opt.value]}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">{opt.label}</div>
              <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {TAGLINES[opt.value]}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}
