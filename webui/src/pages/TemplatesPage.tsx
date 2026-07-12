import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { confirmDialog } from '../stores/modalStore'
import { TemplateGallery } from '../components/templates/TemplateGallery'
import {
  TemplateTaskCard,
  TemplateTaskCardSkeleton,
} from '../components/templates/TemplateTaskCard'
import { Tabs } from '../components/ui/Tabs'
import { useRetryTemplateTask, useTemplateTasks } from '../hooks/useTemplateTasks'
import type { TemplateCatalogEntry, TemplateCategory } from '../lib/jobOptions'
import type { TemplateTask } from '../lib/templateTasks'
import { panelClassName } from '../components/ui/Card'

type PageTab = 'library' | 'tasks'

export function TemplatesPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') === 'tasks' ? 'tasks' : 'library') as PageTab
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['templates', 'library'],
    queryFn: async () => {
      const [tplRes, catRes] = await Promise.all([
        api<{ templates: TemplateCatalogEntry[] }>('GET', '/api/templates'),
        api<{ categories: TemplateCategory[] }>('GET', '/api/templates/categories'),
      ])
      return { templates: tplRes.templates, categories: catRes.categories }
    },
  })

  const tasksQ = useTemplateTasks()
  const retryTask = useRetryTemplateTask()

  const templates = q.data?.templates ?? []
  const categories = q.data?.categories ?? []
  const tasks = tasksQ.data?.tasks ?? []

  const pageTabs = useMemo(
    () => [
      { id: 'library', label: '模板库' },
      {
        id: 'tasks',
        label: tasks.length > 0 ? `制作任务 (${tasks.length})` : '制作任务',
      },
    ],
    [tasks.length],
  )

  const setTab = (tab: string) => {
    if (tab === 'tasks') {
      setSearchParams({ tab: 'tasks' })
    } else {
      setSearchParams({})
    }
  }

  const deleteTemplate = async (entry: TemplateCatalogEntry) => {
    if (!entry.db_id) return
    const ok = await confirmDialog({
      title: '删除模板',
      body: `确认删除「${entry.display_name || entry.id}」？删除后无法恢复。`,
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!ok) return
    setDeletingId(entry.db_id)
    try {
      await api('DELETE', `/api/templates/records/${entry.db_id}`)
      notifySuccess('已删除')
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['templates', 'tasks'] })
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const retryTemplate = async (task: TemplateTask) => {
    if (!task.db_id) return
    setRetryingId(task.db_id)
    try {
      await retryTask.mutateAsync(task.db_id)
      notifySuccess('已重新加入制作队列')
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/jobs/beautify" className="text-xs text-slate-500 hover:text-gemini-600">
            ← 返回美化 PPT
          </Link>
          <h1 className="mt-2 text-xl font-semibold">模板库</h1>
          <p className="mt-1 text-sm text-slate-500">
            浏览可用模板，或在「制作任务」中查看模板生成进度。
          </p>
        </div>
        <Link
          to="/templates/new"
          className="rounded-lg bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700"
        >
          制作模板
        </Link>
      </div>

      <Tabs tabs={pageTabs} active={activeTab} onChange={setTab} className="mb-4" />

      {activeTab === 'library' && (
        <section className={panelClassName}>
          <TemplateGallery
            templates={templates}
            categories={categories}
            selected={null}
            onSelect={() => {}}
            onDelete={deleteTemplate}
            deletingId={deletingId}
            isAdmin={isAdmin()}
            loading={q.isLoading}
          />
        </section>
      )}

      {activeTab === 'tasks' && (
        <section className={panelClassName}>
          {tasksQ.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <TemplateTaskCardSkeleton key={i} />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500">暂无制作任务</p>
              <Link
                to="/templates/new"
                className="mt-3 inline-block text-sm text-gemini-600 hover:underline"
              >
                去制作模板
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {tasks.map((task) => (
                <TemplateTaskCard
                  key={task.db_id || task.id}
                  task={task}
                  onRetry={retryTemplate}
                  onDelete={deleteTemplate}
                  retrying={retryingId === task.db_id}
                  deleting={deletingId === task.db_id}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {isAdmin() && (
        <p className="mt-4 text-xs text-slate-500">
          管理员可在
          <Link to="/admin" className="mx-1 text-gemini-600 hover:underline">
            管理后台 → 模板分类
          </Link>
          创建全局模板分类。
        </p>
      )}
    </div>
  )
}
