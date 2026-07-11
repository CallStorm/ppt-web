import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { useEffect } from 'react'
import { AppRoutes } from './router'
import { ToastHost } from './components/ui/Toast'
import { ModalHost } from './components/ui/Modal'
import { useAuthStore } from './stores/authStore'
import { useAppearanceStore } from './stores/appearanceStore'
import { GenerationMascotHost } from './components/mascot/GenerationMascot'
import { setDisplayTimezone } from './lib/format'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
})

function Boot() {
  const boot = useAuthStore((s) => s.boot)
  const initAppearance = useAppearanceStore((s) => s.init)

  useEffect(() => {
    initAppearance()
    boot()
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.display_timezone) setDisplayTimezone(data.display_timezone)
      })
      .catch(() => {})
  }, [boot, initAppearance])

  return (
    <>
      <AppRoutes />
      <GenerationMascotHost />
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
