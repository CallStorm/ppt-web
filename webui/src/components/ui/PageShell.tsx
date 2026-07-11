import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Props = {
  children: ReactNode
  className?: string
  width?: '4xl' | '5xl' | '6xl' | '7xl'
  title?: string
  description?: string
  actions?: ReactNode
}

const widthMap = {
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
}

export function PageShell({
  children,
  className,
  width = '6xl',
  title,
  description,
  actions,
}: Props) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6', widthMap[width], className)}>
      {(title || actions) && (
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>}
            {description && (
              <p className="mt-1 text-sm text-muted-fg">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
