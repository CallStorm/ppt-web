export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled'

// JobOptions 的真实定义在 lib/jobOptions.ts；这里 re-export 保持单一来源。
// 老代码 `import type { JobOptions } from '../api/types'` 仍然可用。
import type { JobOptions } from '../lib/jobOptions'
export type { JobOptions }

export interface User {
  id: string
  email: string
  quota_credits: number
  role: 'user' | 'admin'
}

export interface JobUpload {
  name: string
  size: number | null
}

export interface Job {
  id: string
  user_id: string
  prompt: string
  project_name: string | null
  status: JobStatus
  session_id: string | null
  project_dir: string | null
  pptx_path: string | null
  cost_usd: number | null
  last_agent_text: string | null
  last_event_seq: number | null
  require_confirm: boolean
  options: JobOptions | null
  uploads: JobUpload[]
  error_message: string | null
  created_at: string | null
  updated_at: string | null
  queue_position: number | null
  has_preview?: boolean
}

export interface JobListResponse {
  jobs: Job[]
}

export interface SseEvent {
  type: string
  payload: Record<string, unknown>
  seq: number
  ts?: Date
}

export interface AdminOverview {
  runtime: {
    active_count: number
    active_job_ids: string[]
    queue_length: number
    max_concurrent_jobs: number
    server_pid: number
  }
  jobs: {
    total: number
    queued: number
    running: number
    paused: number
    done: number
    failed: number
    cancelled: number
  }
  users: { total: number; admins: number }
  recent_errors: Array<{ id: string; error_message: string | null; updated_at: string }>
}

export interface AdminUser {
  id: string
  email: string
  role: string
  quota_credits: number
  created_at: string
}

export interface AdminJob extends Job {
  user_email?: string
}
