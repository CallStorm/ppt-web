import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import {
  chatIdFromPath,
  collectActiveJobIds,
  jobIdFromPath,
  pickDisplayJobId,
} from '../lib/activeJobs'
import { useConversations } from './useConversations'
import { JOBS_KEY, useJobs } from './useJobs'

const ROTATE_MS = 8000
const FAST_POLL_MS = 5000

export function useActiveJobs() {
  const location = useLocation()
  const qc = useQueryClient()
  const { data: jobs } = useJobs()
  const { data: convData } = useConversations()
  const [rotateIndex, setRotateIndex] = useState(0)

  const conversations = convData?.conversations

  const activeJobIds = useMemo(
    () => collectActiveJobIds(jobs, conversations),
    [jobs, conversations],
  )

  const preferredId = useMemo(() => {
    const fromPath = jobIdFromPath(location.pathname)
    if (fromPath) return fromPath

    const chatId = chatIdFromPath(location.pathname)
    if (!chatId) return null
    return conversations?.find((c) => c.id === chatId)?.job_id ?? null
  }, [location.pathname, conversations])

  const displayJobId = useMemo(
    () => pickDisplayJobId(activeJobIds, rotateIndex, preferredId),
    [activeJobIds, rotateIndex, preferredId],
  )

  useEffect(() => {
    setRotateIndex(0)
  }, [activeJobIds.join(',')])

  useEffect(() => {
    if (activeJobIds.length <= 1) return
    const t = setInterval(() => setRotateIndex((i) => i + 1), ROTATE_MS)
    return () => clearInterval(t)
  }, [activeJobIds.length])

  useEffect(() => {
    if (activeJobIds.length === 0) return
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    }, FAST_POLL_MS)
    return () => clearInterval(t)
  }, [activeJobIds.length, qc])

  const displayIndex = displayJobId ? activeJobIds.indexOf(displayJobId) : -1

  return {
    activeJobIds,
    displayJobId,
    rotateIndex,
    displayIndex,
  }
}
