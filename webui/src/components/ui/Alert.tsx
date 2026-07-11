import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

const variants = {
  info: 'border-border bg-primary-muted/20 text-foreground',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
} as const

type Props = {
  variant?: keyof typeof variants
  title?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}

export function Alert({ variant = 'info', title, children, className, actions }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-panel)] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        variants[variant],
        className,
      )}
    >
      <div>
        {title && <p className="text-sm font-medium">{title}</p>}
        <div className="text-sm">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}
