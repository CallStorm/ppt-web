import { useMemo, useState } from 'react'
import type { TemplateCatalogEntry, TemplateKind } from '../../lib/jobOptions'

type FilterKind = 'all' | TemplateKind

function previewUrl(entry: TemplateCatalogEntry, page?: string | null): string {
  const svg = page || entry.cover_svg || entry.preview_slides[0] || '01_cover.svg'
  return `/api/templates/${entry.kind}/${encodeURIComponent(entry.id)}/preview/${encodeURIComponent(svg)}`
}

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
        模板页数是版式库（封面/目录/内容/结尾等），输出会保持源 PPT 页数不变，内容页版式可复用。
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {filtered.map((entry) => {
          const active =
            selected?.kind === entry.kind && selected?.id === entry.id
          return (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onSelect(entry)}
              className={`group overflow-hidden rounded-xl border text-left transition-all ${
                active
                  ? 'border-gemini-500 ring-2 ring-gemini-400/40'
                  : 'border-slate-200 hover:border-gemini-300 dark:border-slate-700'
              }`}
            >
              <div className="relative aspect-video bg-slate-100 dark:bg-slate-900">
                {entry.cover_svg || entry.preview_slides.length > 0 ? (
                  <img
                    src={previewUrl(entry)}
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
          )
        })}
      </div>
    </div>
  )
}
