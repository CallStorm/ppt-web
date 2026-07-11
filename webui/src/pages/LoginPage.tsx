import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { APP_NAME } from '../lib/brand'
import { useAuthStore } from '../stores/authStore'
import { AppearancePicker, ThemePickerInline } from '../components/ui/AppearancePicker'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'

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
      <div className="flex h-screen items-center justify-center bg-surface text-muted-fg">载入中…</div>
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
    <div className="theme-page flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface-elevated/90 px-6 backdrop-blur">
        <span className="font-display text-lg font-semibold text-foreground">{APP_NAME}</span>
        <AppearancePicker />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm shadow-md" padding="lg">
          <h1 className="font-display mb-1 text-xl font-semibold">{mode === 'login' ? '登录' : '注册'}</h1>
          <p className="mb-5 text-sm text-muted-fg">
            {mode === 'login' ? '邮箱或账号（如 admin）' : '创建账号，需有效邮箱'}
          </p>
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-fg">
                {mode === 'login' ? '邮箱 / 账号' : '邮箱'}
              </span>
              <Input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder={mode === 'login' ? 'admin 或 you@example.com' : 'you@example.com'}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-fg">密码</span>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                minLength={mode === 'register' ? 6 : undefined}
                className="mt-1"
              />
              {mode === 'login' && (
                <p className="mt-1 text-xs text-muted-fg">默认管理员：admin / admin</p>
              )}
            </label>
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={loading} fullWidth size="lg">
              {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-fg">
            {mode === 'login' ? (
              <>
                没有账号？{' '}
                <Button type="button" variant="link" size="sm" onClick={() => setMode('register')}>
                  注册
                </Button>
              </>
            ) : (
              <>
                已有账号？{' '}
                <Button type="button" variant="link" size="sm" onClick={() => setMode('login')}>
                  登录
                </Button>
              </>
            )}
          </p>
          <ThemePickerInline className="mt-6" />
        </Card>
      </main>
    </div>
  )
}
