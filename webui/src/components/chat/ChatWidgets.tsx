import type { ChatDraft, ChatWidget } from '../../api/types'
import { RequirementFormCard } from './widgets/RequirementFormCard'
import { OutlineBoardCard } from './widgets/OutlineBoardCard'
import { StylePickerCard } from './widgets/StylePickerCard'
import { TemplateGalleryCard } from './widgets/TemplateGalleryCard'
import { PlanSummaryCard } from './widgets/PlanSummaryCard'
import { JobProgressCard } from './widgets/JobProgressCard'
import { DownloadCard } from './widgets/DownloadCard'

type Handlers = {
  onRequirementsSubmit: (req: ChatDraft['requirements']) => void
  onOutlineConfirm: (outline: ChatDraft['outline']) => void
  onStyleConfirm: (options: Record<string, unknown>) => void
  onTemplateSelect: (template: { kind: string; id: string } | null) => void
  onGenerate: () => void
  patchSubmitting?: boolean
  generating?: boolean
}

type Props = {
  draft: ChatDraft
  widgets: ChatWidget[]
  handlers: Handlers
}

export function ChatWidgets({ draft, widgets, handlers }: Props) {
  if (!widgets?.length) return null

  return (
    <div className="space-y-1">
      {widgets.map((w, i) => {
        switch (w.type) {
          case 'requirement_form':
            return (
              <RequirementFormCard
                key={i}
                draft={draft}
                onSubmit={handlers.onRequirementsSubmit}
                submitting={handlers.patchSubmitting}
              />
            )
          case 'outline_board':
            return (
              <OutlineBoardCard
                key={i}
                outline={draft.outline}
                editable={w.editable !== false}
                onConfirm={handlers.onOutlineConfirm}
                submitting={handlers.patchSubmitting}
              />
            )
          case 'style_picker':
            return (
              <StylePickerCard
                key={i}
                draft={draft}
                onConfirm={handlers.onStyleConfirm}
                submitting={handlers.patchSubmitting}
              />
            )
          case 'template_gallery':
            return (
              <TemplateGalleryCard key={i} draft={draft} onSelect={handlers.onTemplateSelect} />
            )
          case 'plan_summary':
            return (
              <PlanSummaryCard
                key={i}
                draft={draft}
                canGenerate={w.can_generate}
                onGenerate={handlers.onGenerate}
                generating={handlers.generating}
              />
            )
          case 'job_progress':
            return w.job_id ? <JobProgressCard key={i} jobId={w.job_id} /> : null
          case 'download':
            return w.job_id ? <DownloadCard key={i} jobId={w.job_id} /> : null
          default:
            return null
        }
      })}
    </div>
  )
}
