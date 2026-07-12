import { api } from '../api/client'
import type { TemplateCatalogEntry } from './jobOptions'

export interface TemplateTask extends TemplateCatalogEntry {
  job_id?: string | null
  job_status?: string | null
  error_message?: string | null
  updated_at?: string | null
  source_job_id?: string | null
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  generating: '制作中',
  failed: '失败',
  ready: '已完成',
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '等待确认',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export function formatTaskUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export type SuggestSlugResponse = {
  slug: string
  base: string
  deduplicated: boolean
}

export async function suggestTemplateSlug(input: {
  slug: string
  kind: 'deck' | 'layout'
  scope: 'user' | 'global'
}): Promise<SuggestSlugResponse> {
  return api<SuggestSlugResponse>('POST', '/api/templates/suggest-slug', input)
}
