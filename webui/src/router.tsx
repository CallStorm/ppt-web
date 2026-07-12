import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { BeautifyJobPage } from './pages/BeautifyJobPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { TemplateWizardPage } from './pages/TemplateWizardPage'
import { ChatWorkspacePage } from './pages/ChatWorkspacePage'
import { NewJobPage } from './pages/NewJobPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { EditJobPage } from './pages/EditJobPage'
import { AdminPage } from './pages/AdminPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useAuthStore((s) => s.me)
  const booted = useAuthStore((s) => s.booted)
  if (!booted) {
    return <div className="flex h-screen items-center justify-center text-slate-400">载入中…</div>
  }
  if (!me) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="chat" element={<ChatWorkspacePage />} />
        <Route path="chat/:id" element={<ChatWorkspacePage />} />
        <Route path="jobs/new" element={<NewJobPage />} />
        <Route path="jobs/beautify" element={<BeautifyJobPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/new" element={<TemplateWizardPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
        <Route path="jobs/:id/edit" element={<EditJobPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
