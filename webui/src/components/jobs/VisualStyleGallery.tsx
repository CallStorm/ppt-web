import { useState } from 'react'
import type { JobScenario, JobVisualStyle } from '../../lib/jobOptions'
import {
  catalogEntryFor,
  listGalleryStyleGroups,
  visualStylePreviewUrl,
  VISUAL_STYLE_CATALOG_MAP,
} from '../../lib/visualStyleCatalog'
import {
  autoStyleHint,
  isRecommendedStyle,
} from '../../lib/visualStyleRecommend'
import { StyleDetailSheet } from './StyleDetailSheet'
import { StylePreviewImage } from './StylePreviewImage'

function StyleCard({
  entry,
  selected,
  recommended,
  showAutoChip,
  onSelect,
  onDetail,
}: {
  entry: ReturnType<typeof catalogEntryFor>
  selected: boolean
  recommended: boolean
  showAutoChip: boolean
  onSelect: () => void
  onDetail: () => void
}) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all
        ${selected
          ? 'border-gemini-500 ring-1 ring-gemini-500'
          : 'border-slate-200 dark:border-slate-700'}
        bg-white/80 dark:bg-slate-900/60`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col items-stretch text-left hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
          <StylePreviewImage
            styleId={entry.id}
            kind="cover"
            className="h-full w-full object-cover"
            alt={entry.title}
          />
          {recommended && !selected && (
            <span className="absolute left-2 top-2 rounded-full bg-gemini-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
              推荐
            </span>
          )}
          {selected && (
            <span className="absolute right-2 top-2 rounded-full bg-gemini-600 px-2 py-0.5 text-[10px] font-medium text-white">
              已选
            </span>
          )}
        </div>
        <div className="px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {entry.title}
            </span>
            {selected && (
              <span className="text-xs text-gemini-600 dark:text-gemini-400">✓</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {entry.tagline}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {entry.bestFor.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onDetail}
        className="border-t border-slate-100 px-2.5 py-1.5 text-[11px] text-gemini-600 hover:bg-slate-50 dark:border-slate-800 dark:text-gemini-400 dark:hover:bg-slate-800/50"
      >
        查看示例幻灯片
      </button>
      {showAutoChip && (
        <span className="absolute right-2 top-2 rounded-full bg-violet-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
          AI 已自动选择
        </span>
      )}
    </div>
  )
}

export function VisualStyleGallery({
  value,
  onChange,
  coreTopic,
  scenario = 'general',
  showAuto = true,
}: {
  value: JobVisualStyle
  onChange: (v: JobVisualStyle) => void
  coreTopic: string
  scenario?: JobScenario
  showAuto?: boolean
}) {
  const [detailId, setDetailId] = useState<JobVisualStyle | null>(null)
  const groups = listGalleryStyleGroups(showAuto)
  const autoHints = value === 'auto' ? autoStyleHint(scenario, coreTopic) : []

  return (
    <>
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.entries.map((entry) => {
                const selected = value === entry.id
                const recommended = isRecommendedStyle(entry.id, scenario, coreTopic)
                const showAutoChip =
                  entry.id === 'auto' && selected && coreTopic.trim().length > 0

                return (
                  <StyleCard
                    key={entry.id}
                    entry={entry}
                    selected={selected}
                    recommended={recommended}
                    showAutoChip={showAutoChip}
                    onSelect={() => onChange(entry.id)}
                    onDetail={() => setDetailId(entry.id)}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {value === 'auto' && autoHints.length > 0 && coreTopic.trim() && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            根据你的主题，可能偏向：
            {autoHints.map((id) => (
              <span key={id} className="ml-2 inline-flex items-center gap-1">
                <img
                  src={`${visualStylePreviewUrl(id, 'cover')}`}
                  alt=""
                  className="h-6 w-10 rounded object-cover"
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {catalogEntryFor(id).title}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}

      {detailId && (
        <StyleDetailSheet styleId={detailId} onClose={() => setDetailId(null)} />
      )}
    </>
  )
}

/** @deprecated Use VisualStyleGallery — kept for import compatibility */
export function VisualStyleChips(props: {
  value: JobVisualStyle
  onChange: (v: JobVisualStyle) => void
  coreTopic: string
  scenario?: JobScenario
  showAuto?: boolean
}) {
  return <VisualStyleGallery {...props} />
}

export function VisualStyleSummaryThumb({
  styleId,
  className = 'h-10 w-[4.5rem] rounded object-cover',
}: {
  styleId: JobVisualStyle | null | undefined
  className?: string
}) {
  const id = styleId ?? 'auto'
  if (!VISUAL_STYLE_CATALOG_MAP[id as JobVisualStyle]) {
    return null
  }
  return (
    <StylePreviewImage
      styleId={id as JobVisualStyle}
      kind="cover"
      className={className}
      alt=""
    />
  )
}
