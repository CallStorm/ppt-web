import { create } from 'zustand'
import type { JobStatus } from '../api/types'
import type { MascotMood } from '../lib/jobStageCopy'

interface MascotState {
  jobId: string | null
  status: JobStatus | null
  stage: string | null
  speech: string
  mood: MascotMood
  dismissed: boolean
  setJob: (jobId: string | null, status?: JobStatus | null) => void
  setProgress: (patch: Partial<Pick<MascotState, 'stage' | 'speech' | 'mood' | 'status'>>) => void
  dismiss: () => void
  resetDismiss: () => void
  clear: () => void
}

const DISMISS_KEY = 'ppt.mascot.dismissed'

export const useMascotStore = create<MascotState>((set) => ({
  jobId: null,
  status: null,
  stage: null,
  speech: '',
  mood: 'hidden',
  dismissed: (() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })(),

  setJob: (jobId, status = null) => {
    if (!jobId) {
      set({ jobId: null, status: null, stage: null, speech: '', mood: 'hidden' })
      return
    }
    set({ jobId, status, mood: status === 'queued' ? 'idle' : 'working' })
  },

  setProgress: (patch) => set(patch),

  dismiss: () => {
    localStorage.setItem(DISMISS_KEY, '1')
    set({ dismissed: true, mood: 'hidden' })
  },

  resetDismiss: () => {
    localStorage.removeItem(DISMISS_KEY)
    set({ dismissed: false })
  },

  clear: () => set({ jobId: null, status: null, stage: null, speech: '', mood: 'hidden' }),
}))

export function isActiveJobStatus(status: JobStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'paused'
}
