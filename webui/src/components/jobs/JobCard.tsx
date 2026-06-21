import { Link } from 'react-router-dom'
import type { Job } from '../../api/types'
import { avatarLetter, colorFromId, fmtCost, fmtTime, truncate } from '../../lib/format'
import { downloadUrl } from '../../api/client'
import { StatusPill } from './StatusPill'
import { QueueBadge } from './QueueBadge'

export function JobCard({ job }: { job: Job }) {
  const hasPptx = !!job.pptx_path
  const isRunning = job.status === 'running'

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!hasPptx) return
    downloadUrl(`/api/jobs/${job.id}/pptx`, `${job.project_name || job.id}.pptx`)
  }

  return (
    <Link
      to={`/jobs/${job.id}`}
      className={`group relative flex min-h-[148px] flex-col rounded-xl border bg-white p-4 shadow-sm transition-all
                  hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900
                  ${isRunning ? 'border-l-[3px] border-l-gemini-500 border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700'}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white shadow-sm"
          style={{ background: colorFromId(job.id) }}
        >
          {avatarLetter(job.project_name || job.id)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug">
              {job.project_name || '(未命名)'}
            </h3>
            {hasPptx && (
              <button
                type="button"
                onClick={handleDownload}
                className="shrink-0 rounded-md p-1 text-gemini-600 opacity-70 transition-opacity hover:bg-gemini-100 group-hover:opacity-100 dark:hover:bg-gemini-900/30"
                title="下载 PPTX"
                aria-label="下载 PPTX"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusPill status={job.status} />
            <QueueBadge position={job.queue_position} />
          </div>
        </div>
      </div>

      {job.prompt && (
        <p className="mt-3 line-clamp-2 flex-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {truncate(job.prompt, 100)}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800">
        <span>{fmtTime(job.updated_at)}</span>
        <span>{fmtCost(job.cost_usd)}</span>
      </div>
    </Link>
  )
}
