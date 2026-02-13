import { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, Outlet, useOutletContext } from 'react-router-dom'
import { Workflow } from './types'
import { listWorkflows } from './api/workflows'
import WorkflowList from './components/WorkflowList'
import WorkflowDetail from './components/WorkflowDetail'
import WorkflowCreate from './components/WorkflowCreate'
import Settings from './components/Settings'
import Dashboard from './components/Dashboard'
import Activity from './components/Activity'
import Login from './components/Login'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { clearStoredAuth } from './utils/auth'
import { LogOut } from 'lucide-react'
import './App.css'

function AuthLoading() {
  return (
    <div className="auth-guard-loading">
      <span className="auth-guard-spinner" />
      <span>Checking authentication…</span>
    </div>
  )
}

function LoginRoute() {
  const { authStatus, setAuthStatus } = useAuth()
  if (authStatus === 'pending') return <AuthLoading />
  if (authStatus === 'ok') return <Navigate to="/main" replace />
  return <Login onSuccess={() => setAuthStatus('ok')} />
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authStatus } = useAuth()
  const location = useLocation()
  if (authStatus === 'pending') return <AuthLoading />
  if (authStatus === 'required') return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function LogoutButton() {
  const { setAuthStatus } = useAuth()
  const handleLogout = () => {
    clearStoredAuth()
    setAuthStatus('required')
  }
  return (
    <button
      type="button"
      onClick={handleLogout}
      className="logout-btn"
      title="Disconnect"
      aria-label="Disconnect"
    >
      <LogOut size={20} />
    </button>
  )
}

function MainLayoutWithData() {
  const location = useLocation()
  const path = location.pathname
  const navActive = {
    workflows: path === '/main' || path.startsWith('/main/workflow/'),
    dashboard: path.startsWith('/main/dashboard'),
    create: path.startsWith('/main/create'),
    activity: path.startsWith('/main/activity'),
    settings: path.startsWith('/main/settings'),
  }
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  const loadWorkflows = async () => {
    if (loadingRef.current) return
    try {
      loadingRef.current = true
      setLoading(true)
      setError(null)
      const data = await listWorkflows()
      setWorkflows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  useEffect(() => {
    loadWorkflows()
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <h1>GT Workflows Manager</h1>
            <nav>
              <Link to="/main" className={`nav-link${navActive.workflows ? ' nav-link--active' : ''}`}>Workflows</Link>
              <Link to="/main/create" className={`nav-link${navActive.create ? ' nav-link--active' : ''}`}>Create New</Link>
              <Link to="/main/activity" className={`nav-link${navActive.activity ? ' nav-link--active' : ''}`}>Activity</Link>
              <Link to="/main/dashboard" className={`nav-link${navActive.dashboard ? ' nav-link--active' : ''}`}>Job stats</Link>
              <Link to="/main/settings" className={`nav-link${navActive.settings ? ' nav-link--active' : ''}`}>Settings</Link>
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

type MainOutletContext = { workflows: Workflow[]; loading: boolean; error: string | null; loadWorkflows: () => void }

function WorkflowListFromContext() {
  const { workflows, loading, error, loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowList workflows={workflows} loading={loading} error={error} onRefresh={loadWorkflows} />
}

function WorkflowDetailWithContext() {
  const { loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowDetail onUpdate={loadWorkflows} />
}

function WorkflowCreateWithContext() {
  const { loadWorkflows } = useOutletContext<MainOutletContext>()
  return <WorkflowCreate onCreated={loadWorkflows} />
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/main"
            element={
              <RequireAuth>
                <MainLayoutWithData />
              </RequireAuth>
            }
          >
            <Route index element={<WorkflowListFromContext />} />
            <Route path="workflow/:name" element={<WorkflowDetailWithContext />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="create" element={<WorkflowCreateWithContext />} />
            <Route path="activity" element={<Activity />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
