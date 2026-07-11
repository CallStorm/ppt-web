import type { ChatDraft, ChatMessage } from '../../api/types'
import { ConfirmedRecordCard } from './ConfirmedRecordCard'

type Props = {
  message: ChatMessage
  draft?: ChatDraft | null
}

export function MessageBubble({ message, draft }: Props) {
  const isUser = message.role === 'user'

  if (message.role === 'system' && message.payload?.type === 'draft_updated') {
    const action = message.payload.action
    const snapshot = message.payload.snapshot as Record<string, unknown> | undefined
    const hasConfirm =
      action === 'requirements_submit' ||
      action === 'outline_confirm' ||
      action === 'style_confirm' ||
      message.content.includes('已确认') ||
      message.content.includes('已选定')

    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="flex justify-center py-1">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800">
            {message.content}
          </span>
        </div>
        {hasConfirm && (
          <ConfirmedRecordCard
            action={action}
            snapshot={snapshot}
            draft={draft}
            label={message.content}
          />
        )}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gemini-600 text-white'
            : 'border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
        }`}
      >
        {message.content && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        )}
      </div>
    </div>
  )
}
