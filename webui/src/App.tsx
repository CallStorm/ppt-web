import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AppRoutes } from './router'
import { ToastHost } from './components/ui/Toast'
import { ModalHost } from './components/ui/Modal'
import { useAuthStore } from './stores/authStore'
import { useThemeStore } from './stores/themeStore'
import { setDisplayTimezone } from './lib/format'
import { attemptExternalLogin } from './lib/externalLogin'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
})

function Boot() {
  const boot = useAuthStore((s) => s.boot)
  const initTheme = useThemeStore((s) => s.init)
  const navigate = useNavigate()

  useEffect(() => {
    initTheme()
    ;(async () => {
      const result = await attemptExternalLogin()
      await boot()
      if (result === 'failed') {
        navigate('/login', { replace: true })
      }
    })()
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.display_timezone) setDisplayTimezone(data.display_timezone)
      })
      .catch(() => {})
  }, [boot, initTheme, navigate])

  return (
    <>
      <AppRoutes />
      <ToastHost />
      <ModalHost />
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Boot />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
