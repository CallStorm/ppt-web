import type { EditTargetSlide, SpecSummary } from '../../api/types'
import { optionLabel, VISUAL_STYLE_OPTIONS } from '../../lib/jobOptions'

export function DeckContextSidebar({
  slides,
  specSummary,
}: {
  slides: EditTargetSlide[]
  specSummary: SpecSummary | null
}) {
  const styleLabel = specSummary?.visual_style
    ? optionLabel(specSummary.visual_style) ||
      VISUAL_STYLE_OPTIONS.find((o) => o.value === specSummary.visual_style)?.label ||
      specSummary.visual_style
    : null

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/30">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          当前 deck 预览
        </h3>
        <p className="mt-1 text-xs text-slate-500">共 {slides.length} 页</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {slides.map((sl) => (
            <div
              key={sl.index}
              className="shrink-0 overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900"
            >
              <img
                src={sl.image_url}
                alt={`第 ${sl.index} 页`}
                className="h-16 w-28 object-contain"
                loading="lazy"
              />
              <div className="px-1 py-0.5 text-center text-[10px] text-slate-500">
                {sl.index}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          当前风格摘要
        </h3>
        {!specSummary ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            无 spec_lock.md（仅支持自定义全局指令）
          </p>
        ) : (
          <dl className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {styleLabel && (
              <div className="flex gap-2">
                <dt className="text-slate-400">风格</dt>
                <dd>{styleLabel}</dd>
              </div>
            )}
            {specSummary.colors.primary && (
              <div className="flex items-center gap-2">
                <dt className="text-slate-400">主色</dt>
                <dd className="flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded border border-slate-300"
                    style={{ backgroundColor: specSummary.colors.primary }}
                  />
                  {specSummary.colors.primary}
                </dd>
              </div>
            )}
            {specSummary.colors.bg && (
              <div className="flex items-center gap-2">
                <dt className="text-slate-400">背景</dt>
                <dd className="flex items-center gap-1">
                  <span
                    className="inline-block h-3 w-3 rounded border border-slate-300"
                    style={{ backgroundColor: specSummary.colors.bg }}
                  />
                  {specSummary.colors.bg}
                </dd>
              </div>
            )}
            {specSummary.typography.font_family && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-slate-400">字体</dt>
                <dd className="truncate">{specSummary.typography.font_family}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </aside>
  )
}
