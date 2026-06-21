import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Job, JobListResponse } from '../api/types'

export const JOBS_KEY = ['jobs'] as const
export const jobKey = (id: string) => ['job', id] as const

async function fetchJobs(): Promise<Job[]> {
  const data = await api<JobListResponse>('GET', '/api/jobs')
  return data.jobs || []
}

export function useJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: fetchJobs,
    refetchInterval: 15000,
  })
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: jobKey(id ?? ''),
    queryFn: () => api<Job>('GET', `/api/jobs/${id}`),
    enabled: !!id,
  })
}

export function useUpsertJob() {
  const qc = useQueryClient()
  return (job: Job) => {
    qc.setQueryData(jobKey(job.id), job)
    qc.setQueryData(JOBS_KEY, (old: Job[] | undefined) => {
      if (!old) return [job]
      const idx = old.findIndex((j) => j.id === job.id)
      const next = idx >= 0 ? [...old] : [job, ...old]
      if (idx >= 0) next[idx] = job
      return next.sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
      )
    })
  }
}
