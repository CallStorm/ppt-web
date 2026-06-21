import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../stores/authStore'
import { notifyError, notifySuccess } from '../stores/toastStore'
import { useQueryClient } from '@tanstack/react-query'
import { JOBS_KEY } from '../hooks/useJobs'
import { FileUploadZone } from '../components/jobs/FileUploadZone'
import {
  DEFAULT_JOB_OPTIONS,
  JobOptionsPanel,
} from '../components/jobs/JobOptionsPanel'
import type { JobOptions } from '../lib/jobOptions'

export function NewJobPage() {
  const quota = useAuthStore((s) => s.quota)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [projectName, setProjectName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [options, setOptions] = useState<JobOptions>(DEFAULT_JOB_OPTIONS)
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = useMemo(
    () => !submitting && !!prompt.trim() && quota() > 0,
    [submitting, prompt, quota],
  )

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('prompt', prompt.trim())
      if (projectName.trim()) fd.append('project_name', projectName.trim())
      fd.append('language', options.language)
      fd.append('scenario', options.scenario)
      fd.append('audience', options.audience)
      fd.append('tone', options.tone)
      fd.append('page_count', String(options.page_count))
      for (const f of files) fd.append('files', f, f.name)
      const job = await api<{ id: string }>('POST', '/api/jobs', fd)
      notifySuccess('任务已创建，排队中…')
      await qc.invalidateQueries({ queryKey: JOBS_KEY })
      navigate(`/jobs/${job.id}`)
    } catch (e) {
      notifyError('创建失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">创建</h1>
        <Link to="/" className="text-sm text-slate-500 hover:text-gemini-600">
          取消
        </Link>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-slate-500">项目名称（可选）</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="例：Q1 产品发布"
          />
        </label>

        <FileUploadZone files={files} onChange={setFiles} />

        <label className="block">
          <span className="text-xs text-slate-500">内容描述</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="介绍 XX 产品的核心功能、目标用户与竞争优势…"
          />
        </label>

        <JobOptionsPanel value={options} onChange={setOptions} />

        {quota() <= 0 && (
          <p className="text-sm text-rose-600">Credits 不足，无法创建任务</p>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full rounded-md bg-gemini-600 py-2.5 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
        >
          {submitting ? '提交中…' : '创建任务'}
        </button>
      </div>
    </div>
  )
}
