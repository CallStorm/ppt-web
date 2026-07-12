import { useQuery } from '@tanstack/react-query'
import { api } from '../../../api/client'
import type { ChatDraft } from '../../../api/types'
import type { TemplateCatalogEntry } from '../../../lib/jobOptions'
import { TemplateGallery } from '../../templates/TemplateGallery'

type Props = {
  draft: ChatDraft
  onSelect: (template: { kind: string; id: string } | null) => void
}

export function TemplateGalleryCard({ draft, onSelect }: Props) {
  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<{ templates: TemplateCatalogEntry[] }>('GET', '/api/templates'),
  })

  const templates = templatesQ.data?.templates ?? []
  const selected = draft.template
    ? templates.find((t) => t.kind === draft.template?.kind && t.id === draft.template?.id) ?? null
    : null

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">模板（可选）</h3>
      <p className="mt-1 text-xs text-slate-500">创建模式可跳过；选中后写入方案摘要</p>
      <div className="mt-3">
        <TemplateGallery
          templates={templates}
          selected={selected}
          onSelect={(entry) => onSelect({ kind: entry.kind, id: entry.id })}
          loading={templatesQ.isLoading}
        />
      </div>
      {selected && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="mt-2 text-xs text-slate-500 hover:text-slate-700"
        >
          清除模板选择
        </button>
      )}
    </div>
  )
}
