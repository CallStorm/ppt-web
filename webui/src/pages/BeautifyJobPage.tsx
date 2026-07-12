import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { invalidateJobLists } from '../hooks/useJobs'
import { TemplateGallery } from '../components/templates/TemplateGallery'
import type { TemplateCatalogEntry, TemplateCategory, TemplateUsage } from '../lib/jobOptions'

import { panelClassName } from '../components/ui/Card'

const PANEL_CLASS = panelClassName

const PPTX_ACCEPT =
  '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'

export function BeautifyJobPage() {
  const quota = useAuthStore((s) => s.quota)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [projectName, setProjectName] = useState('')
  const [selected, setSelected] = useState<TemplateCatalogEntry | null>(null)
  const [templateUsage, setTemplateUsage] = useState<TemplateUsage>('adaptive')
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const [tplRes, catRes] = await Promise.all([
        api<{ templates: TemplateCatalogEntry[] }>('GET', '/api/templates'),
        api<{ categories: TemplateCategory[] }>('GET', '/api/templates/categories'),
      ])
      return { templates: tplRes.templates, categories: catRes.categories }
    },
  })

  const templates = templatesQ.data?.templates ?? []
  const categories = templatesQ.data?.categories ?? []

  const canSubmit = useMemo(
    () => Boolean(file && selected && quota() > 0 && !submitting),
    [file, selected, quota, submitting],
  )

  const pickFile = (list: FileList | null) => {
    if (!list?.length) return
    const f = list[0]
    if (!f.name.toLowerCase().endsWith('.pptx')) {
      notifyError('请上传 .pptx 文件')
      return
    }
    setFile(f)
  }

  const submit = async () => {
    if (!canSubmit || !file || !selected) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append(
        'prompt',
        `请基于模板「${selected.display_name || selected.id}」美化这份 PPT，保持全部文字与页数不变，仅套用模板视觉样式。`,
      )
      if (projectName.trim()) fd.append('project_name', projectName.trim())
      fd.append('job_type', 'beautify')
      fd.append('template_scope', selected.scope)
      fd.append('template_kind', selected.kind)
      fd.append('template_id', selected.id)
      fd.append('template_usage', templateUsage)
      fd.append('files', file, file.name)
      const job = await api<{ id: string }>('POST', '/api/jobs', fd)
      notifySuccess('已开始美化，请稍候…')
      invalidateJobLists(qc)
      navigate(`/jobs/${job.id}`)
    } catch (e) {
      notifyError('创建失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <Link to="/" className="text-xs text-slate-500 hover:text-gemini-600">
          ← 返回作品列表
        </Link>
        <h1 className="mt-2 text-xl font-semibold">美化 PPT</h1>
        <p className="mt-1 text-sm text-slate-500">
          上传现有 PPTX，选择模板套用样式。文字与页数保持不变，仅更换视觉设计。
        </p>
      </div>

      <div className="space-y-6">
        <section className={PANEL_CLASS}>
          <h2 className="text-sm font-medium">① 上传源 PPT</h2>
          <p className="mt-1 text-xs text-slate-500">仅支持单个 .pptx 文件</p>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pickFile(e.dataTransfer.files)
            }}
            className={`mt-3 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
              dragOver
                ? 'border-gemini-400 bg-gemini-50/50 dark:bg-gemini-950/20'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {file ? (
              <div className="space-y-2">
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  移除
                </button>
              </div>
            ) : (
              <>
                <p className="text-slate-600 dark:text-slate-300">拖拽 PPTX 到此处，或</p>
                <label className="mt-2 inline-block cursor-pointer rounded-md bg-gemini-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gemini-700">
                  选择文件
                  <input
                    type="file"
                    accept={PPTX_ACCEPT}
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files)}
                  />
                </label>
              </>
            )}
          </div>
        </section>

        <section className={PANEL_CLASS}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">② 选择模板</h2>
            <Link
              to="/templates"
              className="text-xs text-gemini-600 hover:underline dark:text-gemini-400"
            >
              管理模板 →
            </Link>
          </div>
          {templatesQ.isError && (
            <p className="mt-2 text-sm text-rose-600">加载模板失败，请刷新重试</p>
          )}
          <div className="mt-3">
            <TemplateGallery
              templates={templates}
              categories={categories}
              selected={selected}
              onSelect={setSelected}
              loading={templatesQ.isLoading}
            />
          </div>
          <details className="mt-4 text-xs text-slate-500">
            <summary className="cursor-pointer select-none">高级：模板使用模式</summary>
            <div className="mt-2 flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="template_usage"
                  checked={templateUsage === 'adaptive'}
                  onChange={() => setTemplateUsage('adaptive')}
                />
                adaptive（推荐：按页面类型选版式）
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="template_usage"
                  checked={templateUsage === 'strict'}
                  onChange={() => setTemplateUsage('strict')}
                />
                strict（严格保持 Layout 契约）
              </label>
            </div>
          </details>
        </section>

        <section className={PANEL_CLASS}>
          <h2 className="text-sm font-medium">③ 确认并开始</h2>
          <label className="mt-3 block text-xs text-slate-500">
            项目名称（可选）
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="留空则自动生成"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
            {file && selected ? (
              <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                <li>
                  源文件：<span className="font-medium">{file.name}</span>
                </li>
                <li>
                  模板：
                  <span className="font-medium">
                    {selected.display_name || selected.id}
                  </span>
                  <span className="ml-1 text-xs text-slate-400">
                    ({selected.scope}/{selected.kind})
                  </span>
                </li>
              </ul>
            ) : (
              <p className="text-slate-500">请先上传 PPT 并选择模板</p>
            )}
          </div>
          {quota() <= 0 && (
            <p className="mt-2 text-sm text-rose-600">Credits 不足，无法创建任务</p>
          )}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="mt-4 w-full rounded-lg bg-gemini-600 py-2.5 text-sm font-medium text-white hover:bg-gemini-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '提交中…' : '开始美化'}
          </button>
        </section>
      </div>
    </div>
  )
}
