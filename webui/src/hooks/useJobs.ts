import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Job, JobListResponse, JobSlidesResponse } from '../api/types'

export const JOBS_KEY = ['jobs'] as const
export const jobKey = (id: string) => ['job', id] as const
export const jobSlidesKey = (id: string) => ['job', id, 'slides'] as const

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

export function useJobSlides(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: jobSlidesKey(jobId ?? ''),
    queryFn: () => api<JobSlidesResponse>('GET', `/api/jobs/${jobId}/slides`),
    enabled: !!jobId && enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useJobSlideNotes(
  jobId: string | undefined,
  slideIndex: number | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['job', jobId, 'slides', slideIndex, 'notes'],
    queryFn: () => api<string>('GET', `/api/jobs/${jobId}/slides/${slideIndex}/notes`),
    enabled: !!jobId && slideIndex !== undefined && enabled,
    staleTime: 5 * 60 * 1000,
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

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; deleted: boolean }>('DELETE', `/api/jobs/${id}`),
    onSuccess: (_data, id) => {
      qc.setQueryData(JOBS_KEY, (old: Job[] | undefined) =>
        old ? old.filter((j) => j.id !== id) : [],
      )
      qc.removeQueries({ queryKey: jobKey(id) })
    },
  })
}

export function useRetryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>('POST', `/api/jobs/${id}/retry`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: JOBS_KEY })
      qc.invalidateQueries({ queryKey: jobKey(id) })
    },
  })
}
