import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Job, JobListResponse, JobSlidesResponse, JobStatsResponse } from '../api/types'
import type { StatusFilterValue } from '../components/jobs/StatusFilter'

export const JOBS_KEY = ['jobs'] as const
export const JOBS_PAGE_KEY = ['jobs', 'page'] as const
export const JOBS_STATS_KEY = ['jobs', 'stats'] as const
export const jobKey = (id: string) => ['job', id] as const
export const jobSlidesKey = (id: string) => ['job', id, 'slides'] as const

const LEGACY_PAGE_SIZE = 50

async function fetchJobsLegacy(): Promise<Job[]> {
  const data = await api<JobListResponse>(
    'GET',
    `/api/jobs?limit=${LEGACY_PAGE_SIZE}&offset=0`,
  )
  return data.jobs || []
}

export type JobsPageParams = {
  page: number
  pageSize: number
  filter: StatusFilterValue
  q: string
}

function buildJobsListUrl({ page, pageSize, filter, q }: JobsPageParams): string {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  })
  if (filter !== 'all') params.set('status', filter)
  const term = q.trim()
  if (term) params.set('q', term)
  return `/api/jobs?${params}`
}

export function invalidateJobLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: JOBS_KEY })
  qc.invalidateQueries({ queryKey: JOBS_PAGE_KEY })
  qc.invalidateQueries({ queryKey: JOBS_STATS_KEY })
}

export function useJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: fetchJobsLegacy,
    refetchInterval: 15000,
  })
}

export function useJobsPage(params: JobsPageParams) {
  const { page, pageSize, filter, q } = params
  const qTrim = q.trim()
  return useQuery({
    queryKey: [...JOBS_PAGE_KEY, page, pageSize, filter, qTrim],
    queryFn: () =>
      api<JobListResponse>(
        'GET',
        buildJobsListUrl({ page, pageSize, filter, q: qTrim }),
      ),
    staleTime: 0,
    refetchInterval: 15000,
  })
}

export function useJobStats() {
  return useQuery({
    queryKey: JOBS_STATS_KEY,
    queryFn: () => api<JobStatsResponse>('GET', '/api/jobs/stats'),
    refetchInterval: 15000,
  })
}

export function useJob(
  id: string | undefined,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: jobKey(id ?? ''),
    queryFn: () => api<Job>('GET', `/api/jobs/${id}`),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
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
    invalidateJobLists(qc)
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
      invalidateJobLists(qc)
    },
  })
}

export function useRetryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>('POST', `/api/jobs/${id}/retry`),
    onSuccess: (_data, id) => {
      invalidateJobLists(qc)
      qc.invalidateQueries({ queryKey: jobKey(id) })
    },
  })
}