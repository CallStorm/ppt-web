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
  total?: number
  limit?: number
  offset?: number
}

export interface JobStatsResponse {
  all: number
  running: number
  paused: number
  done: number
  failed: number
}

export interface Slide {
  index: number
  name: string
  image_url: string
  has_notes: boolean
  notes_url: string | null
}

export interface JobSlidesResponse {
  slides: Slide[]
}

// ---------------------------------------------------------------------------
// Revisions (post-completion modifications)
// ---------------------------------------------------------------------------

export interface EditTargetSlide {
  index: number
  name: string
  image_url: string
  current_note: string
}

export interface EditTargetsResponse {
  editable: boolean
  reason: string | null
  session_id: string | null
  pptx_path: string | null
  project_dir: string | null
  slides: EditTargetSlide[]
  spec_summary: SpecSummary | null
  job_options: Record<string, unknown> | null
}

export interface SpecSummary {
  visual_style: string | null
  colors: Record<string, string>
  typography: Record<string, string>
  page_count: number
  has_spec_lock?: boolean
}

export type GlobalRevisionKind =
  | 'colors'
  | 'typography'
  | 'visual_style'
  | 'content'
  | 'custom'

export type ContentPreset = 'concise' | 'formal' | 'translate_en' | 'glossary'

export interface GlobalRevision {
  kind: GlobalRevisionKind
  color_changes?: Record<string, string> | null
  font_family?: string | null
  visual_style?: string | null
  content_preset?: ContentPreset | null
  comment?: string | null
}

export interface RevisionRequest {
  mode: 'per_page' | 'global'
  items?: RevisionItem[] | null
  global_revision?: GlobalRevision | null
}

export interface RevisionItem {
  slide_index: number
  comment: string
}

export interface PostRevisionResponse {
  revision_job_id: string
  status: string
}

export interface RevisionEntry {
  job_id: string
  is_self: boolean
  is_latest: boolean
  status: JobStatus
  created_at: string | null
  pptx_url: string | null
  preview_url: string | null
  comments: RevisionItem[]
  revision_mode?: 'per_page' | 'global' | null
  global_summary?: string | null
}

export interface RevisionsListResponse {
  items: RevisionEntry[]
}

export interface SseEvent {
  type: string
  payload: Record<string, unknown>
  seq: number
  ts?: Date
}

// ---------------------------------------------------------------------------
// Conversations (chat-based PPT creation)
// ---------------------------------------------------------------------------

export type ConversationPhase =
  | 'intake'
  | 'requirements'
  | 'outline'
  | 'style'
  | 'generating'
  | 'done'

export type ConversationStatus = 'planning' | 'generating' | 'done' | 'failed'

export interface OutlineItem {
  id: string
  title: string
  bullets: string[]
}

export interface ChatRequirements {
  page_count: number
  scenario: string
  need_images: boolean
  dynamic_answers: Array<{ question: string; answer: string }>
  extra_notes: string
}

export interface ChatDraft {
  core_topic: string
  requirements: ChatRequirements
  outline: OutlineItem[]
  key_points: string[]
  options: Record<string, unknown>
  template: { kind: string; id: string } | null
  uploads: Array<{ name: string; path: string }>
  phase_completed: {
    requirements: boolean
    outline: boolean
    style: boolean
  }
}

export interface ChatWidget {
  type: string
  editable?: boolean
  can_generate?: boolean
  job_id?: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  payload: {
    widgets?: ChatWidget[]
    type?: string
    action?: string
    snapshot?: Record<string, unknown>
    job_id?: string
    pptx_url?: string
    intent?: string
    uploads?: string[]
  }
  created_at: string | null
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  mode: string
  status: ConversationStatus
  phase: ConversationPhase
  draft: ChatDraft
  job_id: string | null
  job?: { id: string; status: string; pptx_path: string | null }
  created_at: string | null
  updated_at: string | null
  messages?: ChatMessage[]
}

export interface ConversationListResponse {
  conversations: Conversation[]
  total: number
  limit: number
  offset: number
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
