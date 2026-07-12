import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import { Component, useEffect, type ReactNode } from 'react'
import { AppRoutes } from './router'
import { ToastHost } from './components/ui/Toast'
import { ModalHost } from './components/ui/Modal'
import { useAuthStore } from './stores/authStore'
import { useAppearanceStore } from './stores/appearanceStore'
import { useMascotStore } from './stores/mascotStore'
import { GenerationMascotHost } from './components/mascot/GenerationMascot'
import { setDisplayTimezone } from './lib/format'
import { attemptExternalLogin } from './lib/externalLogin'

class MascotErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  render() {
    if (this.state.crashed) return null
    return this.props.children
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
})

function Boot() {
  const boot = useAuthStore((s) => s.boot)
  const me = useAuthStore((s) => s.me)
  const booted = useAuthStore((s) => s.booted)
  const initAppearance = useAppearanceStore((s) => s.init)
  const initMascot = useMascotStore((s) => s.init)
  const navigate = useNavigate()

  useEffect(() => {
    initAppearance()
    initMascot()
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
  }, [boot, initAppearance, initMascot, navigate])

  return (
    <>
      <AppRoutes />
      {booted && me ? (
        <MascotErrorBoundary>
          <GenerationMascotHost />
        </MascotErrorBoundary>
      ) : null}
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
