import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Conversation } from '../../api/types'
import { parseServerDate, getDisplayTimezone } from '../../lib/format'
import { useCreateConversation } from '../../hooks/useConversations'
import { conversationRowAccent, conversationStatusVisual } from '../../lib/conversationStatus'
import { ConversationStatusDot } from './ConversationStatusDot'

type Group = { label: string; items: Conversation[] }

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function groupByDate(conversations: Conversation[]): Group[] {
  const now = new Date()
  const today = startOfLocalDay(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const buckets = new Map<string, Conversation[]>()
  const order: string[] = []

  for (const c of conversations) {
    const d = parseServerDate(c.updated_at)
    if (!d) continue
    const day = startOfLocalDay(d)
    let label: string
    if (day.getTime() === today.getTime()) label = '今天'
    else if (day.getTime() === yesterday.getTime()) label = '昨天'
    else {
      label = d.toLocaleDateString('zh-CN', {
        month: 'long',
        day: 'numeric',
        timeZone: getDisplayTimezone(),
      })
    }
    if (!buckets.has(label)) {
      buckets.set(label, [])
      order.push(label)
    }
    buckets.get(label)!.push(c)
  }

  return order.map((label) => ({ label, items: buckets.get(label)! }))
}

type Props = {
  conversations: Conversation[]
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function ChatSidebar({ conversations, collapsed, onToggleCollapse }: Props) {
  const { id: activeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const createConv = useCreateConversation()
  const groups = groupByDate(conversations)

  const handleNew = () => {
    navigate('/chat')
  }

  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 w-12 shrink-0 flex-col items-center overflow-hidden border-r border-slate-200 bg-slate-50/80 py-3 dark:border-slate-800 dark:bg-slate-900/50">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          aria-label="展开侧边栏"
        >
          »
        </button>
        <button
          type="button"
          onClick={handleNew}
          className="mt-4 rounded-md p-2 text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-800"
          aria-label="新建会话"
        >
          +
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full min-h-0 w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
      {onToggleCollapse && (
        <div className="flex justify-end px-3 py-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="收起侧边栏"
          >
            «
          </button>
        </div>
      )}

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={handleNew}
          disabled={createConv.isPending}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600"
        >
          <span>+ 新建会话</span>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500 dark:bg-slate-800">
            New
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-slate-400">暂无历史会话</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-2 py-1 text-xs text-slate-400">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((c) => {
                const active = c.id === activeId
                const visual = conversationStatusVisual(c)
                const accent = active ? 'border-l-transparent' : conversationRowAccent(visual.kind)
                return (
                  <li key={c.id}>
                    <Link
                      to={`/chat/${c.id}`}
                      className={`flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${accent} ${
                        active
                          ? 'bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-600 hover:bg-white/80 dark:text-slate-400 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <ConversationStatusDot visual={visual} />
                      <span className="truncate">{c.title || '新对话'}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
