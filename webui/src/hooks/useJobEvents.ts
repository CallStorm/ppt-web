import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Job, SseEvent } from '../api/types'
import { JOBS_KEY, jobKey } from './useJobs'

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

function backoff(attempt: number): number {
  return Math.min(30000, [1000, 2000, 5000, 10000, 30000][attempt] || 30000)
}

export function useJobEvents(
  jobId: string | undefined,
  onEvent?: (ev: SseEvent) => void,
) {
  const qc = useQueryClient()
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!jobId) return

    let es: EventSource | null = null
    let retry = 0
    let lastSeq = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const upsertJob = (patch: Partial<Job>) => {
      qc.setQueryData(jobKey(jobId), (old: Job | undefined) => {
        if (!old) return old
        const updated = { ...old, ...patch, updated_at: new Date().toISOString() }
        qc.setQueryData(JOBS_KEY, (list: Job[] | undefined) => {
          if (!list) return list
          return list.map((j) => (j.id === jobId ? updated : j))
        })
        return updated
      })
    }

    const connect = () => {
      if (closed) return
      const url = `/api/jobs/${jobId}/events?from_seq=${lastSeq}`
      es = new EventSource(url)

      const handle =
        (type: string) =>
        (e: MessageEvent) => {
          setSseStatus('connected')
          let payload: Record<string, unknown> = {}
          try {
            payload = JSON.parse(e.data)
          } catch {
            /* ignore */
          }
          const seq = parseInt(e.lastEventId, 10) || 0
          if (seq && seq <= lastSeq) return
          if (seq) lastSeq = seq

          const ev: SseEvent = { type, payload, seq, ts: new Date() }

          if (type === 'status') {
            upsertJob({ status: payload.status as Job['status'] })
            if (TERMINAL.has(String(payload.status))) {
              setTimeout(() => es?.close(), 100)
            }
          } else if (type === 'pptx') {
            upsertJob({ pptx_path: String(payload.url || 'ready'), status: 'done' })
          } else if (type === 'result' && payload.cost_usd != null) {
            upsertJob({ cost_usd: payload.cost_usd as number })
          } else if (type === 'agent_text' && payload.text) {
            const text = String(payload.text)
            qc.setQueryData(jobKey(jobId), (old: Job | undefined) => {
              if (!old) return old
              if (old.last_agent_text && text.length < old.last_agent_text.length) return old
              return { ...old, last_agent_text: text }
            })
          }

          onEventRef.current?.(ev)
        }

      ;['status', 'stage', 'tool', 'agent_text', 'result', 'spec', 'error', 'pptx'].forEach(
        (t) => es!.addEventListener(t, handle(t)),
      )

      es.onerror = () => {
        if (closed) return
        const job = qc.getQueryData<Job>(jobKey(jobId))
        if (job && TERMINAL.has(job.status)) return
        if (es?.readyState === EventSource.CLOSED) {
          setSseStatus('error')
          retry += 1
          timer = setTimeout(connect, backoff(retry - 1))
        }
      }
    }

    connect()

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      es?.close()
    }
  }, [jobId, qc])

  return { sseStatus }
}
