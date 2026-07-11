import { useEffect, useMemo, useState, type CSSProperties } from 'react'

/** 固定每页 6 条：两行三列 */
export const JOBS_PAGE_SIZE = 6

export type JobCardSize = 'sm' | 'md' | 'lg' | 'xl'

export type CoverAspect = 'aspect-video' | 'aspect-[4/3]'

const HEADER_PX = 56 // h-14
const PAGE_PY_PX = 32 // py-4 × 2
const TOOLBAR_PX = 76
const PAGINATION_PX = 44
const ALERT_PX = 68
const ALERT_GAP_PX = 12
const GRID_GAP_BUFFER_PX = 20

export function cardSizeForWidth(width: number): JobCardSize {
  if (width < 640) return 'sm'
  if (width < 1024) return 'md'
  if (width < 1920) return 'lg'
  return 'xl'
}

/** 左右对称留白（略宽，与 ForgeBot 区域视觉平衡） */
export const JOB_GRID_SIDE_PADDING =
  'px-16 sm:px-24 md:px-28 lg:px-32 xl:px-40 2xl:px-44'

export const COVER_ASPECT_CLASS: CoverAspect = 'aspect-[4/3]'

export function useJobGridLayout() {
  const [cardSize, setCardSize] = useState<JobCardSize>(() =>
    typeof window !== 'undefined' ? cardSizeForWidth(window.innerWidth) : 'md',
  )

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setCardSize(cardSizeForWidth(window.innerWidth))
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return {
    pageSize: JOBS_PAGE_SIZE,
    cardSize,
    coverAspect: COVER_ASPECT_CLASS,
    gridWrapperClass: `mx-auto w-full ${JOB_GRID_SIDE_PADDING}`,
    gridClass:
      'grid h-full min-h-0 w-full grid-cols-3 grid-rows-2 gap-2 sm:gap-3 md:gap-4 lg:gap-5',
  }
}

export function useDashboardViewport(alertCount: number) {
  const [gridHeight, setGridHeight] = useState<number | null>(null)

  useEffect(() => {
    const compute = () => {
      const alerts = alertCount * (ALERT_PX + ALERT_GAP_PX)
      const available =
        window.innerHeight -
        HEADER_PX -
        PAGE_PY_PX -
        TOOLBAR_PX -
        alerts -
        PAGINATION_PX -
        GRID_GAP_BUFFER_PX
      setGridHeight(Math.max(180, available))
    }

    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [alertCount])

  const gridStyle: CSSProperties | undefined = useMemo(
    () =>
      gridHeight != null
        ? {
            height: gridHeight,
            gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          }
        : undefined,
    [gridHeight],
  )

  return {
    pageHeightClass: 'flex min-h-0 h-[calc(100dvh-3.5rem)] flex-col',
    gridStyle,
    coverAspect: COVER_ASPECT_CLASS,
  }
}

/** @deprecated Use useJobGridLayout().pageSize */
export function useResponsivePageSize(): number {
  return JOBS_PAGE_SIZE
}
