import { Link } from 'react-router-dom'
import {
  formatTaskUpdatedAt,
  JOB_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type TemplateTask,
} from '../../lib/templateTasks'
import { cn } from '../../lib/cn'

type Props = {
  task: TemplateTask
  onRetry: (task: TemplateTask) => void
  onDelete: (task: TemplateTask) => void
  retrying?: boolean
  deleting?: boolean
}

function statusBadgeClass(status: string | undefined) {
  if (status === 'failed') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
  }
  if (status === 'generating') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
}

export function TemplateTaskCard({
  task,
  onRetry,
  onDelete,
  retrying = false,
  deleting = false,
}: Props) {
  const isFailed = task.status === 'failed'
  const isDesyncFailed =
    task.status === 'generating' &&
    (task.job_status === 'failed' || task.job_status === 'cancelled')
  const canRetry = (isFailed || isDesyncFailed) && !!task.db_id
  const displayStatus = isDesyncFailed ? 'failed' : task.status
  const coverColor = task.primary_color || '#64748b'
  const jobStatusLabel = task.job_status
    ? JOB_STATUS_LABELS[task.job_status] || task.job_status
    : null

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div
        className="relative aspect-video w-full"
        style={{
          background: `linear-gradient(135deg, ${coverColor} 0%, ${coverColor}88 55%, #0f172a22 100%)`,
        }}
      >
        <span
          className={cn(
            'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
            statusBadgeClass(displayStatus),
          )}
        >
          {TASK_STATUS_LABELS[displayStatus || ''] || displayStatus}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3 py-3">
        <div>
          <h3 className="line-clamp-1 text-sm font-medium text-slate-900 dark:text-slate-100">
            {task.display_name || task.id}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {task.slug} · {task.kind === 'deck' ? '完整套版' : '结构版式'}
          </p>
        </div>

        <p className="text-[11px] text-slate-400">
          {formatTaskUpdatedAt(task.updated_at)}
          {jobStatusLabel && task.status === 'generating' ? ` · ${jobStatusLabel}` : ''}
        </p>

        {(isFailed || isDesyncFailed) && task.error_message && (
          <p className="line-clamp-2 text-xs text-rose-600 dark:text-rose-400">
            {task.error_message}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {task.job_id && (
            <Link
              to={`/jobs/${task.job_id}`}
              className="text-xs text-gemini-600 hover:underline"
            >
              查看进度
            </Link>
          )}
          {canRetry && (
            <>
              <button
                type="button"
                disabled={retrying || deleting}
                onClick={() => onRetry(task)}
                className="text-xs text-gemini-600 hover:underline disabled:opacity-50"
              >
                {retrying ? '重试中…' : '重试'}
              </button>
              <button
                type="button"
                disabled={retrying || deleting}
                onClick={() => onDelete(task)}
                className="text-xs text-rose-600 hover:underline disabled:opacity-50"
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  )
}

export function TemplateTaskCardSkeleton() {
  return (
    <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
  )
}
