import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Props = {
  children: ReactNode
  className?: string
  variant?: 'default' | 'primary' | 'accent'
}

const variants = {
  default: 'bg-slate-100 text-slate-600',
  primary: 'bg-primary-muted text-primary',
  accent: 'bg-accent-muted text-accent font-display',
}

export function Badge({ children, className, variant = 'default' }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
