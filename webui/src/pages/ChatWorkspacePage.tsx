import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useConversations } from '../hooks/useConversations'
import { ChatSidebar } from '../components/chat/ChatSidebar'
import { ChatHomeHero } from '../components/chat/ChatHomeHero'
import { ChatThread } from '../components/chat/ChatThread'

export function ChatWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const { data } = useConversations()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const conversations = data?.conversations ?? []

  return (
    <div className="theme-page flex min-h-0 flex-1 overflow-hidden">
      <ChatSidebar
        conversations={conversations}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {id ? <ChatThread id={id} /> : <ChatHomeHero />}
      </main>
    </div>
  )
}
