import type { JobStatus } from '../../api/types'
import { PIPELINE_STAGES, stageIndex } from '../../lib/jobStageCopy'
import { cn } from '../../lib/cn'

type Props = {
  stage: string | null
  status: JobStatus | null
}

function stageLabel(stage: string | null, status: JobStatus | null): string {
  if (status === 'queued' || !stage) return '准备中'
  const idx = stageIndex(stage)
  if (idx < 0) return '生成中'
  const raw = PIPELINE_STAGES[idx] ?? ''
  const name = raw.replace(/^\d+\s*/, '')
  return `${idx + 1}/${PIPELINE_STAGES.length} · ${name}`
}

export function MascotProgress({ stage, status }: Props) {
  const activeIdx =
    status === 'queued' || !stage ? 0 : Math.max(0, stageIndex(stage))

  return (
    <div className="mb-2 w-[7rem]">
      <div className="flex items-center justify-between gap-1">
        {PIPELINE_STAGES.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-300',
              i < activeIdx
                ? 'bg-primary'
                : i === activeIdx
                  ? 'bg-accent animate-pulse'
                  : 'bg-border',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] text-muted-fg">
        {stageLabel(stage, status)}
      </p>
    </div>
  )
}
