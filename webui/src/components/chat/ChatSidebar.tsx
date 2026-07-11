import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Conversation } from '../../api/types'
import { parseServerDate, getDisplayTimezone } from '../../lib/format'
import { useCreateConversation } from '../../hooks/useConversations'
import { conversationRowAccent, conversationStatusVisual } from '../../lib/conversationStatus'
import { ConversationStatusDot } from './ConversationStatusDot'
import { Button } from '../ui/Button'
import { cn } from '../../lib/cn'

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
      <aside className="theme-sidebar flex h-full min-h-0 w-12 shrink-0 flex-col items-center overflow-hidden border-r border-border py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="rounded-[var(--radius-control)] p-2 text-muted-fg hover:bg-primary-muted/40 hover:text-foreground"
          aria-label="展开侧边栏"
        >
          »
        </button>
        <button
          type="button"
          onClick={handleNew}
          className="mt-4 rounded-[var(--radius-control)] p-2 text-foreground hover:bg-primary-muted/40"
          aria-label="新建会话"
        >
          +
        </button>
      </aside>
    )
  }

  return (
    <aside className="theme-sidebar flex h-full min-h-0 w-60 shrink-0 flex-col overflow-hidden border-r border-border">
      {onToggleCollapse && (
        <div className="flex justify-end px-3 py-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-[var(--radius-control)] p-1 text-muted-fg hover:bg-primary-muted/40 hover:text-foreground"
            aria-label="收起侧边栏"
          >
            «
          </button>
        </div>
      )}

      <div className="px-3 pb-3">
        <Button
          type="button"
          variant="secondary"
          fullWidth
          onClick={handleNew}
          disabled={createConv.isPending}
          className="justify-between shadow-[var(--shadow-panel)]"
        >
          <span>+ 新建会话</span>
          <span className="rounded-[var(--radius-control)] bg-primary-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-fg">
            New
          </span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-fg">暂无历史会话</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-2 py-1 text-xs text-muted-fg">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((c) => {
                const active = c.id === activeId
                const visual = conversationStatusVisual(c)
                const accent = active ? 'border-l-transparent' : conversationRowAccent(visual.kind)
                return (
                  <li key={c.id}>
                    <Link
                      to={`/chat/${c.id}`}
                      className={cn(
                        'flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-sm transition border-l-2',
                        accent,
                        active
                          ? 'bg-surface-elevated font-medium text-foreground shadow-[var(--shadow-panel)]'
                          : 'text-muted-fg hover:bg-surface-elevated/80 hover:text-foreground',
                      )}
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
