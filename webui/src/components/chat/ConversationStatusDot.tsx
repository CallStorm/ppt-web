import type { ConvListVisual } from '../../lib/conversationStatus'

const KIND_CLASS: Record<ConvListVisual['kind'], string> = {
  running: 'conv-status-running',
  needs_input: 'conv-status-needs-input',
  done: 'conv-status-done',
  failed: 'conv-status-failed',
}

type Props = {
  visual: ConvListVisual
}

export function ConversationStatusDot({ visual }: Props) {
  const title = visual.phaseHint
    ? `${visual.label} · ${visual.phaseHint}`
    : visual.label

  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${KIND_CLASS[visual.kind]}`}
      title={title}
      aria-label={title}
    />
  )
}
