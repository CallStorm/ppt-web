import { statusLabel } from '../../lib/format'
import type { JobStatus } from '../../api/types'

const STATUS_CLASS: Record<JobStatus, string> = {
  queued: 'status-queued',
  running: 'status-running',
  paused: 'status-paused',
  done: 'status-done',
  failed: 'status-failed',
  cancelled: 'status-cancelled',
}

export function StatusPill({ status }: { status: JobStatus | string }) {
  const cls = STATUS_CLASS[status as JobStatus] || 'status-queued'
  const isRunning = status === 'running'
  return (
    <span className={`status-pill ${cls}${isRunning ? ' status-running-pulse' : ''}`}>
      {isRunning && <span className="status-running-dot" />}
      {statusLabel(status)}
    </span>
  )
}
