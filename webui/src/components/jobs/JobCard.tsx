import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Job } from '../../api/types'
import { downloadUrl } from '../../api/client'
import { StatusPill } from './StatusPill'
import { QueueBadge } from './QueueBadge'
import { CoverPlaceholder } from './CoverPlaceholder'
import { SlidePreviewModal } from './SlidePreviewModal'
import { confirmDialog } from '../../stores/modalStore'
import { useDeleteJob, useRetryJob } from '../../hooks/useJobs'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { fmtDateTime, fmtDuration, jobElapsedMs } from '../../lib/format'

export function JobCard({ job }: { job: Job }) {
  const hasPptx = !!job.pptx_path
  const isDone = job.status === 'done'
  const showDownload = isDone && hasPptx
  const canRetry = job.status === 'failed' || job.status === 'cancelled'
  const deleteJob = useDeleteJob()
  const retryJob = useRetryJob()
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // previewOk is derived from props + a local failure flag set on <img> onError;
  // no syncing effect, so no react-hooks/set-state-in-effect advisory.
  // previewFailed resets naturally on job change because the parent renders
  // <JobCard key={job.id} ...>, remounting the component per job.
  const previewOk = !!job.has_preview && isDone && !previewFailed

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDownload = (e: React.MouseEvent) => {
    stop(e)
    if (!hasPptx) return
    downloadUrl(`/api/jobs/${job.id}/pptx`, `${job.project_name || job.id}.pptx`)
  }

  const handlePreview = (e: React.MouseEvent) => {
    stop(e)
    setPreviewOpen(true)
  }

  const handleRetry = async (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen(false)
    // No success toast — the card's own status change (queued→running) is the
    // feedback, per spec §4 (option #1). Only surface failures.
    try {
      await retryJob.mutateAsync(job.id)
    } catch (err) {
      notifyError(err instanceof Error ? err.message : '重试失败')
    }
  }

  const handleMenuToggle = (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen((v) => !v)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen(false)
    const ok = await confirmDialog({
      title: '删除作品',
      body: `确认删除「${job.project_name || '(未命名)'}」？此操作不可恢复。`,
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!ok) return
    try {
      await deleteJob.mutateAsync(job.id)
      notifySuccess('作品已删除')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : '删除失败')
    }
  }

  // Failed/cancelled error line (single, truncated).
  const errText =
    job.status === 'cancelled'
      ? '用户取消'
      : job.error_message?.trim()
  const showErr = (job.status === 'failed' || job.status === 'cancelled') && !!errText

  const dateText = fmtDateTime(job.created_at)
  const elapsedMs = jobElapsedMs(job)
  const durationPrefix =
    job.status === 'done' || job.status === 'failed' || job.status === 'cancelled'
      ? '耗时'
      : '已用时'
  const durationText = elapsedMs == null ? '—' : fmtDuration(elapsedMs)
  const metaText = `${dateText} · ${durationPrefix} ${durationText}`

  return (
    <article
      className={`group relative rounded-xl border bg-white shadow-sm transition-all
                  hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900
                  ${menuOpen ? 'z-30' : ''}
                  ${job.status === 'running' ? 'border-l-[3px] border-l-gemini-500 border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <Link to={`/jobs/${job.id}`} className="block">
        <div className="relative aspect-video overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800">
          {previewOk ? (
            <img
              src={`/api/jobs/${job.id}/preview`}
              alt={job.project_name || '封面预览'}
              className="h-full w-full object-cover object-top"
              loading="lazy"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <CoverPlaceholder status={job.status} id={job.id} />
          )}

          {/* Hover action chip (top-right). Fades in on group-hover. */}
          {(isDone || canRetry) && (
            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/85 px-1.5 py-1 opacity-0 shadow-sm backdrop-blur transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-slate-900/85">
              {isDone && (
                <button
                  type="button"
                  onClick={handlePreview}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
                  title="预览"
                  aria-label="预览"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )}
              {isDone && showDownload && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
                  title="下载 PPTX"
                  aria-label="下载 PPTX"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              )}
              {isDone && hasPptx && (
                <Link
                  to={`/jobs/${job.id}/edit`}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
                  title="编辑修改"
                  aria-label="编辑修改"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </Link>
              )}
              {canRetry && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retryJob.isPending}
                  className="rounded-full p-1 text-gemini-600 hover:bg-gemini-100 disabled:opacity-50 dark:hover:bg-gemini-900/30"
                  title="重试"
                  aria-label="重试"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </Link>

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Link
            to={`/jobs/${job.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:text-gemini-600"
            title={job.project_name || '(未命名)'}
          >
            {job.project_name || '(未命名)'}
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            <StatusPill status={job.status} />
            <QueueBadge position={job.queue_position} />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={handleMenuToggle}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="更多操作"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 bottom-full z-50 mb-1 min-w-[88px] rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  {canRetry && (
                    <button
                      type="button"
                      onClick={handleRetry}
                      disabled={retryJob.isPending}
                      className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      重试
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleteJob.isPending}
                    className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-900/20"
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <p
          className="mt-1 text-xs text-slate-400 dark:text-slate-500"
          title={metaText}
        >
          {metaText}
        </p>

        {showErr && (
          <p className="mt-1 truncate text-xs text-rose-500/80 dark:text-rose-400/80" title={errText}>
            {errText}
          </p>
        )}
      </div>

      {previewOpen && (
        <SlidePreviewModal
          jobId={job.id}
          jobName={job.project_name || '(未命名)'}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </article>
  )
}
