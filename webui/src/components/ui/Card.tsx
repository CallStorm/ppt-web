import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const variants = {
  default: 'border border-border bg-surface-elevated shadow-[var(--shadow-panel)]',
  elevated: 'border border-border bg-surface-elevated shadow-md',
  highlight: 'border-2 border-primary/25 bg-primary-muted/30',
  ghost: 'border border-transparent bg-transparent',
} as const

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof variants
  padding?: 'none' | 'sm' | 'md' | 'lg'
  children: ReactNode
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export const panelClassName = cn(
  'rounded-[var(--radius-panel)] border border-border bg-surface-elevated shadow-[var(--shadow-panel)]',
  paddingMap.md,
)

export function Card({
  className,
  variant = 'default',
  padding = 'md',
  children,
  ...props
}: Props) {
  return (
    <div
      className={cn('rounded-[var(--radius-panel)]', variants[variant], paddingMap[padding], className)}
      {...props}
    >
      {children}
    </div>
  )
}
