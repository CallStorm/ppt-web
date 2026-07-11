import { useCallback, useState } from 'react'
import { useJob } from '../../../hooks/useJobs'
import { useJobEvents } from '../../../hooks/useJobEvents'
import type { SseEvent } from '../../../api/types'
import { StatusPill } from '../../jobs/StatusPill'

const STAGES = [
  '1 解析素材',
  '2 建项目',
  '3 策略规划',
  '5 生图',
  '6 逐页生成 SVG',
  '7 质检',
  '8 后处理',
  '8 导出 PPTX',
]

type Props = {
  jobId: string
}

export function JobProgressCard({ jobId }: Props) {
  const { data: job, refetch } = useJob(jobId)
  const [stage, setStage] = useState<Record<string, unknown> | null>(null)
  const [lastAgent, setLastAgent] = useState('')

  const onEvent = useCallback(
    (ev: SseEvent) => {
      if (ev.type === 'stage') setStage(ev.payload)
      if (ev.type === 'agent_text' && ev.payload.text) {
        setLastAgent(String(ev.payload.text))
      }
      if (ev.type === 'status' || ev.type === 'pptx') refetch()
    },
    [refetch],
  )

  const { sseStatus } = useJobEvents(jobId, onEvent)

  const stageIdx = stage
    ? STAGES.findIndex(
        (s) => s === String(stage.stage || stage.name) || s.startsWith(String(stage.stage)),
      )
    : -1

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">生成进度</h3>
        {job && <StatusPill status={job.status} />}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        SSE: {sseStatus === 'connected' ? '已连接' : sseStatus === 'error' ? '重连中' : '连接中'}
      </p>

      {stageIdx >= 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                i <= stageIdx
                  ? 'bg-gemini-100 text-gemini-800 dark:bg-gemini-900/40 dark:text-gemini-200'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {lastAgent && (
        <p className="mt-3 max-h-24 overflow-y-auto text-xs text-slate-600 dark:text-slate-400">
          {lastAgent.slice(-400)}
        </p>
      )}

      {job?.error_message && (
        <p className="mt-2 text-xs text-rose-600">{job.error_message}</p>
      )}
    </div>
  )
}
