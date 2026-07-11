import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ChatComposer, chatGreeting } from './ChatComposer'
import { CONVERSATIONS_KEY, useCreateConversation } from '../../hooks/useConversations'
import { notifyError } from '../../stores/toastStore'

export function ChatHomeHero() {
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const createConv = useCreateConversation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const handleSend = async () => {
    const text = input.trim()
    if (!text && files.length === 0) return
    setSending(true)
    try {
      const conv = await createConv.mutateAsync()
      const fd = new FormData()
      fd.append('content', text || '（附件）')
      for (const f of files) fd.append('files', f)
      await api('POST', `/api/conversations/${conv.id}/messages`, fd)
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
      navigate(`/chat/${conv.id}`)
    } catch (e) {
      notifyError(String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="theme-page flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-y-contain px-6 pb-16">
      <h1 className="font-display text-center text-3xl font-semibold tracking-tight text-foreground">
        {chatGreeting()}，有什么 PPT 需要我做？
      </h1>
      <p className="mt-3 text-center text-sm text-muted-fg">
        AI 生成定制级、可编辑的 PPT
      </p>
      <div className="mt-10 w-full flex justify-center">
        <ChatComposer
          variant="hero"
          value={input}
          onChange={setInput}
          onSend={handleSend}
          files={files}
          onFilesChange={setFiles}
          sending={sending}
          disabled={sending}
          placeholder="描述你的主题…"
        />
      </div>
    </div>
  )
}
