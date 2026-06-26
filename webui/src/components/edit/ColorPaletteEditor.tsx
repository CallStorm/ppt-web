import { SPEC_COLOR_KEYS, SPEC_COLOR_LABELS } from '../../lib/jobOptions'

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

export function ColorPaletteEditor({
  currentColors,
  changes,
  onChange,
}: {
  currentColors: Record<string, string>
  changes: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className="space-y-3">
      {SPEC_COLOR_KEYS.map((key) => {
        const current = currentColors[key] ?? ''
        const newVal = changes[key] ?? current
        const showCurrent = current && current !== '#......'
        return (
          <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-20 shrink-0 text-slate-600 dark:text-slate-300">
              {SPEC_COLOR_LABELS[key] ?? key}
            </span>
            {showCurrent && (
              <span className="flex items-center gap-1 font-mono text-xs text-slate-500">
                <span
                  className="inline-block h-4 w-4 rounded border border-slate-300"
                  style={{ backgroundColor: current }}
                />
                {current}
              </span>
            )}
            <span className="text-slate-400">→</span>
            <input
              type="color"
              value={HEX_RE.test(newVal) ? newVal : '#000000'}
              onChange={(e) => onChange(key, e.target.value.toUpperCase())}
              className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5 dark:border-slate-600"
            />
            <input
              type="text"
              value={changes[key] ?? ''}
              placeholder={showCurrent ? current : '#RRGGBB'}
              onChange={(e) => {
                const v = e.target.value.trim()
                onChange(key, v)
              }}
              className="w-24 rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
              maxLength={7}
            />
          </div>
        )
      })}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        仅提交你改动的颜色；未改动的项不会提交。
      </p>
    </div>
  )
}

export function collectColorChanges(
  currentColors: Record<string, string>,
  draft: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(draft)) {
    const trimmed = val.trim()
    if (!trimmed || !HEX_RE.test(trimmed)) continue
    const cur = currentColors[key]
    if (cur && trimmed.toUpperCase() === cur.toUpperCase()) continue
    out[key] = trimmed.toUpperCase()
  }
  return out
}
