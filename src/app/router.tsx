import React from 'react'
import { Routes, Route, Link, Navigate, useLocation, Outlet, useOutletContext } from 'react-router-dom'
import type { Workflow } from '@/types'
import { LogOut } from 'lucide-react'
import { useAuth, Login, clearStoredAuth } from '@/features/auth'
import { useWorkflows } from '@/features/workflows'
import { WorkflowList, WorkflowDetail, WorkflowCreate } from '@/features/workflows'
import { Settings } from '@/features/settings'
import { Dashboard } from '@/features/dashboard'
import { Activity } from '@/features/activity'
import '@/App.css'

export interface MainOutletContext {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  loadWorkflows: () => void
}

function AuthLoading(): React.ReactElement {
  return (
    <div className="auth-guard-loading">
      <span className="auth-guard-spinner" />
      <span>Checking authentication…</span>
    </div>
  )
}

function LoginRoute(): React.ReactElement {
  const { authStatus, authEnabled, setAuthStatus, role } = useAuth()
  if (!authEnabled) return <Navigate to="/workflows" replace />
  if (authStatus === 'pending') return <AuthLoading />
  if (authStatus === 'ok') return <Navigate to={role === 'admin' ? '/workflows' : '/job-stats'} replace />
  return <Login onSuccess={() => setAuthStatus('ok')} />
}

function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  const { authStatus, authEnabled } = useAuth()
  const location = useLocation()
  if (authStatus === 'pending') return <AuthLoading />
  if (!authEnabled) return <>{children}</>
  if (authStatus === 'required') return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }): React.ReactElement {
  const { role } = useAuth()
  if (role === 'guest') return <Navigate to="/job-stats" replace />
  return <>{children}</>
}

/** Forwards parent outlet context to nested workflow routes so they can use workflows/loading/error/loadWorkflows. */
function WorkflowsOutlet(): React.ReactElement {
  const context = useOutletContext<MainOutletContext>()
  return <Outlet context={context} />
}

const FIRST_LOGIN_KEY = 'gt-workflows-first-login'

function LogoutButton(): React.ReactElement | null {
  const { authEnabled, username, setAuthStatus } = useAuth()
  const [showWelcome, setShowWelcome] = React.useState(() => {
    try {
      return sessionStorage.getItem(FIRST_LOGIN_KEY) === '1'
    } catch {
      return false
    }
  })

  React.useEffect(() => {
    if (!showWelcome || !username) return
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem(FIRST_LOGIN_KEY)
      } catch {}
      setShowWelcome(false)
    }, 4000)
    return () => clearTimeout(t)
  }, [showWelcome, username])

  if (!authEnabled) return null
  const handleLogout = (): void => {
    clearStoredAuth()
    setAuthStatus('required')
  }
  return (
    <div className="header-auth">
      {username != null && username !== '' && (
        <span className="header-auth-user" aria-label={`Logged in as ${username}`}>
          {showWelcome ? `Welcome, ${username}!` : `Welcome, ${username}`}
        </span>
      )}
      <button
        type="button"
        onClick={handleLogout}
        className="logout-btn"
        title="Disconnect"
        aria-label="Disconnect"
      >
        <LogOut size={20} />
      </button>
    </div>
  )
}

function MainLayoutWithData(): React.ReactElement {
  const location = useLocation()
  const path = location.pathname
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const navActive = {
    workflows: path === '/workflows' || path.startsWith('/workflows/workflow/'),
    create: path === '/workflows/new',
    activity: path.startsWith('/activity'),
    dashboard: path.startsWith('/job-stats'),
    settings: path.startsWith('/settings'),
  }
  const { workflows, loading, error, loadWorkflows } = useWorkflows()

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <h1>GT Workflows Manager</h1>
            <nav>
              {isAdmin && (
                <>
                  <Link to="/workflows" className={`nav-link${navActive.workflows ? ' nav-link--active' : ''}`}>Workflows</Link>
                  <Link to="/workflows/new" className={`nav-link${navActive.create ? ' nav-link--active' : ''}`}>Create New</Link>
                  <Link to="/activity" className={`nav-link${navActive.activity ? ' nav-link--active' : ''}`}>Activity</Link>
                  <Link to="/job-stats" className={`nav-link${navActive.dashboard ? ' nav-link--active' : ''}`}>Job stats</Link>
                  <Link to="/settings" className={`nav-link${navActive.settings ? ' nav-link--active' : ''}`}>Settings</Link>
                </>
              )}
            </nav>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="app-main">
        <Outlet context={{ workflows, loading, error, loadWorkflows }} />
      </main>
    </div>
  )
}

function WorkflowListFromContext(): React.ReactElement {
  const { workflows, loading, error, loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowList workflows={workflows} loading={loading} error={error} onRefresh={loadWorkflows} />
}

function WorkflowDetailWithContext(): React.ReactElement {
  const { loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowDetail onUpdate={loadWorkflows} />
}

function WorkflowCreateWithContext(): React.ReactElement {
  const { loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowCreate onCreated={loadWorkflows} />
}

function RootRedirect(): React.ReactElement {
  const { authEnabled, authStatus, role } = useAuth()
  if (authEnabled && authStatus === 'ok') {
    return <Navigate to={role === 'admin' ? '/workflows' : '/job-stats'} replace />
  }
  return <Navigate to={authEnabled ? '/login' : '/workflows'} replace />
}

function CatchAllRedirect(): React.ReactElement {
  const { authEnabled, authStatus, role } = useAuth()
  if (authEnabled && authStatus === 'ok') {
    return <Navigate to={role === 'admin' ? '/workflows' : '/job-stats'} replace />
  }
  return <Navigate to={authEnabled ? '/login' : '/workflows'} replace />
}

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route
        element={
          <RequireAuth>
            <MainLayoutWithData />
          </RequireAuth>
        }
      >
        <Route path="workflows" element={<RequireAdmin><WorkflowsOutlet /></RequireAdmin>}>
          <Route index element={<WorkflowListFromContext />} />
          <Route path="new" element={<WorkflowCreateWithContext />} />
          <Route path="workflow/:name" element={<WorkflowDetailWithContext />} />
        </Route>
        <Route path="activity" element={<RequireAdmin><Activity /></RequireAdmin>} />
        <Route path="job-stats" element={<Dashboard />} />
        <Route path="settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<CatchAllRedirect />} />
    </Routes>
  )
}
