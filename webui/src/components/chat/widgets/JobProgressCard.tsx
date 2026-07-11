import { useCallback, useState } from 'react'
import { useJob } from '../../../hooks/useJobs'
import { useJobEvents } from '../../../hooks/useJobEvents'
import type { SseEvent } from '../../../api/types'
import { PIPELINE_STAGES, stageFromEvent, stageIndex } from '../../../lib/jobStageCopy'
import { StatusPill } from '../../jobs/StatusPill'

type Props = {
  jobId: string
}

export function JobProgressCard({ jobId }: Props) {
  const { data: job, refetch } = useJob(jobId)
  const [stage, setStage] = useState<string | null>(null)
  const [lastAgent, setLastAgent] = useState('')

  const onEvent = useCallback(
    (ev: SseEvent) => {
      const next = stageFromEvent(ev)
      if (next) setStage(next)
      if (ev.type === 'agent_text' && ev.payload.text) {
        setLastAgent(String(ev.payload.text))
      }
      if (ev.type === 'status' || ev.type === 'pptx') refetch()
    },
    [refetch],
  )

  const { sseStatus } = useJobEvents(jobId, onEvent)

  const stageIdx = stageIndex(stage)

  return (
    <div className="mt-3 rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">生成进度</h3>
        {job && <StatusPill status={job.status} />}
      </div>
      <p className="mt-1 text-xs text-muted-fg">
        SSE: {sseStatus === 'connected' ? '已连接' : sseStatus === 'error' ? '重连中' : '连接中'}
      </p>

      {stageIdx >= 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {PIPELINE_STAGES.map((s, i) => (
            <span
              key={s}
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                i <= stageIdx
                  ? 'bg-primary-muted text-primary'
                  : 'bg-slate-100 text-muted-fg dark:bg-slate-800'
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {lastAgent && (
        <p className="mt-3 max-h-24 overflow-y-auto text-xs text-muted-fg">
          {lastAgent.slice(-400)}
        </p>
      )}

      {job?.error_message && (
        <p className="mt-2 text-xs text-danger">{job.error_message}</p>
      )}
    </div>
  )
}
