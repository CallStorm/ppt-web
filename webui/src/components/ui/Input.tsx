import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Props = InputHTMLAttributes<HTMLInputElement>

export const inputClassName = cn(
  'theme-input w-full rounded-[var(--radius-control)] border px-3 py-2 text-sm',
  'text-foreground placeholder:text-muted-fg',
  'transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClassName, className)} {...props} />
})
