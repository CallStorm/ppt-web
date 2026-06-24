/** Loading placeholder matching JobCard's grid cell shape. */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="skeleton-shimmer aspect-video rounded-t-xl" />
      <div className="px-3 py-2.5">
        <div className="skeleton-shimmer h-3.5 w-2/3 rounded" />
        <div className="skeleton-shimmer mt-2 h-3 w-1/3 rounded" />
      </div>
    </div>
  )
}
