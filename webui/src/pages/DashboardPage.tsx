import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { JobCard } from '../components/jobs/JobCard'
import { SkeletonCard } from '../components/jobs/SkeletonCard'
import {
  StatusFilter,
  type StatusFilterCounts,
  type StatusFilterValue,
} from '../components/jobs/StatusFilter'
import { useJobStats, useJobsPage } from '../hooks/useJobs'
import {
  useDashboardViewport,
  useJobGridLayout,
  JOB_GRID_SIDE_PADDING,
} from '../hooks/useResponsivePageSize'
import type { Job } from '../api/types'
import { truncate } from '../lib/format'
import { resetMainScroll } from '../lib/scrollMain'
import { PageShell } from '../components/ui/PageShell'
import { CreatePptDropdown } from '../components/layout/CreatePptDropdown'
import { Input } from '../components/ui/Input'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Pagination } from '../components/ui/Pagination'
import { cn } from '../lib/cn'

type Filter = StatusFilterValue

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

const EMPTY_STATS: StatusFilterCounts = {
  all: 0,
  running: 0,
  paused: 0,
  done: 0,
  failed: 0,
}

export function DashboardPage() {
  const { pageSize, cardSize, gridClass, coverAspect } = useJobGridLayout()
  const pageGutter = `mx-auto flex w-full min-h-0 flex-1 flex-col ${JOB_GRID_SIDE_PADDING}`
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearchQ(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const jobsQ = useJobsPage({ page, pageSize, filter, q: searchQ })
  const statsQ = useJobStats()

  const jobs = jobsQ.data?.jobs ?? []
  const total = jobsQ.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const isLoading = jobsQ.isPending || (jobsQ.isFetching && jobs.length === 0)
  const isFetching = jobsQ.isFetching

  const statusCounts = useMemo<StatusFilterCounts>(() => {
    const s = statsQ.data
    if (!s) return EMPTY_STATS
    return {
      all: s.all,
      running: s.running,
      paused: s.paused,
      done: s.done,
      failed: s.failed,
    }
  }, [statsQ.data])

  const errorGroups = useMemo(() => groupFailedErrors(jobs), [jobs])

  const systemicError = useMemo(() => {
    for (const [msg, count] of errorGroups) {
      if (count >= 2) return { msg, count }
    }
    return null
  }, [errorGroups])

  const hasActiveFilter = filter !== 'all' || searchQ.trim().length > 0
  const pausedCount = statusCounts.paused
  const hasAnyJobs = (statsQ.data?.all ?? 0) > 0
  const showPausedAlert = pausedCount > 0
  const showErrorAlert = systemicError != null && !bannerDismissed
  const alertCount = (showPausedAlert ? 1 : 0) + (showErrorAlert ? 1 : 0)
  const { pageHeightClass, gridStyle } = useDashboardViewport(alertCount)

  useEffect(() => {
    setPage(1)
  }, [filter, searchQ])

  const handleFilterChange = (next: Filter) => {
    setFilter(next)
    setPage(1)
  }

  const jobGrid = (content: ReactNode) => (
    <div className={gridClass} style={gridStyle}>
      {content}
    </div>
  )

  useEffect(() => {
    if (!isLoading && jobs.length === 0 && page > 1 && total > 0) {
      setPage((p) => Math.max(1, p - 1))
    }
  }, [isLoading, jobs.length, page, total])

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  const clearFilters = () => {
    setFilter('all')
    setQuery('')
    setPage(1)
  }

  const handlePageChange = (next: number) => {
    setPage(next)
    resetMainScroll()
  }

  const listError =
    jobsQ.isError && jobsQ.error instanceof Error
      ? jobsQ.error.message
      : jobsQ.isError
        ? '加载作品列表失败'
        : null

  return (
    <PageShell width="full" className={cn('overflow-hidden px-0 py-4 sm:px-0', pageHeightClass)}>
      <div className={pageGutter}>
        <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              我的作品
              <span className="ml-2 text-sm font-normal text-muted-fg">
                ({hasActiveFilter ? `${total} 条匹配` : `共 ${total} 条`})
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
            <StatusFilter value={filter} onChange={handleFilterChange} counts={statusCounts} />
          </div>
        </div>

        {listError && (
          <Alert
            variant="error"
            className="mb-3 shrink-0"
            actions={
              <Button type="button" size="sm" onClick={() => jobsQ.refetch()}>
                重试
              </Button>
            }
          >
            {listError}
          </Alert>
        )}

        {showPausedAlert && (
          <Alert
            variant="warning"
            className="mb-3 shrink-0"
            actions={
              <Button
                type="button"
                size="sm"
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => handleFilterChange('paused')}
              >
                查看待确认
              </Button>
            }
          >
            你有 {pausedCount} 个作品等待确认，需处理后才能继续生成。
          </Alert>
        )}

        {showErrorAlert && systemicError && (
          <Alert
            variant="error"
            className="mb-3 shrink-0"
            actions={
              <>
                <Button
                  type="button"
                  size="sm"
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  onClick={() => handleFilterChange('failed')}
                >
                  只看失败
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setBannerDismissed(true)}
                  aria-label="关闭提示"
                >
                  ×
                </Button>
              </>
            }
          >
            <span className="font-medium">{systemicError.count} 个作品</span>
            因同一原因失败：{truncate(systemicError.msg, 80)}
          </Alert>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            jobGrid(
              Array.from({ length: pageSize }).map((_, i) => (
                <SkeletonCard key={i} size={cardSize} compact coverAspect={coverAspect} />
              )),
            )
          ) : jobs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-slate-400">
                {!hasAnyJobs
                  ? '还没有作品'
                  : searchQ.trim()
                    ? `没有匹配「${searchQ.trim()}」的作品`
                    : '没有匹配的作品'}
              </p>
              {!hasAnyJobs ? (
                <>
                  <p className="mt-2 max-w-sm text-xs text-slate-400">
                    点击「新建 PPT」选择制作方式。
                  </p>
                  <div className="mt-4 flex justify-center">
                    <CreatePptDropdown pathname="" variant="hero" />
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
              {jobGrid(
                jobs.map((job) => {
                  const err = job.error_message?.trim()
                  const sharedErrorCount =
                    job.status === 'failed' && err ? (errorGroups.get(err) ?? 0) : 0
                  return (
                    <JobCard
                      key={job.id}
                      job={job}
                      size={cardSize}
                      compact
                      coverAspect={coverAspect}
                      sharedErrorCount={sharedErrorCount}
                    />
                  )
                }),
              )}
            </>
          )}
        </div>

        {!isLoading && jobs.length > 0 && (
          <Pagination
            className="mt-3 shrink-0"
            page={page}
            pageCount={pageCount}
            total={total}
            onPageChange={handlePageChange}
            loading={isFetching}
          />
        )}
      </div>
    </PageShell>
  )
}
