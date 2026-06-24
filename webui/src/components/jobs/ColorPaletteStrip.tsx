import {
  COLOR_PALETTE,
  COLOR_MODE_OPTIONS,
  INDUSTRY_OPTIONS,
  brandPalette,
} from '../../lib/jobOptions'
import type { JobColorMode, JobIndustry } from '../../lib/jobOptions'

const COLOR_MODE_LABELS: Record<JobColorMode, string> = {
  auto: 'auto',
  brand: '品牌色',
  industry: '行业预设',
}

const PILL_BTN =
  'rounded-full px-3 py-1 text-xs transition-colors border '

export function ColorPaletteStrip({
  value,
  onChange,
  brandHex,
  onBrandHexChange,
  industry,
  onIndustryChange,
}: {
  value: JobColorMode
  onChange: (v: JobColorMode) => void
  brandHex: string | null
  onBrandHexChange: (v: string | null) => void
  industry: JobIndustry | null
  onIndustryChange: (v: JobIndustry) => void
}) {
  // 决定当前展示的调色板
  let active: { swatches: string[]; label: string }
  if (value === 'brand') active = brandPalette(brandHex)
  else if (value === 'industry') active = COLOR_PALETTE[industry ?? 'technology']
  else active = COLOR_PALETTE.auto

  return (
    <div className="space-y-2">
      {/* pill 模式切换 */}
      <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
        {COLOR_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value as JobColorMode)
              // 切换模式时清掉不相关字段
              if (opt.value !== 'brand') onBrandHexChange(null)
              if (opt.value !== 'industry') onIndustryChange(industry as JobIndustry) // noop（仍保留）
            }}
            className={`${PILL_BTN} ${
              value === opt.value
                ? 'border-gemini-500 bg-gemini-600 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {COLOR_MODE_LABELS[opt.value]}
          </button>
        ))}
      </div>

      {/* 色谱带 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {active.swatches.map((c, i) => (
            <span
              key={i}
              className="inline-block h-5 w-5 rounded-full ring-1 ring-slate-700/30 dark:ring-slate-300/20"
              style={{ background: c }}
              aria-hidden
            />
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{active.label}</span>
      </div>

      {/* 品牌色输入 */}
      {value === 'brand' && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={brandHex ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim() || null
              onBrandHexChange(v)
            }}
            placeholder="#003366"
            className="w-32 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
          />
          <span className="text-xs text-slate-500">HEX 格式 #RRGGBB</span>
        </div>
      )}

      {/* 行业下拉（原生 select，无 per-row swatch 增强） */}
      {value === 'industry' && (
        <select
          value={industry ?? 'technology'}
          onChange={(e) => onIndustryChange(e.target.value as JobIndustry)}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
