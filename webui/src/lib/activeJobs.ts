import type { Conversation, Job } from '../api/types'
import { isActiveJobStatus } from '../stores/mascotStore'

export function jobIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/jobs\/([^/]+)/)
  if (!m) return null
  const id = m[1]
  if (id === 'new' || id === 'beautify') return null
  return id
}

export function chatIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/chat\/([^/]+)/)
  return m?.[1] ?? null
}

export function collectActiveJobIds(
  jobs: Job[] | undefined,
  conversations: Conversation[] | undefined,
): string[] {
  const ids = new Set<string>()

  for (const job of jobs ?? []) {
    if (isActiveJobStatus(job.status)) ids.add(job.id)
  }

  for (const conv of conversations ?? []) {
    if (conv.job_id && (conv.status === 'generating' || conv.status === 'failed')) {
      ids.add(conv.job_id)
    }
  }

  return [...ids]
}

export function pickDisplayJobId(
  ids: string[],
  rotateIndex: number,
  preferredId?: string | null,
): string | null {
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]!

  if (preferredId && ids.includes(preferredId)) {
    const prefIdx = ids.indexOf(preferredId)
    return ids[(prefIdx + rotateIndex) % ids.length]!
  }

  return ids[rotateIndex % ids.length]!
}
