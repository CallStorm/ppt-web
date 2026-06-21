import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { APP_NAME } from '../lib/brand'
import { useAuthStore } from '../stores/authStore'

export function LoginPage() {
  const me = useAuthStore((s) => s.me)
  const booted = useAuthStore((s) => s.booted)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  if (!booted) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">载入中…</div>
    )
  }

  if (me) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center border-b border-slate-200 px-6 dark:border-slate-800">
        <span className="text-lg font-semibold">{APP_NAME}</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-md dark:bg-slate-900">
          <h1 className="mb-1 text-xl font-semibold">{mode === 'login' ? '登录' : '注册'}</h1>
          <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? '邮箱或账号（如 admin）' : '创建账号，需有效邮箱'}
          </p>
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {mode === 'login' ? '邮箱 / 账号' : '邮箱'}
              </span>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder={mode === 'login' ? 'admin 或 you@example.com' : 'you@example.com'}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 focus:border-gemini-500 focus:outline-none focus:ring-2 focus:ring-gemini-500/30 dark:border-slate-700 dark:bg-slate-800"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">密码</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                minLength={mode === 'register' ? 6 : undefined}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 focus:border-gemini-500 focus:outline-none focus:ring-2 focus:ring-gemini-500/30 dark:border-slate-700 dark:bg-slate-800"
              />
              {mode === 'login' && (
                <p className="mt-1 text-xs text-slate-400">默认管理员：admin / admin</p>
              )}
            </label>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-gemini-600 px-3 py-2 text-sm font-medium text-white hover:bg-gemini-700 disabled:opacity-50"
            >
              {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
            {mode === 'login' ? (
              <>
                没有账号？{' '}
                <button type="button" onClick={() => setMode('register')} className="text-gemini-600 hover:underline">
                  注册
                </button>
              </>
            ) : (
              <>
                已有账号？{' '}
                <button type="button" onClick={() => setMode('login')} className="text-gemini-600 hover:underline">
                  登录
                </button>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  )
}
