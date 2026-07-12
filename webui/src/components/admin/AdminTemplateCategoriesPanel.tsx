import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { TemplateCategory } from '../../lib/jobOptions'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { panelClassName } from '../ui/Card'

export function AdminTemplateCategoriesPanel() {
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [sortOrder, setSortOrder] = useState(10)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api<{ categories: TemplateCategory[] }>('GET', '/api/templates/categories')
      setCategories(res.categories.filter((c) => c.scope !== 'system'))
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const create = async () => {
    if (!newId.trim() || !newName.trim()) return
    try {
      await api('POST', '/api/templates/categories', {
        id: newId.trim(),
        name: newName.trim(),
        sort_order: sortOrder,
      })
      notifySuccess('分类已创建')
      setNewId('')
      setNewName('')
      await load()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (id: string) => {
    try {
      await api('DELETE', `/api/templates/categories/${id}`)
      notifySuccess('已删除')
      await load()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <section className={panelClassName}>
        <h2 className="text-sm font-medium">模板分类</h2>
        <p className="mt-1 text-xs text-slate-500">
          管理员可创建分类，用于组织全局模板。系统内置与「我的模板」分类不可删除。
        </p>
        {loading && <p className="mt-2 text-xs text-slate-400">加载中…</p>}
        <ul className="mt-4 space-y-2 text-sm">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 dark:border-slate-700"
            >
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-xs text-slate-400">{c.id}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="text-xs text-rose-600 hover:underline"
              >
                删除
              </button>
            </li>
          ))}
          {categories.length === 0 && !loading && (
            <li className="text-slate-500">暂无管理员分类</li>
          )}
        </ul>
      </section>

      <section className={panelClassName}>
        <h2 className="text-sm font-medium">新建分类</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block text-xs">
            ID（slug）
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="finance"
            />
          </label>
          <label className="block text-xs">
            显示名
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              placeholder="金融行业"
            />
          </label>
          <label className="block text-xs">
            排序
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              className="mt-1 w-full rounded border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={create}
          className="mt-3 rounded-md bg-gemini-600 px-3 py-1.5 text-xs text-white"
        >
          创建分类
        </button>
      </section>
    </div>
  )
}
