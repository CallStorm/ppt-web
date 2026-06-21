import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, downloadUrl } from '../api/client'
import type { SseEvent } from '../api/types'
import { useJob } from '../hooks/useJobs'
import { useJobEvents } from '../hooks/useJobEvents'
import { StatusPill } from '../components/jobs/StatusPill'
import { fmtCost, fmtDateTime, truncate } from '../lib/format'
import { formatJobOptionsSummary } from '../lib/jobOptions'
import { confirmDialog } from '../stores/modalStore'
import { notifyError, notifySuccess } from '../stores/toastStore'

const STAGES = [
  '1 解析素材',
  '2 建项目',
  '3 策略规划(八点确认)',
  '5 生图',
  '6 逐页生成 SVG',
  '7 质检',
  '8 后处理',
  '8 导出 PPTX',
]

type Tab = 'overview' | 'raw' | 'timeline' | 'files'

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: job, isLoading, error, refetch } = useJob(id)
  const [tab, setTab] = useState<Tab>('overview')
  const [timeline, setTimeline] = useState<SseEvent[]>([])
  const [stage, setStage] = useState<Record<string, unknown> | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [submittingResume, setSubmittingResume] = useState(false)

  const onEvent = useCallback(
    (ev: SseEvent) => {
      if (ev.type === 'status') {
        refetch()
        if (ev.payload.status === 'paused') {
          setConfirmText(String(ev.payload.pending_confirm || ''))
        }
      } else if (ev.type === 'stage') {
        setStage(ev.payload)
      } else if (['tool', 'agent_text', 'result', 'error', 'spec'].includes(ev.type)) {
        setTimeline((prev) => {
          const next = [...prev, ev]
          return next.length > 500 ? next.slice(-500) : next
        })
      } else if (ev.type === 'pptx') {
        refetch()
      }
    },
    [refetch],
  )

  const { sseStatus } = useJobEvents(id, onEvent)

  const hasPptx = !!job?.pptx_path
  const isPaused = job?.status === 'paused'
  const isActive = job && ['running', 'queued', 'paused'].includes(job.status)

  const currentStageIdx = useMemo(() => {
    if (!stage) return -1
    const name = String(stage.stage || stage.name || '')
    return STAGES.findIndex((s) => s === name || s.startsWith(name))
  }, [stage])

  const rawOutputText = useMemo(() => {
    const lines: string[] = []
    let lastAgentText = ''
    for (const ev of timeline) {
      const seq = ev.seq ?? '?'
      if (ev.type === 'agent_text') {
        const text = String(ev.payload?.text || '')
        if (!text || text === lastAgentText) continue
        lastAgentText = text
        lines.push(`--- [#${seq}] assistant ---`, text, '')
      } else if (ev.type === 'tool') {
        const p = ev.payload || {}
        lines.push(`--- [#${seq}] tool:${p.tool || '?'} (${p.stage || ''}) ---`)
        if (p.command) lines.push(`command: ${String(p.command)}`)
        if (p.file_path) lines.push(`file: ${String(p.file_path)}`)
        lines.push('')
      } else if (ev.type === 'stage') {
        lines.push(`--- [#${seq}] stage: ${ev.payload?.stage || ''} ---`, '')
      } else if (ev.type === 'error') {
        lines.push(`--- [#${seq}] stderr ---`, String(ev.payload?.message || ''), '')
      } else if (ev.type === 'result') {
        const p = ev.payload || {}
        lines.push(
          `--- [#${seq}] result ---`,
          `cost: ${p.cost_usd ?? '—'}`,
          `stop: ${p.stop_reason ?? '—'}`,
          '',
        )
      } else if (ev.type === 'spec') {
        lines.push(`--- [#${seq}] spec ---`)
        if (ev.payload?.design_spec) lines.push('design_spec.md:', String(ev.payload.design_spec), '')
        if (ev.payload?.spec_lock) lines.push('spec_lock.md:', String(ev.payload.spec_lock), '')
        if (!ev.payload?.design_spec && !ev.payload?.spec_lock) lines.push('')
      }
    }
    if (lines.length) return lines.join('\n')
    if (job?.last_agent_text) return job.last_agent_text
    return ''
  }, [timeline, job?.last_agent_text])

  const doCancel = async () => {
    if (!id) return
    const ok = await confirmDialog({
      title: '取消任务',
      body: '确认取消这个任务？取消后无法恢复。',
      confirmText: '确认取消',
      cancelText: '不取消',
    })
    if (!ok) return
    try {
      await api('POST', `/api/jobs/${id}/cancel`)
      notifySuccess('已取消')
      await refetch()
    } catch (e) {
      notifyError('取消失败: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const doResume = async () => {
    if (!id || !confirmText.trim()) {
      notifyError('请输入确认内容')
      return
    }
    setSubmittingResume(true)
    try {
      await api('POST', `/api/jobs/${id}/resume`, { confirm: confirmText })
      notifySuccess('已提交确认，任务继续')
      setConfirmText('')
      await refetch()
    } catch (e) {
      notifyError('提交失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmittingResume(false)
    }
  }

  const doDownload = () => {
    if (!hasPptx || !id) return
    downloadUrl(`/api/jobs/${id}/pptx`, `${job?.project_name || id}.pptx`)
  }

  const copyRaw = async () => {
    try {
      await navigator.clipboard.writeText(rawOutputText)
      notifySuccess('已复制到剪贴板')
    } catch {
      notifyError('复制失败')
    }
  }

  if (isLoading) {
    return <div className="py-20 text-center text-slate-400">加载中…</div>
  }

  if (error || !job) {
    return (
      <div className="py-20 text-center">
        <p className="text-rose-600">{error instanceof Error ? error.message : '加载失败'}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-gemini-600 hover:underline">
          返回首页
        </Link>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'raw', label: '原始输出' },
    { key: 'timeline', label: '时间线' },
    { key: 'files', label: '产物' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link to="/" className="text-sm text-slate-500 hover:text-gemini-600">
          ← 返回任务列表
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{job.project_name || '(未命名)'}</h1>
            <span
              className={`sse-dot ${sseStatus === 'connected' ? 'connected' : sseStatus === 'error' ? 'error' : ''}`}
              title={sseStatus}
            />
            <StatusPill status={job.status} />
          </div>
          <p className="mt-2 text-sm text-slate-500">{truncate(job.prompt, 200)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isActive && job.status !== 'paused' && (
            <button
              type="button"
              onClick={doCancel}
              className="rounded-md border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-800"
            >
              取消
            </button>
          )}
          {hasPptx && (
            <button
              type="button"
              onClick={doDownload}
              className="rounded-md bg-gemini-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gemini-700"
            >
              下载 PPTX
            </button>
          )}
        </div>
      </div>

      {job.status === 'running' && currentStageIdx >= 0 && (
        <div className="mb-6">
          <div className="mb-2 flex gap-1">
            {STAGES.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= currentStageIdx ? 'bg-gemini-500' : 'bg-slate-200 dark:bg-slate-700'
                }`}
                title={s}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500">{STAGES[currentStageIdx]}</p>
        </div>
      )}

      {isPaused && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">需要确认</h3>
          <textarea
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-amber-200 px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"
            placeholder="输入确认内容…"
          />
          <button
            type="button"
            disabled={submittingResume}
            onClick={doResume}
            className="mt-2 rounded-md bg-amber-600 px-4 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submittingResume ? '提交中…' : '提交确认'}
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm ${
              tab === t.key
                ? 'border-b-2 border-gemini-600 font-medium text-gemini-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4 text-sm">
          {job.options && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs text-slate-500">生成选项</p>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                {formatJobOptionsSummary(job.options)}
              </p>
            </div>
          )}
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">状态</dt>
              <dd>{job.status}</dd>
            </div>
            <div>
              <dt className="text-slate-500">费用</dt>
              <dd>{fmtCost(job.cost_usd)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">创建时间</dt>
              <dd>{fmtDateTime(job.created_at)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">更新时间</dt>
              <dd>{fmtDateTime(job.updated_at)}</dd>
            </div>
          </dl>
          {job.error_message && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
              {job.error_message}
            </div>
          )}
          {job.last_agent_text && (
            <div>
              <h3 className="mb-2 font-medium">最新 Agent 输出</h3>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-xs dark:bg-slate-800">
                {job.last_agent_text}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === 'raw' && (
        <div>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={copyRaw}
              disabled={!rawOutputText}
              className="text-xs text-gemini-600 hover:underline disabled:opacity-50"
            >
              复制
            </button>
          </div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 font-mono text-xs dark:bg-slate-800">
            {rawOutputText || '(暂无输出)'}
          </pre>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="max-h-[60vh] space-y-2 overflow-auto">
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-400">等待事件…</p>
          ) : (
            timeline.map((ev, i) => (
              <div
                key={i}
                className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700"
              >
                <span className="font-mono text-slate-400">#{ev.seq}</span>{' '}
                <span className="font-medium">{ev.type}</span>
                <pre className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-400">
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="text-sm">
          {hasPptx ? (
            <button
              type="button"
              onClick={doDownload}
              className="text-gemini-600 hover:underline"
            >
              下载 {job.project_name || job.id}.pptx
            </button>
          ) : (
            <p className="text-slate-400">产物尚未就绪</p>
          )}
        </div>
      )}
    </div>
  )
}
