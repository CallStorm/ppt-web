import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Lottie from 'lottie-react'
import { useJob } from '../../hooks/useJobs'
import { useJobEvents } from '../../hooks/useJobEvents'
import { useConversation } from '../../hooks/useConversations'
import type { SseEvent } from '../../api/types'
import {
  moodFromStatus,
  stageFromEvent,
  stageToSpeech,
  type MascotMood,
} from '../../lib/jobStageCopy'
import { isActiveJobStatus, useMascotStore } from '../../stores/mascotStore'
import idleAnim from '../../assets/mascot/idle.json'
import talkingAnim from '../../assets/mascot/talking.json'
import celebrateAnim from '../../assets/mascot/celebrate.json'
import sadAnim from '../../assets/mascot/sad.json'

const MOOD_ANIM: Record<Exclude<MascotMood, 'hidden'>, object> = {
  idle: idleAnim,
  working: talkingAnim,
  celebrate: celebrateAnim,
  error: sadAnim,
}

function MascotBubble({ text }: { text: string }) {
  return (
    <div className="relative mb-2 max-w-[220px] rounded-2xl border border-border bg-surface-elevated/95 px-3 py-2 text-sm text-slate-800 shadow-lg backdrop-blur dark:text-slate-100">
      <p className="leading-snug">{text}</p>
      <span className="absolute -bottom-2 right-8 h-3 w-3 rotate-45 border-b border-r border-border bg-surface-elevated/95" />
    </div>
  )
}

type InnerProps = {
  jobId: string
}

function MascotForJob({ jobId }: InnerProps) {
  const { data: job, refetch } = useJob(jobId)
  const dismissed = useMascotStore((s) => s.dismissed)
  const setProgress = useMascotStore((s) => s.setProgress)
  const dismiss = useMascotStore((s) => s.dismiss)
  const [justFinished, setJustFinished] = useState(false)
  const [rotate, setRotate] = useState(0)
  const [speech, setSpeech] = useState('')
  const [stage, setStage] = useState<string | null>(null)
  const [mood, setMood] = useState<MascotMood>('idle')

  const status = job?.status ?? null

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
    if (status === 'done') setJustFinished(true)
  }, [status])

  useEffect(() => {
    if (!status) return
    const nextMood = moodFromStatus(status)
    const nextSpeech = stageToSpeech(stage, status, job?.queue_position ?? null, rotate)
    setMood(nextMood)
    setSpeech(nextSpeech)
    setProgress({ status, stage, speech: nextSpeech, mood: nextMood })
  }, [status, stage, job?.queue_position, rotate, setProgress])

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
    !dismissed &&
    status &&
    (isActiveJobStatus(status) || (justFinished && mood === 'celebrate') || mood === 'error')
  const anim = mood === 'hidden' ? idleAnim : MOOD_ANIM[mood]

  if (!visible || mood === 'hidden') return null

  return (
    <div className="pointer-events-auto fixed bottom-24 right-6 z-40 flex flex-col items-end">
      {speech && <MascotBubble text={speech} />}
      <div className="relative">
        <Lottie animationData={anim} loop={mood !== 'celebrate'} className="h-28 w-28" />
        <button
          type="button"
          onClick={dismiss}
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
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
  const { id: jobIdParam } = useParams<{ id: string }>()
  const location = useLocation()
  const chatMatch = location.pathname.match(/^\/chat\/([^/]+)/)
  const chatId = chatMatch?.[1]
  const { data: conv } = useConversation(chatId)
  const setJob = useMascotStore((s) => s.setJob)

  const activeJobId = useMemo(() => {
    if (jobIdParam && location.pathname.startsWith('/jobs/')) return jobIdParam
    if (conv?.status === 'generating' && conv.job_id) return conv.job_id
    return null
  }, [jobIdParam, location.pathname, conv?.status, conv?.job_id])

  useEffect(() => {
    setJob(activeJobId)
  }, [activeJobId, setJob])

  if (!activeJobId) return null

  return <MascotForJob jobId={activeJobId} />
}
