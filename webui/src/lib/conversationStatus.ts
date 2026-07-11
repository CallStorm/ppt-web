import type { Conversation, ConversationPhase } from '../api/types'

export type ConvListVisualKind = 'running' | 'needs_input' | 'done' | 'failed'

export type ConvListVisual = {
  kind: ConvListVisualKind
  label: string
  phaseHint?: string
}

const PHASE_HINT: Record<ConversationPhase, string> = {
  intake: '待输入主题',
  requirements: '待填需求',
  outline: '待确认大纲',
  style: '待选风格',
  generating: '生成中',
  done: '已完成',
}

export function conversationStatusVisual(c: Conversation): ConvListVisual {
  if (c.status === 'generating') {
    return { kind: 'running', label: '执行中', phaseHint: PHASE_HINT.generating }
  }
  if (c.status === 'failed') {
    return { kind: 'failed', label: '失败' }
  }
  if (c.status === 'done') {
    return { kind: 'done', label: '已完成', phaseHint: PHASE_HINT.done }
  }
  return {
    kind: 'needs_input',
    label: '待填写',
    phaseHint: PHASE_HINT[c.phase] ?? '待填写',
  }
}

export function conversationRowAccent(kind: ConvListVisualKind): string {
  switch (kind) {
    case 'running':
      return 'border-l-primary/50'
    case 'failed':
      return 'border-l-danger/50'
    default:
      return 'border-l-transparent'
  }
}
