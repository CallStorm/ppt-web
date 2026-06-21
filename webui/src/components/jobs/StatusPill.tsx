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
  const pulse = status === 'running' ? ' status-running-pulse' : ''
  return (
    <span className={`status-pill ${cls}${pulse}`}>{statusLabel(status)}</span>
  )
}
