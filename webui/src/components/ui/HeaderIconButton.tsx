import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
}

export const HeaderIconButton = forwardRef<HTMLButtonElement, Props>(function HeaderIconButton(
  { className, active = false, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'bg-primary-muted text-primary hover:bg-primary-muted/80'
          : 'text-muted-fg hover:bg-primary-muted/40 hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
})
