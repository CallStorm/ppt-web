import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/jobs/JobCard'
import { SkeletonCard } from '../components/jobs/SkeletonCard'
import { StatusFilter, type StatusFilterValue } from '../components/jobs/StatusFilter'
import { useJobs } from '../hooks/useJobs'
import type { Job } from '../api/types'

type Filter = StatusFilterValue

function matchesFilter(job: Job, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return job.status === 'running' || job.status === 'queued' || job.status === 'paused'
  if (filter === 'done') return job.status === 'done'
  if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled'
  return true
}

export function DashboardPage() {
  const { data: jobs = [], isLoading } = useJobs()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter((j) => {
      if (!matchesFilter(j, filter)) return false
      if (!q) return true
      return (
        (j.project_name || '').toLowerCase().includes(q) ||
        (j.prompt || '').toLowerCase().includes(q)
      )
    })
  }, [jobs, filter, query])

  const reduced = filtered.length !== jobs.length

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            我的作品
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({reduced ? `${filtered.length}/${jobs.length}` : jobs.length})
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索作品…"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-gemini-500 focus:outline-none sm:w-56 dark:border-slate-700 dark:bg-slate-800"
          />
          <StatusFilter value={filter} onChange={setFilter} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-slate-400">
            {jobs.length === 0 ? '还没有作品' : '没有匹配的作品'}
          </p>
          {jobs.length === 0 && (
            <Link
              to="/jobs/new"
              className="mt-4 rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700"
            >
              创建
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}
