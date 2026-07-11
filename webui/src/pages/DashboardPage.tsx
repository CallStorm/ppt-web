import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/jobs/JobCard'
import { SkeletonCard } from '../components/jobs/SkeletonCard'
import {
  StatusFilter,
  type StatusFilterCounts,
  type StatusFilterValue,
} from '../components/jobs/StatusFilter'
import { useJobsInfinite } from '../hooks/useJobs'
import type { Job } from '../api/types'
import { truncate } from '../lib/format'
import { PageShell } from '../components/ui/PageShell'
import { Input } from '../components/ui/Input'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'

type Filter = StatusFilterValue

function matchesFilter(job: Job, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return job.status === 'running' || job.status === 'queued'
  if (filter === 'paused') return job.status === 'paused'
  if (filter === 'done') return job.status === 'done'
  if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled'
  return true
}

function computeStatusCounts(jobs: Job[]): StatusFilterCounts {
  return {
    all: jobs.length,
    running: jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
    paused: jobs.filter((j) => j.status === 'paused').length,
    done: jobs.filter((j) => j.status === 'done').length,
    failed: jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length,
  }
}

function groupFailedErrors(jobs: Job[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const j of jobs) {
    if (j.status !== 'failed') continue
    const msg = j.error_message?.trim()
    if (!msg) continue
    map.set(msg, (map.get(msg) ?? 0) + 1)
  }
  return map
}

export function DashboardPage() {
  const jobsQ = useJobsInfinite()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const jobs = useMemo(
    () => jobsQ.data?.pages.flatMap((p) => p.jobs ?? []) ?? [],
    [jobsQ.data],
  )
  const total = jobsQ.data?.pages[0]?.total ?? jobs.length
  const hasMore = jobs.length < total
  const isLoading = jobsQ.isLoading

  const statusCounts = useMemo(() => computeStatusCounts(jobs), [jobs])
  const errorGroups = useMemo(() => groupFailedErrors(jobs), [jobs])

  const systemicError = useMemo(() => {
    for (const [msg, count] of errorGroups) {
      if (count >= 2) return { msg, count }
    }
    return null
  }, [errorGroups])

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
  const hasActiveFilter = filter !== 'all' || query.trim().length > 0
  const pausedCount = statusCounts.paused

  const clearFilters = () => {
    setFilter('all')
    setQuery('')
  }

  return (
    <PageShell width="7xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            我的作品
            <span className="ml-2 text-sm font-normal text-muted-fg">
              ({reduced ? `${filtered.length}/${jobs.length}` : jobs.length}
              {total > jobs.length ? `，共 ${total} 条` : ''})
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索作品…"
            className="sm:w-56"
          />
          <StatusFilter value={filter} onChange={setFilter} counts={statusCounts} />
        </div>
      </div>

      {pausedCount > 0 && (
        <Alert
          variant="warning"
          className="mb-4"
          actions={
            <Button type="button" size="sm" className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => setFilter('paused')}>
              查看待确认
            </Button>
          }
        >
          你有 {pausedCount} 个作品等待确认，需处理后才能继续生成。
        </Alert>
      )}

      {systemicError && !bannerDismissed && (
        <Alert
          variant="error"
          className="mb-4"
          actions={
            <>
              <Button type="button" size="sm" className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => setFilter('failed')}>
                只看失败
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBannerDismissed(true)} aria-label="关闭提示">
                ×
              </Button>
            </>
          }
        >
          <span className="font-medium">{systemicError.count} 个作品</span>
          因同一原因失败：{truncate(systemicError.msg, 80)}
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-slate-400">
            {jobs.length === 0
              ? '还没有作品'
              : query.trim()
                ? `没有匹配「${query.trim()}」的作品`
                : '没有匹配的作品'}
          </p>
          {jobs.length === 0 ? (
            <>
              <p className="mt-2 max-w-sm text-xs text-slate-400">
                上传文档或输入主题，AI 将自动生成演示文稿。
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link
                  to="/jobs/new"
                  className="rounded-md bg-gemini-600 px-4 py-2 text-sm font-medium text-white hover:bg-gemini-700"
                >
                  创建
                </Link>
                <Link
                  to="/jobs/beautify"
                  className="rounded-md border border-gemini-200 px-4 py-2 text-sm font-medium text-gemini-700 hover:bg-gemini-50 dark:border-gemini-800 dark:text-gemini-200"
                >
                  美化 PPT
                </Link>
              </div>
            </>
          ) : hasActiveFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              清除搜索和筛选
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {filtered.map((job) => {
              const err = job.error_message?.trim()
              const sharedErrorCount =
                job.status === 'failed' && err ? (errorGroups.get(err) ?? 0) : 0
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  sharedErrorCount={sharedErrorCount}
                />
              )
            })}
          </div>
          {hasMore && !hasActiveFilter && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-xs text-slate-400">
                已加载 {jobs.length} / {total} 条
              </p>
              <button
                type="button"
                onClick={() => jobsQ.fetchNextPage()}
                disabled={jobsQ.isFetchingNextPage}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {jobsQ.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
