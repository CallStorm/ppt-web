import type { ChatDraft, ChatWidget, ConversationPhase } from '../api/types'

export function isDraftReady(draft: ChatDraft): boolean {
  const pc = draft.phase_completed
  if (!pc.requirements || !pc.outline || !pc.style) return false
  if (!draft.core_topic?.trim()) return false
  if (!draft.outline?.length) return false
  const pageCount = draft.options?.page_count
  if (!pageCount) return false
  return true
}

/** 按当前 phase 返回应展示的唯一 widget 集合（不从历史消息回放）。 */
export function widgetsForPhase(
  phase: ConversationPhase,
  draft: ChatDraft,
  jobId?: string | null,
): ChatWidget[] {
  const widgets: ChatWidget[] = []

  if (phase === 'requirements') {
    widgets.push({ type: 'requirement_form' })
  }

  if (phase === 'outline' && draft.outline?.length) {
    widgets.push({ type: 'outline_board', editable: true })
  }

  if (phase === 'style') {
    widgets.push({ type: 'style_picker' })
    if (isDraftReady(draft)) {
      widgets.push({ type: 'plan_summary', can_generate: true })
    }
  }

  if (phase === 'generating' && jobId) {
    widgets.push({ type: 'job_progress', job_id: jobId })
  }

  if (phase === 'done' && jobId) {
    widgets.push({ type: 'download', job_id: jobId })
  }

  return widgets
}

export function shouldShowActiveWidgets(
  phase: ConversationPhase,
  status: string,
  messageCount: number,
): boolean {
  if (status === 'generating' || status === 'done' || status === 'failed') return true
  if (phase === 'intake' && messageCount === 0) return false
  return phase !== 'intake'
}
