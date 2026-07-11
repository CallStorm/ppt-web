import type { CoverAspect, JobCardSize } from '../../hooks/useResponsivePageSize'
import { cn } from '../../lib/cn'

const SKELETON_STYLES: Record<
  JobCardSize,
  { shell: string; cover: string; body: string; line: string }
> = {
  sm: { shell: 'rounded-lg', cover: 'rounded-t-lg', body: 'px-2 py-1.5', line: 'h-2' },
  md: { shell: 'rounded-xl', cover: 'rounded-t-xl', body: 'px-2.5 py-2', line: 'h-2.5' },
  lg: { shell: 'rounded-xl', cover: 'rounded-t-xl', body: 'px-3 py-2', line: 'h-2.5' },
  xl: { shell: 'rounded-2xl', cover: 'rounded-t-2xl', body: 'px-3 py-2.5', line: 'h-3' },
}

/** Loading placeholder matching JobCard's grid cell shape. */
export function SkeletonCard({
  size = 'md',
  compact = false,
  coverAspect = 'aspect-video',
}: {
  size?: JobCardSize
  compact?: boolean
  coverAspect?: CoverAspect
}) {
  const s = SKELETON_STYLES[size]
  return (
    <div
      className={cn(
        'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
        compact && 'flex h-full min-h-0 flex-col overflow-hidden',
        s.shell,
      )}
    >
      <div
        className={cn(
          'skeleton-shimmer',
          compact ? 'min-h-0 flex-1' : coverAspect,
          s.cover,
        )}
      />
      <div className={cn(s.body, compact && 'shrink-0')}>
        <div className={cn('skeleton-shimmer w-2/3 rounded', s.line)} />
        <div className={cn('skeleton-shimmer mt-1.5 w-1/2 rounded', s.line)} />
        {!compact && (
          <div className={cn('skeleton-shimmer mt-1.5 w-4/5 rounded', s.line)} />
        )}
      </div>
    </div>
  )
}
