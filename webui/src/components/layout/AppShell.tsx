import { Link, Outlet, useNavigate } from 'react-router-dom'
import { APP_NAME } from '../../lib/brand'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'

export function AppShell() {
  const me = useAuthStore((s) => s.me)
  const logout = useAuthStore((s) => s.logout)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <Link to="/" className="mr-6 text-base font-semibold">
          {APP_NAME}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/jobs/new"
            className="rounded-md bg-gemini-600 px-3 py-1.5 font-medium text-white hover:bg-gemini-700"
          >
            创建
          </Link>
          {isAdmin() && (
            <Link
              to="/admin"
              className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              管理后台
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="hidden text-slate-500 sm:inline dark:text-slate-400">{me?.email}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gemini-50 px-2 py-0.5 text-xs font-medium text-gemini-700 dark:bg-gemini-900/30 dark:text-gemini-200">
            <span aria-hidden>◆</span>
            {me?.quota_credits ?? 0} credits
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="切换主题"
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-slate-500 hover:text-rose-600"
          >
            登出
          </button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
