import { useLayoutEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { APP_NAME } from '../../lib/brand'
import { useAuthStore } from '../../stores/authStore'
import { Badge } from '../ui/Badge'
import { AppearancePicker } from '../ui/AppearancePicker'
import { MascotToggle } from '../mascot/MascotToggle'
import { HeaderIconButton } from '../ui/HeaderIconButton'
import { IconLogOut } from '../ui/icons'
import { cn } from '../../lib/cn'
import { APP_MAIN_SCROLL_ID, resetMainScroll } from '../../lib/scrollMain'

const navLinkClass = (active: boolean) =>
  cn(
    'rounded-[var(--radius-control)] px-3 py-1.5 font-medium transition-colors',
    active
      ? 'bg-primary-muted text-primary'
      : 'text-muted-fg hover:bg-primary-muted/30 hover:text-foreground',
  )

export function AppShell() {
  const me = useAuthStore((s) => s.me)
  const logout = useAuthStore((s) => s.logout)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const navigate = useNavigate()
  const location = useLocation()
  const isChatWorkspace = location.pathname.startsWith('/chat')
  const path = location.pathname

  useLayoutEffect(() => {
    if (!isChatWorkspace) resetMainScroll()
  }, [location.pathname, isChatWorkspace])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="theme-page flex h-screen flex-col overflow-hidden">
      <header className="z-30 flex h-14 shrink-0 items-center border-b border-border bg-surface-elevated/90 px-4 backdrop-blur">
        <Link to="/" className="font-display mr-6 text-base font-semibold text-foreground">
          {APP_NAME}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/chat" className={cn(navLinkClass(path.startsWith('/chat')), 'border border-accent/20')}>
            对话创作
          </Link>
          <Link
            to="/jobs/beautify"
            className={cn(navLinkClass(path.startsWith('/jobs/beautify')), 'border border-primary/20')}
          >
            美化 PPT
          </Link>
          <Link
            to="/templates"
            className={cn(navLinkClass(path.startsWith('/templates')), 'border border-primary/20')}
          >
            模板库
          </Link>
          <Link
            to="/jobs/new"
            className={cn(navLinkClass(path.startsWith('/jobs/new')), 'border border-primary/20')}
          >
            创建
          </Link>
          {isAdmin() && (
            <Link to="/admin" className={navLinkClass(path.startsWith('/admin'))}>
              管理后台
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="hidden text-muted-fg sm:inline">{me?.email}</span>
          <Badge variant="primary">
            <span aria-hidden>◆</span> {me?.quota_credits ?? 0} credits
          </Badge>
          <div className="flex items-center gap-0.5">
            <MascotToggle />
            <AppearancePicker />
            <HeaderIconButton
              type="button"
              title="登出"
              aria-label="登出"
              onClick={handleLogout}
            >
              <IconLogOut />
            </HeaderIconButton>
          </div>
        </div>
      </header>
      <main
        id={APP_MAIN_SCROLL_ID}
        className={cn(
          'min-h-0 flex-1',
          isChatWorkspace ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {isChatWorkspace ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}
