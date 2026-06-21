import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Job } from '../../api/types'
import { colorFromId } from '../../lib/format'
import { downloadUrl } from '../../api/client'
import { StatusPill } from './StatusPill'
import { QueueBadge } from './QueueBadge'
import { confirmDialog } from '../../stores/modalStore'
import { useDeleteJob } from '../../hooks/useJobs'
import { notifyError, notifySuccess } from '../../stores/toastStore'

export function JobCard({ job }: { job: Job }) {
  const hasPptx = !!job.pptx_path
  const isDone = job.status === 'done'
  const showDownload = isDone && hasPptx
  const deleteJob = useDeleteJob()
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewOk, setPreviewOk] = useState(!!job.has_preview || isDone)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPreviewOk(!!job.has_preview || isDone)
  }, [job.has_preview, job.id, isDone])

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

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!hasPptx) return
    downloadUrl(`/api/jobs/${job.id}/pptx`, `${job.project_name || job.id}.pptx`)
  }

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpen((v) => !v)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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

  const gradientBg = `linear-gradient(135deg, ${colorFromId(job.id)}33, ${colorFromId(job.id)}11)`

  return (
    <article
      className={`group relative rounded-xl border bg-white shadow-sm transition-all
                  hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900
                  ${menuOpen ? 'z-30' : ''}
                  ${job.status === 'running' ? 'border-l-[3px] border-l-gemini-500 border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <Link to={`/jobs/${job.id}`} className="block">
        <div
          className="relative aspect-video overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800"
          style={{ background: gradientBg }}
        >
          {previewOk && (
            <img
              src={`/api/jobs/${job.id}/preview`}
              alt={job.project_name || '封面预览'}
              className="h-full w-full object-cover object-top"
              loading="lazy"
              onError={() => setPreviewOk(false)}
            />
          )}
        </div>
      </Link>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <Link
          to={`/jobs/${job.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:text-gemini-600"
        >
          {job.project_name || '(未命名)'}
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          {showDownload ? (
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md p-1.5 text-gemini-600 transition-colors hover:bg-gemini-100 dark:hover:bg-gemini-900/30"
              title="下载 PPTX"
              aria-label="下载 PPTX"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <StatusPill status={job.status} />
              <QueueBadge position={job.queue_position} />
            </div>
          )}

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
    </article>
  )
}
