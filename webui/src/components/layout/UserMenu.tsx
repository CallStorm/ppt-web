import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { cn } from '../../lib/cn'
import { Badge } from '../ui/Badge'
import { AppearancePicker } from '../ui/AppearancePicker'
import { Button } from '../ui/Button'

function avatarInitial(email: string | undefined): string {
  if (!email) return '?'
  const ch = email.trim()[0]
  return ch ? ch.toUpperCase() : '?'
}

export function UserMenu() {
  const me = useAuthStore((s) => s.me)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    navigate('/login')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="用户菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        title={me?.email ?? '用户菜单'}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full border border-border bg-primary-muted text-sm font-semibold text-primary transition-colors',
          'hover:bg-primary-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'ring-2 ring-primary/30',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {avatarInitial(me?.email)}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="用户菜单"
          className="absolute right-0 top-full z-40 mt-1 w-56 rounded-[var(--radius-panel)] border border-border bg-surface-elevated p-2 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">{me?.email ?? '—'}</p>
            <div className="mt-2">
              <Badge variant="primary">
                <span aria-hidden>◆</span> {me?.quota_credits ?? 0} credits
              </Badge>
            </div>
          </div>

          <div className="my-2 border-t border-border" />

          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-xs text-muted-fg">外观与主题</span>
            <AppearancePicker />
          </div>

          <div className="my-2 border-t border-border" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            fullWidth
            className="justify-start text-muted-fg hover:text-foreground"
            onClick={handleLogout}
          >
            登出
          </Button>
        </div>
      )}
    </div>
  )
}
