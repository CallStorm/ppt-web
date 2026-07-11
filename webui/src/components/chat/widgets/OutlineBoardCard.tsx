import { useState } from 'react'
import { Button } from '../../ui/Button'
import type { OutlineItem } from '../../../api/types'

type Props = {
  outline: OutlineItem[]
  editable?: boolean
  onConfirm?: (outline: OutlineItem[]) => void
  submitting?: boolean
}

function newId() {
  return `p${Date.now()}`
}

export function OutlineBoardCard({ outline, editable = true, onConfirm, submitting }: Props) {
  const [items, setItems] = useState<OutlineItem[]>(
    outline.length ? outline : [{ id: 'p1', title: '封面', bullets: [] }],
  )

  const updateTitle = (idx: number, title: string) => {
    const next = [...items]
    next[idx] = { ...next[idx], title }
    setItems(next)
  }

  const addPage = () => {
    setItems([...items, { id: newId(), title: '新页面', bullets: [] }])
  }

  const removePage = (idx: number) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== idx))
  }

  return (
    <div className="mt-3 rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-4 shadow-[var(--shadow-panel)]">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">大纲</h3>
      <p className="mt-1 text-xs text-slate-500">
        {editable ? '可编辑章节标题，确认后继续选择风格' : '章节列表'}
      </p>

      <ul className="mt-3 space-y-2">
        {items.map((item, idx) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-primary-muted/20 px-3 py-2"
          >
            <span className="text-xs text-slate-400 w-6">{idx + 1}</span>
            {editable ? (
              <input
                type="text"
                value={item.title}
                onChange={(e) => updateTitle(idx, e.target.value)}
            className="flex-1 rounded border-0 bg-transparent text-sm text-foreground focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span className="flex-1 text-sm">{item.title}</span>
            )}
            {editable && items.length > 1 && (
              <button
                type="button"
                onClick={() => removePage(idx)}
                className="text-xs text-rose-500 hover:text-rose-600"
              >
                删除
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addPage}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
          >
            + 加一页
          </button>
          {onConfirm && (
            <Button type="button" size="sm" onClick={() => onConfirm(items)} disabled={submitting}>
              {submitting ? '保存中…' : '确认大纲，继续'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
