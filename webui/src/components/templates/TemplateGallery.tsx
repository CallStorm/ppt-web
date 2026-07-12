import { useMemo, useState } from 'react'
import type { TemplateCatalogEntry, TemplateCategory, TemplateKind } from '../../lib/jobOptions'
import { SCOPE_LABELS, templatePreviewSlides, templatePreviewUrl } from '../../lib/templatePreview'
import { TemplatePreviewModal } from './TemplatePreviewModal'

type FilterKind = 'all' | TemplateKind

interface TemplateGalleryProps {
  templates: TemplateCatalogEntry[]
  categories?: TemplateCategory[]
  selected: TemplateCatalogEntry | null
  onSelect: (entry: TemplateCatalogEntry) => void
  onDelete?: (entry: TemplateCatalogEntry) => void
  deletingId?: string | null
  isAdmin?: boolean
  loading?: boolean
  showCategoryTabs?: boolean
  linkToLibrary?: boolean
}

export function TemplateGallery({
  templates,
  categories = [],
  selected,
  onSelect,
  onDelete,
  deletingId = null,
  isAdmin = false,
  loading = false,
  showCategoryTabs = true,
}: TemplateGalleryProps) {
  const [filter, setFilter] = useState<FilterKind>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [previewEntry, setPreviewEntry] = useState<TemplateCatalogEntry | null>(null)

  const filtered = useMemo(() => {
    let list = templates
    if (categoryFilter !== 'all') {
      list = list.filter((t) => t.category_id === categoryFilter)
    }
    if (filter !== 'all') {
      list = list.filter((t) => t.kind === filter)
    }
    return list
  }, [templates, filter, categoryFilter])

  const categoryTabs = useMemo(() => {
    const tabs = [{ id: 'all', name: '全部分类' }]
    const used = new Set(templates.map((t) => t.category_id).filter(Boolean))
    for (const c of categories) {
      if (c.id === 'all' || used.has(c.id)) tabs.push(c)
    }
    return tabs
  }, [categories, templates])

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

  const isSelected = (entry: TemplateCatalogEntry) =>
    selected?.scope === entry.scope &&
    selected?.kind === entry.kind &&
    selected?.id === entry.id

  return (
    <div>
      {showCategoryTabs && categoryTabs.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {categoryTabs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryFilter(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                categoryFilter === c.id
                  ? 'bg-gemini-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

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
          const active = isSelected(entry)
          const slideCount = templatePreviewSlides(entry).length
          const coverSvg = entry.cover_svg || entry.preview_slides[0] || null
          const label = entry.display_name || entry.id
          const scopeLabel = SCOPE_LABELS[entry.scope] || entry.scope
          const canDelete =
            !!entry.db_id &&
            !!onDelete &&
            (entry.scope === 'user' || (entry.scope === 'global' && isAdmin))
          const isDeleting = deletingId === entry.db_id

          return (
            <div
              key={`${entry.scope}:${entry.kind}:${entry.id}`}
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
                      alt={label}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      无预览
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
                    {scopeLabel}
                  </span>
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
                    <span className="truncate text-sm font-medium">{label}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800">
                      {entry.kind}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">{entry.summary || '—'}</p>
                  {entry.scope === 'user' && slideCount === 0 && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      模板文件不完整，可在「制作任务」中重新制作
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400">
                    {entry.page_count} 种版式 · {entry.canvas_format}
                  </p>
                </div>
              </button>
              <div className="flex border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPreviewEntry(entry)}
                  className="flex-1 px-3 py-2 text-[11px] text-gemini-600 hover:bg-slate-50 dark:text-gemini-400 dark:hover:bg-slate-800/50"
                >
                  预览版式{slideCount > 0 ? ` · ${slideCount} 页` : ''}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => onDelete(entry)}
                    className="border-l border-slate-100 px-3 py-2 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-slate-800 dark:hover:bg-rose-950/30"
                  >
                    {isDeleting ? '删除中…' : '删除'}
                  </button>
                )}
              </div>
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
