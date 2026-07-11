import { useMemo, useState } from 'react'
import type { TemplateCatalogEntry, TemplateKind } from '../../lib/jobOptions'
import { templatePreviewSlides, templatePreviewUrl } from '../../lib/templatePreview'
import { TemplatePreviewModal } from './TemplatePreviewModal'

type FilterKind = 'all' | TemplateKind

interface TemplateGalleryProps {
  templates: TemplateCatalogEntry[]
  selected: TemplateCatalogEntry | null
  onSelect: (entry: TemplateCatalogEntry) => void
  loading?: boolean
}

export function TemplateGallery({
  templates,
  selected,
  onSelect,
  loading = false,
}: TemplateGalleryProps) {
  const [filter, setFilter] = useState<FilterKind>('all')
  const [previewEntry, setPreviewEntry] = useState<TemplateCatalogEntry | null>(null)

  const filtered = useMemo(() => {
    if (filter === 'all') return templates
    return templates.filter((t) => t.kind === filter)
  }, [templates, filter])

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
          />
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    return <p className="text-sm text-slate-500">暂无可用模板</p>
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ['all', '全部'],
            ['deck', '品牌 Deck'],
            ['layout', '布局 Layout'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === value
                ? 'bg-gemini-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs text-slate-500">
        点击卡片选中模板；点击「预览版式」可浏览全部页面样式。输出会保持源 PPT 页数不变。
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {filtered.map((entry) => {
          const active =
            selected?.kind === entry.kind && selected?.id === entry.id
          const slideCount = templatePreviewSlides(entry).length
          const coverSvg =
            entry.cover_svg || entry.preview_slides[0] || null

          return (
            <div
              key={`${entry.kind}:${entry.id}`}
              className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
                active
                  ? 'border-gemini-500 ring-2 ring-gemini-400/40'
                  : 'border-slate-200 hover:border-gemini-300 dark:border-slate-700'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex flex-col text-left hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="relative aspect-video bg-slate-100 dark:bg-slate-900">
                  {coverSvg ? (
                    <img
                      src={templatePreviewUrl(entry, coverSvg)}
                      alt={entry.id}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      无预览
                    </div>
                  )}
                  {entry.primary_color && (
                    <span
                      className="absolute bottom-2 right-2 h-4 w-4 rounded-full border border-white/80 shadow"
                      style={{ backgroundColor: entry.primary_color }}
                      title={entry.primary_color}
                    />
                  )}
                  {active && (
                    <span className="absolute right-2 top-2 rounded-full bg-gemini-600 px-2 py-0.5 text-[10px] font-medium text-white">
                      已选
                    </span>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{entry.id}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800">
                      {entry.kind}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">{entry.summary || '—'}</p>
                  <p className="text-[10px] text-slate-400">
                    {entry.page_count} 种版式 · {entry.canvas_format}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPreviewEntry(entry)}
                className="border-t border-slate-100 px-3 py-2 text-[11px] text-gemini-600 hover:bg-slate-50 dark:border-slate-800 dark:text-gemini-400 dark:hover:bg-slate-800/50"
              >
                预览版式{slideCount > 0 ? ` · ${slideCount} 页` : ''}
              </button>
            </div>
          )
        })}
      </div>

      {previewEntry && (
        <TemplatePreviewModal
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}
