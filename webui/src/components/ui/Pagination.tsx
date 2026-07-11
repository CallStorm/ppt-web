import { Button } from './Button'
import { cn } from '../../lib/cn'

type Props = {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
  loading?: boolean
  className?: string
}

export function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
  loading = false,
  className,
}: Props) {
  if (pageCount <= 1) return null

  const atFirst = page <= 1
  const atLast = page >= pageCount

  return (
    <nav
      className={cn('mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-between', className)}
      aria-label="作品列表分页"
    >
      <p className="text-xs text-muted-fg">
        第 {page} / {pageCount} 页 · 共 {total} 条
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="hidden sm:inline-flex"
          disabled={atFirst || loading}
          onClick={() => onPageChange(1)}
        >
          首页
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={atFirst || loading}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={atLast || loading}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="hidden sm:inline-flex"
          disabled={atLast || loading}
          onClick={() => onPageChange(pageCount)}
        >
          末页
        </Button>
      </div>
    </nav>
  )
}
