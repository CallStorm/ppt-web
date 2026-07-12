import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CREATE_PPT_ENTRIES, isCreatePptRoute } from '../../lib/createPptEntries'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'

type Props = {
  pathname: string
  variant?: 'header' | 'hero'
  className?: string
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('transition-transform', open && 'rotate-180')}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function CreatePptDropdown({ pathname, variant = 'header', className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isHero = variant === 'hero'
  const isActive = isCreatePptRoute(pathname)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      <Button
        type="button"
        variant="primary"
        size={isHero ? 'lg' : 'md'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="新建 PPT"
        className={cn(
          'gap-1.5 shadow-sm',
          isActive && 'ring-2 ring-primary/30',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span>+ 新建 PPT</span>
        <ChevronDown open={open} />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="新建 PPT 方式"
          className={cn(
            'absolute left-0 top-full z-40 mt-1 rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-1 shadow-lg',
            isHero ? 'min-w-[280px]' : 'min-w-[240px]',
          )}
        >
          {CREATE_PPT_ENTRIES.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              role="menuitem"
              className={cn(
                'flex items-start gap-3 rounded-[var(--radius-control)] px-3 py-2.5 transition-colors',
                item.match(pathname)
                  ? 'bg-primary-muted text-primary'
                  : 'text-foreground hover:bg-primary-muted/40',
              )}
              onClick={() => setOpen(false)}
            >
              <span className="mt-0.5 text-base leading-none" aria-hidden>
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted-fg">{item.description}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
