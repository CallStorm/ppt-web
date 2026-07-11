import { create } from 'zustand'
import type { JobStatus } from '../api/types'
import type { MascotMood } from '../lib/jobStageCopy'

const ENABLED_KEY = 'ppt.mascot.enabled'

interface MascotState {
  jobId: string | null
  status: JobStatus | null
  stage: string | null
  speech: string
  mood: MascotMood
  enabled: boolean
  dismissed: boolean
  setJob: (jobId: string | null, status?: JobStatus | null) => void
  setProgress: (patch: Partial<Pick<MascotState, 'stage' | 'speech' | 'mood' | 'status'>>) => void
  setEnabled: (enabled: boolean) => void
  toggleEnabled: () => void
  dismiss: () => void
  resetDismiss: () => void
  init: () => void
  clear: () => void
}

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (raw === 'false') return false
    if (raw === 'true') return true
  } catch {
    /* ignore */
  }
  return true
}

function persistEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled))
  } catch {
    /* ignore */
  }
}

export const useMascotStore = create<MascotState>((set, get) => ({
  jobId: null,
  status: null,
  stage: null,
  speech: '',
  mood: 'hidden',
  enabled: true,
  dismissed: false,

  setJob: (jobId, status = null) => {
    if (!jobId) {
      set({ jobId: null, status: null, stage: null, speech: '', mood: 'hidden' })
      return
    }
    set({ jobId, status, mood: status === 'queued' ? 'idle' : 'working' })
  },

  setProgress: (patch) => set(patch),

  setEnabled: (enabled) => {
    persistEnabled(enabled)
    set({ enabled, dismissed: enabled ? false : get().dismissed })
  },

  toggleEnabled: () => {
    const next = !get().enabled
    persistEnabled(next)
    set({ enabled: next, dismissed: false })
  },

  dismiss: () => set({ dismissed: true }),

  resetDismiss: () => set({ dismissed: false }),

  init: () => {
    set({ enabled: readEnabled() })
  },

  clear: () => set({ jobId: null, status: null, stage: null, speech: '', mood: 'hidden' }),
}))

export function isActiveJobStatus(status: JobStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'paused'
}
