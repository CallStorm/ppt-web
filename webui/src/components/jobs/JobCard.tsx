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
import { fmtJobMetaLine, truncate } from '../../lib/format'

import type { CoverAspect, JobCardSize } from '../../hooks/useResponsivePageSize'
import { cn } from '../../lib/cn'

const CARD_STYLES: Record<
  JobCardSize,
  { shell: string; cover: string; body: string; title: string; meta: string; promptLen: number }
> = {
  sm: {
    shell: 'rounded-lg',
    cover: 'rounded-t-lg',
    body: 'px-2 py-1.5',
    title: 'text-xs',
    meta: 'text-[10px]',
    promptLen: 24,
  },
  md: {
    shell: 'rounded-xl',
    cover: 'rounded-t-xl',
    body: 'px-2.5 py-2',
    title: 'text-sm',
    meta: 'text-[11px]',
    promptLen: 36,
  },
  lg: {
    shell: 'rounded-xl',
    cover: 'rounded-t-xl',
    body: 'px-3 py-2',
    title: 'text-sm',
    meta: 'text-xs',
    promptLen: 48,
  },
  xl: {
    shell: 'rounded-2xl',
    cover: 'rounded-t-2xl',
    body: 'px-3 py-2.5',
    title: 'text-base',
    meta: 'text-xs',
    promptLen: 64,
  },
}

export function JobCard({
  job,
  sharedErrorCount = 0,
  size = 'md',
  compact = false,
  coverAspect = 'aspect-video',
}: {
  job: Job
  sharedErrorCount?: number
  size?: JobCardSize
  compact?: boolean
  coverAspect?: CoverAspect
}) {
  const hasPptx = !!job.pptx_path
  const isDone = job.status === 'done'
  const showDownload = isDone && hasPptx
  const canRetry =
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    (job.status === 'paused' && !job.session_id)
  const deleteJob = useDeleteJob()
  const retryJob = useRetryJob()
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
    setMenuOpen(false)
    setPreviewOpen(true)
  }

  const handleRetry = async (e: React.MouseEvent) => {
    stop(e)
    setMenuOpen(false)
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

  const errText =
    job.status === 'cancelled'
      ? '用户取消'
      : job.error_message?.trim()
  const showErr = (job.status === 'failed' || job.status === 'cancelled') && !!errText

  const displayErr =
    showErr && sharedErrorCount >= 2 && job.status === 'failed'
      ? `相同错误（共 ${sharedErrorCount} 个作品）`
      : errText

  const metaText = fmtJobMetaLine(job)
  const styles = CARD_STYLES[size]
  const promptSummary = truncate(job.prompt, styles.promptLen)

  return (
    <article
      className={cn(
        `group relative border bg-white shadow-sm transition-all
                  hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900`,
        styles.shell,
        compact && 'flex h-full min-h-0 flex-col overflow-hidden',
        menuOpen ? 'z-30' : '',
        job.status === 'running'
          ? 'border-l-[3px] border-l-gemini-500 border-slate-200 dark:border-slate-700'
          : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <Link to={`/jobs/${job.id}`} className={cn('block', compact && 'flex min-h-0 flex-1 flex-col')}>
        <div
          className={cn(
            'relative overflow-hidden bg-slate-100 dark:bg-slate-800',
            compact ? 'min-h-0 flex-1' : coverAspect,
            styles.cover,
          )}
        >
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
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteJob.isPending}
                className="rounded-full p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
                title="删除"
                aria-label="删除"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
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

          {canRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retryJob.isPending}
              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gemini-700 shadow-sm backdrop-blur hover:bg-white disabled:opacity-50 dark:bg-slate-900/90 dark:text-gemini-300"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              重试
            </button>
          )}
        </div>
      </Link>

      <div className={cn(styles.body, compact && 'shrink-0')}>
        <div className="flex items-center gap-2">
          <Link
            to={`/jobs/${job.id}`}
            className={cn('min-w-0 flex-1 truncate font-medium hover:text-gemini-600', styles.title)}
            title={job.project_name || '(未命名)'}
          >
            {job.project_name || '(未命名)'}
          </Link>
          <StatusPill status={job.status} />
        </div>

        <div className="mt-1 flex items-center gap-2">
          <p
            className={cn('min-w-0 flex-1 truncate text-slate-400 dark:text-slate-500', styles.meta)}
            title={metaText}
          >
            {metaText}
          </p>
          <QueueBadge position={job.queue_position} />
          <div className="relative shrink-0" ref={menuRef}>
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
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {isDone && (
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    预览
                  </button>
                )}
                {showDownload && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    下载 PPTX
                  </button>
                )}
                {isDone && hasPptx && (
                  <Link
                    to={`/jobs/${job.id}/edit`}
                    className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                    }}
                  >
                    编辑修改
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteJob.isPending}
                  className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-900/20"
                >
                  删除
                </button>
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
              </div>
            )}
          </div>
        </div>

        {!compact && promptSummary && (
          <p
            className={cn('mt-1 truncate text-slate-400/90 dark:text-slate-500', styles.meta)}
            title={job.prompt}
          >
            {promptSummary}
          </p>
        )}

        {showErr && (
          <p
            className={cn('mt-1 truncate text-rose-500/80 dark:text-rose-400/80', styles.meta)}
            title={errText}
          >
            {displayErr}
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
