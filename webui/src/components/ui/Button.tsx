import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const variants = {
  primary:
    'theme-btn-primary bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-50',
  secondary:
    'border border-border bg-surface-elevated text-foreground hover:bg-primary-muted/30',
  outline:
    'border border-primary/30 bg-primary-muted/40 text-primary hover:bg-primary-muted',
  accent:
    'border border-accent/30 bg-accent-muted/50 text-accent hover:bg-accent-muted',
  ghost:
    'text-muted-fg hover:bg-primary-muted/25 hover:text-foreground',
  danger:
    'bg-danger text-white hover:bg-danger-hover disabled:opacity-50',
  link: 'text-primary hover:underline p-0 h-auto',
} as const

const sizes = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
} as const

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'primary', size = 'md', fullWidth, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        variant !== 'link' && sizes[size],
        variant !== 'link' && 'rounded-[var(--radius-control)]',
        variants[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  )
})
