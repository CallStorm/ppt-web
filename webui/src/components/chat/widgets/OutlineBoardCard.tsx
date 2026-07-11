import { useState } from 'react'
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
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">大纲</h3>
      <p className="mt-1 text-xs text-slate-500">
        {editable ? '可编辑章节标题，确认后继续选择风格' : '章节列表'}
      </p>

      <ul className="mt-3 space-y-2">
        {items.map((item, idx) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50"
          >
            <span className="text-xs text-slate-400 w-6">{idx + 1}</span>
            {editable ? (
              <input
                type="text"
                value={item.title}
                onChange={(e) => updateTitle(idx, e.target.value)}
                className="flex-1 rounded border-0 bg-transparent text-sm focus:ring-1 focus:ring-gemini-500"
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
            <button
              type="button"
              onClick={() => onConfirm(items)}
              disabled={submitting}
              className="rounded-md bg-gemini-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
            >
              {submitting ? '保存中…' : '确认大纲，继续'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
