import { useLayoutEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { APP_NAME } from '../../lib/brand'
import { useAuthStore } from '../../stores/authStore'
import { MascotToggle } from '../mascot/MascotToggle'
import { cn } from '../../lib/cn'
import { APP_MAIN_SCROLL_ID, resetMainScroll } from '../../lib/scrollMain'
import { CreatePptDropdown } from './CreatePptDropdown'
import { UserMenu } from './UserMenu'

const navLinkClass = (active: boolean) =>
  cn(
    'rounded-[var(--radius-control)] px-3 py-1.5 font-medium transition-colors',
    active
      ? 'bg-primary-muted text-primary'
      : 'text-muted-fg hover:bg-primary-muted/30 hover:text-foreground',
  )

export function AppShell() {
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const location = useLocation()
  const isChatWorkspace = location.pathname.startsWith('/chat')
  const path = location.pathname

  useLayoutEffect(() => {
    if (!isChatWorkspace) resetMainScroll()
  }, [location.pathname, isChatWorkspace])

  return (
    <div className="theme-page flex h-screen flex-col overflow-hidden">
      <header className="z-30 flex h-14 shrink-0 items-center border-b border-border bg-surface-elevated/90 px-4 backdrop-blur">
        <Link to="/" className="font-display shrink-0 text-base font-semibold text-foreground">
          {APP_NAME}
        </Link>
        <CreatePptDropdown pathname={path} className="ml-4" />
        <Link
          to="/templates"
          className={cn(navLinkClass(path.startsWith('/templates')), 'ml-4 text-sm')}
        >
          模板库
        </Link>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {isAdmin() && (
            <Link to="/admin" className={navLinkClass(path.startsWith('/admin'))}>
              工作台
            </Link>
          )}
          <MascotToggle />
          <UserMenu />
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
