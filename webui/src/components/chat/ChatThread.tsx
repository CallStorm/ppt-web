import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useConversation,
  useGenerateFromChat,
  usePatchDraft,
  useSendMessage,
} from '../../hooks/useConversations'
import { MessageBubble } from './MessageBubble'
import { ChatWidgets } from './ChatWidgets'
import { ChatComposer } from './ChatComposer'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { useAuthStore } from '../../stores/authStore'
import type { ChatDraft } from '../../api/types'
import { shouldShowActiveWidgets, widgetsForPhase } from '../../lib/chatWidgets'

type Props = {
  id: string
}

export function ChatThread({ id }: Props) {
  const quota = useAuthStore((s) => s.quota)
  const { data: conv, isLoading, error, refetch } = useConversation(id)
  const sendMessage = useSendMessage(id)
  const patchDraft = usePatchDraft(id)
  const generate = useGenerateFromChat(id)

  const [input, setInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const draft = conv?.draft
  const messages = conv?.messages ?? []

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, conv?.status])

  const activeWidgets = useMemo(
    () => (draft && conv ? widgetsForPhase(conv.phase, draft, conv.job_id) : []),
    [draft, conv],
  )

  const showActiveWidgets = useMemo(
    () =>
      draft && conv
        ? shouldShowActiveWidgets(conv.phase, conv.status, messages.length) &&
          activeWidgets.length > 0
        : false,
    [draft, conv, messages.length, activeWidgets.length],
  )

  const handlers = useMemo(
    () => ({
      onRequirementsSubmit: async (requirements: ChatDraft['requirements']) => {
        try {
          await patchDraft.mutateAsync({
            action: 'requirements_submit',
            patch: { requirements },
          })
        } catch (e) {
          notifyError(String(e))
        }
      },
      onOutlineConfirm: async (outline: ChatDraft['outline']) => {
        try {
          await patchDraft.mutateAsync({
            action: 'outline_confirm',
            patch: { outline },
          })
        } catch (e) {
          notifyError(String(e))
        }
      },
      onStyleConfirm: async (options: Record<string, unknown>) => {
        try {
          await patchDraft.mutateAsync({
            action: 'style_confirm',
            patch: { options },
          })
        } catch (e) {
          notifyError(String(e))
        }
      },
      onTemplateSelect: async (template: { kind: string; id: string } | null) => {
        try {
          await patchDraft.mutateAsync({ patch: { template } })
        } catch (e) {
          notifyError(String(e))
        }
      },
      onGenerate: async () => {
        if (quota() <= 0) {
          notifyError('配额不足')
          return
        }
        try {
          await generate.mutateAsync()
          notifySuccess('已开始生成')
          refetch()
        } catch (e) {
          notifyError(String(e))
        }
      },
      patchSubmitting: patchDraft.isPending,
      generating: generate.isPending,
    }),
    [patchDraft, generate, quota, refetch],
  )

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text && files.length === 0) return
    try {
      await sendMessage.mutateAsync({ content: text || '（附件）', files })
      setInput('')
      setFiles([])
    } catch (e) {
      notifyError(String(e))
    }
  }, [input, files, sendMessage])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        载入会话…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-rose-600">
        {String(error)}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {conv && (
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-elevated/80 px-6 py-3">
          <h1 className="font-display truncate text-sm font-medium text-foreground">
            {conv.title || '新对话'}
          </h1>
          <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[10px] text-muted-fg">
            {conv.phase}
          </span>
        </header>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} draft={draft} />
          ))}

          {showActiveWidgets && draft && (
            <div className="rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]">
              <ChatWidgets draft={draft} widgets={activeWidgets} handlers={handlers} />
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface-elevated/90 px-4 py-4 backdrop-blur md:px-8">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            variant="compact"
            value={input}
            onChange={setInput}
            onSend={handleSend}
            files={files}
            onFilesChange={setFiles}
            sending={sendMessage.isPending}
            disabled={conv?.status === 'generating'}
            placeholder={
              conv?.status === 'generating'
                ? '生成中，完成后可继续对话…'
                : '输入消息…'
            }
          />
        </div>
      </footer>
    </div>
  )
}
