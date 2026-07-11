import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useActiveJobs } from '../../hooks/useActiveJobs'
import { useJob } from '../../hooks/useJobs'
import { useJobEvents } from '../../hooks/useJobEvents'
import type { SseEvent } from '../../api/types'
import {
  moodFromStatus,
  stageFromEvent,
  stageToSpeech,
  type MascotMood,
} from '../../lib/jobStageCopy'
import { isActiveJobStatus, useMascotStore } from '../../stores/mascotStore'
import { MascotCharacter } from './MascotCharacter'
import { MascotProgress } from './MascotProgress'

const IDLE_SPEECH = [
  '我是 ForgeBot，\n随时帮你做 PPT～',
  '想创作？\n点上方「创建」\n或「对话创作」',
  '有任务在跑时，\n我会在这里报进度',
]

function MascotBubble({ text, subtitle }: { text: string; subtitle?: string }) {
  return (
    <div className="relative mb-2 w-[7rem] rounded-xl border border-border bg-surface-elevated/95 px-2.5 py-2.5 text-center text-xs leading-relaxed text-foreground shadow-lg backdrop-blur">
      {subtitle && (
        <p className="mb-1 break-words text-[10px] text-muted-fg">{subtitle}</p>
      )}
      <p className="whitespace-pre-line break-words">{text}</p>
      <span className="absolute -bottom-2 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-surface-elevated/95" />
    </div>
  )
}

function MascotShell({
  children,
  onHide,
  hideLabel = '收起助手',
}: {
  children: ReactNode
  onHide: () => void
  hideLabel?: string
}) {
  return (
    <div className="pointer-events-auto fixed bottom-24 right-6 z-40 flex flex-col items-end">
      {children}
      <div className="relative min-h-[7rem] min-w-[7rem]">
        <MascotCharacter mood="idle" />
        <button
          type="button"
          onClick={onHide}
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary-muted text-[10px] text-muted-fg hover:bg-border"
          aria-label={hideLabel}
        >
          ×
        </button>
      </div>
    </div>
  )
}

function MascotIdle() {
  const setEnabled = useMascotStore((s) => s.setEnabled)
  const [rotate, setRotate] = useState(0)
  const speech = IDLE_SPEECH[rotate % IDLE_SPEECH.length]!

  useEffect(() => {
    const t = setInterval(() => setRotate((r) => r + 1), 6000)
    return () => clearInterval(t)
  }, [])

  return (
    <MascotShell onHide={() => setEnabled(false)} hideLabel="隐藏助手">
      <MascotBubble text={speech} />
    </MascotShell>
  )
}

type InnerProps = {
  jobId: string
  taskLabel?: string
}

function MascotForJob({ jobId, taskLabel }: InnerProps) {
  const { data: job, refetch, isLoading, isPending } = useJob(jobId, { refetchInterval: 5000 })
  const setProgress = useMascotStore((s) => s.setProgress)
  const dismiss = useMascotStore((s) => s.dismiss)
  const [justFinished, setJustFinished] = useState(false)
  const [rotate, setRotate] = useState(0)
  const [speech, setSpeech] = useState('')
  const [stage, setStage] = useState<string | null>(null)
  const [mood, setMood] = useState<MascotMood>('idle')

  const status = job?.status ?? null
  const loading = isLoading || isPending

  const onEvent = useCallback(
    (ev: SseEvent) => {
      const nextStage = stageFromEvent(ev)
      if (nextStage) setStage(nextStage)
      if (ev.type === 'status' || ev.type === 'pptx') refetch()
      if (ev.type === 'error' && ev.payload.message) {
        setSpeech(String(ev.payload.message))
        setMood('error')
      }
    },
    [refetch],
  )

  useJobEvents(jobId, onEvent)

  useEffect(() => {
    setStage(null)
    setSpeech('')
    setJustFinished(false)
    setMood('idle')
    setRotate(0)
  }, [jobId])

  useEffect(() => {
    if (status === 'done') setJustFinished(true)
  }, [status])

  useEffect(() => {
    if (loading) {
      setMood('idle')
      setSpeech('正在连接任务进度…')
      return
    }
    if (!status) return
    const nextMood = moodFromStatus(status)
    const nextSpeech = stageToSpeech(stage, status, job?.queue_position ?? null, rotate)
    setMood(nextMood)
    setSpeech(nextSpeech)
    setProgress({ status, stage, speech: nextSpeech, mood: nextMood })
  }, [loading, status, stage, job?.queue_position, rotate, setProgress])

  useEffect(() => {
    if (!isActiveJobStatus(status)) return
    const t = setInterval(() => setRotate((r) => r + 1), 4000)
    return () => clearInterval(t)
  }, [status])

  useEffect(() => {
    if (!justFinished) return
    const t = setTimeout(() => setJustFinished(false), 3500)
    return () => clearTimeout(t)
  }, [justFinished])

  const visible =
    loading ||
    (status &&
      (isActiveJobStatus(status) ||
        (justFinished && mood === 'celebrate') ||
        mood === 'error'))

  if (!visible || mood === 'hidden') return null

  const displayMood = mood as Exclude<MascotMood, 'hidden'>

  return (
    <div className="pointer-events-auto fixed bottom-24 right-6 z-40 flex flex-col items-end">
      {speech && <MascotBubble text={speech} subtitle={taskLabel} />}
      <MascotProgress stage={stage} status={status} />
      <div className="relative min-h-[7rem] min-w-[7rem]">
        <MascotCharacter mood={displayMood} />
        <button
          type="button"
          onClick={dismiss}
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary-muted text-[10px] text-muted-fg hover:bg-border"
          aria-label="收起助手"
        >
          ×
        </button>
      </div>
      {mood === 'error' && jobId && (
        <Link to={`/jobs/${jobId}`} className="mt-1 text-xs text-primary hover:underline">
          查看详情
        </Link>
      )}
    </div>
  )
}

export function GenerationMascotHost() {
  const { displayJobId, activeJobIds, displayIndex } = useActiveJobs()
  const enabled = useMascotStore((s) => s.enabled)
  const dismissed = useMascotStore((s) => s.dismissed)
  const resetDismiss = useMascotStore((s) => s.resetDismiss)
  const setJob = useMascotStore((s) => s.setJob)
  const prevActiveCount = useRef(0)

  useEffect(() => {
    if (activeJobIds.length > 0 && prevActiveCount.current === 0) {
      resetDismiss()
    }
    prevActiveCount.current = activeJobIds.length
  }, [activeJobIds.length, resetDismiss])

  useEffect(() => {
    setJob(displayJobId)
  }, [displayJobId, setJob])

  if (!enabled) return null

  if (displayJobId && !dismissed) {
    const taskLabel =
      activeJobIds.length > 1
        ? `${displayIndex + 1}/${activeJobIds.length} · ${displayJobId.slice(0, 8)}…`
        : undefined
    return <MascotForJob jobId={displayJobId} taskLabel={taskLabel} />
  }

  if (!displayJobId) {
    return <MascotIdle />
  }

  return null
}
