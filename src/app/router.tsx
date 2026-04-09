import React from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, Outlet, useOutletContext } from 'react-router-dom'
import type { Workflow } from '@/types'
import { ROUTES } from '@/app/routes'
import { LogOut, User, LayoutGrid, Activity as ActivityIcon, BarChart3, Stethoscope, Server, AlertTriangle } from 'lucide-react'
import { AppLogo } from '@/components/ui/AppLogo'
import { useAuth, Login, clearStoredAuth } from '@/features/auth'
import { useWorkflows } from '@/features/workflows'
import { WorkflowList, WorkflowDetail, WorkflowCreate } from '@/features/workflows'
import { Servers } from '@/features/servers'
import { Dashboard, DashboardTimeView } from '@/features/dashboard'
import { Activity } from '@/features/activity'
import { Doctor } from '@/features/doctor'
import { UserProfile } from '@/features/user'
import { useNavGuard } from '@/contexts/NavGuardContext'
import { PeriodProvider } from '@/contexts/PeriodContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { IncidentTimelineProvider } from '@/contexts/IncidentTimelineContext'
import IncidentTimeline from '@/components/ui/IncidentTimeline'
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
  if (authStatus === 'ok') return <Navigate to={role === 'admin' ? ROUTES.workflows : ROUTES.jobStats} replace />
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
  if (role === 'guest') return <Navigate to={ROUTES.jobStats} replace />
  return <>{children}</>
}

/** Forwards parent outlet context to nested workflow routes so they can use workflows/loading/error/loadWorkflows. */
function WorkflowsOutlet(): React.ReactElement {
  const context = useOutletContext<MainOutletContext>()
  return <Outlet context={context} />
}

const FIRST_LOGIN_KEY = 'gt-workflows-first-login'

function getGreeting(username: string): string[] {
  const hour = new Date().getHours()
  const timeGreeting = hour < 12 ? 'good morning' : hour < 18 ? 'good afternoon' : 'good evening'
  return [
    `${timeGreeting}, ${username}`,
    `let's monitor stuff, ${username}`,
    `any good workflow ideas, ${username}?`,
    `welcome back, ${username}`,
    `hey ${username}, let's go`,
    `let's see what users are up to`,
    `wonder what is top workflow, ${username}?`,
    `servers are looking good, ${username}`,
    `any server issues, ${username}?`,
    `lets see what is going on, ${username}`,
  ]
}

function AnimatedGreeting({ username }: { username: string }): React.ReactElement {
  const greetings = React.useMemo(() => getGreeting(username), [username])
  const [index, setIndex] = React.useState(0)
  const [fade, setFade] = React.useState(true)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % greetings.length)
        setFade(true)
      }, 300)
    }, 10000)
    return () => clearInterval(interval)
  }, [greetings.length])

  return (
    <span
      className="text-xs text-[#8b9aab] transition-opacity duration-300 whitespace-nowrap"
      style={{ opacity: fade ? 1 : 0 }}
      aria-label={`Logged in as ${username}`}
    >
      {greetings[index]}
    </span>
  )
}

function LogoutButton(): React.ReactElement | null {
  const { authEnabled, username, setAuthStatus } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isProfileActive = location.pathname === ROUTES.user

  if (!authEnabled) return null
  const handleLogout = (): void => {
    clearStoredAuth()
    setAuthStatus('required')
  }
  return (
    <div className="flex items-center gap-3">
      {username != null && username !== '' && (
        <AnimatedGreeting username={username} />
      )}
      <button
        type="button"
        onClick={() => navigate(ROUTES.user)}
        className={`p-1.5 rounded-md transition-all duration-150 ${
          isProfileActive
            ? 'text-purple-400 bg-[#243044]'
            : 'text-[#697784] hover:bg-[#243044] hover:text-[#e8ecf1]'
        }`}
        title="Profile"
        aria-label="Profile"
      >
        <User size={16} />
      </button>
      <button
        type="button"
        onClick={handleLogout}
        className="p-1.5 rounded-md text-[#697784] hover:bg-[#243044] hover:text-[#e8ecf1] transition-all duration-150"
        title="Disconnect"
        aria-label="Disconnect"
      >
        <LogOut size={16} />
      </button>
    </div>
  )
}

function GuardedNavLink({ to, active, children, className }: { to: string; active: boolean; children: React.ReactNode; className: string }) {
  const navigate = useNavigate()
  const { isBlocked } = useNavGuard()
  const [pendingNav, setPendingNav] = React.useState<string | null>(null)

  return (
    <>
      <a
        href={to}
        onClick={(e) => {
          e.preventDefault()
          if (active) return
          if (isBlocked()) {
            setPendingNav(to)
          } else {
            navigate(to)
          }
        }}
        className={className}
      >
        {children}
      </a>
      {pendingNav && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[#1a2332] border border-[#2d3a4a] rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
              <h3 className="text-base font-semibold text-[#e8ecf1]">Unsaved Changes</h3>
            </div>
            <p className="text-sm text-[#8b9aab] mb-5">
              You have unsaved changes in edit mode. What would you like to do?
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setPendingNav(null)}
                className="text-sm py-2 px-4 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors border border-[#2d3a4a]"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  const target = pendingNav
                  setPendingNav(null)
                  navigate(target)
                }}
                className="text-sm py-2 px-4 rounded-lg text-[#d16b6b] hover:bg-red-900/20 transition-colors border border-red-900/30"
              >
                Discard & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
    dashboard: path.startsWith(ROUTES.jobStats),
    doctor: path.startsWith(ROUTES.doctor),
    servers: path.startsWith('/servers'),
  }
  const { workflows, loading, error, loadWorkflows } = useWorkflows()

  const navItems = isAdmin ? [
    { to: '/workflows', label: 'Workflows', icon: LayoutGrid, active: navActive.workflows },
    { to: '/activity', label: 'Activity', icon: ActivityIcon, active: navActive.activity },
    { to: ROUTES.jobStats, label: 'Analytics', icon: BarChart3, active: navActive.dashboard },
    { to: ROUTES.doctor, label: 'Doctor', icon: Stethoscope, active: navActive.doctor },
    { to: '/servers', label: 'Servers', icon: Server, active: navActive.servers },
  ] : [
    { to: ROUTES.jobStats, label: 'Analytics', icon: BarChart3, active: navActive.dashboard },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-[#0f1419]">
      {/* Header — icon+label centered nav */}
      <header className="bg-[#1a2332] border-b border-[#2d3a4a] sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center relative">
          {/* Brand — left-aligned */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <AppLogo size={28} />
            <span className="text-base font-semibold text-[#e8ecf1] hidden sm:inline">GT Coffee Maker</span>
          </div>

          {/* Centered Navigation — absolutely positioned to stay centered regardless of brand/logout widths */}
          <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon, active }) => (
              <GuardedNavLink
                key={to}
                to={to}
                active={active}
                className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-all duration-150 min-w-[64px] relative ${
                  active
                    ? 'text-purple-400'
                    : 'text-[#697784] hover:text-[#b8c4d0] hover:bg-[#243044]/50'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span className={`text-[10px] uppercase tracking-widest ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                {active && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-400" />}
              </GuardedNavLink>
            ))}
          </nav>

          {/* Right side — pushed to end */}
          <div className="flex-shrink-0 ml-auto">
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto">
        <Outlet context={{ workflows, loading, error, loadWorkflows }} />
      </main>

      {/* Footer */}
      <footer className="text-center py-2 px-4 text-[11px] text-[#697784]/60 flex-shrink-0">
        GEAR Productions — 2026
      </footer>

      <IncidentTimeline />
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
    return <Navigate to={role === 'admin' ? ROUTES.workflows : ROUTES.jobStats} replace />
  }
  return <Navigate to={authEnabled ? '/login' : '/workflows'} replace />
}

function CatchAllRedirect(): React.ReactElement {
  const { authEnabled, authStatus, role } = useAuth()
  if (authEnabled && authStatus === 'ok') {
    return <Navigate to={role === 'admin' ? ROUTES.workflows : ROUTES.jobStats} replace />
  }
  return <Navigate to={authEnabled ? '/login' : '/workflows'} replace />
}

export function AppRoutes(): React.ReactElement {
  return (
    <ToastProvider>
      <IncidentTimelineProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route
            element={
              <RequireAuth>
                <PeriodProvider>
                  <MainLayoutWithData />
                </PeriodProvider>
              </RequireAuth>
            }
          >
            <Route path="workflows" element={<RequireAdmin><WorkflowsOutlet /></RequireAdmin>}>
              <Route index element={<WorkflowListFromContext />} />
              <Route path="new" element={<WorkflowCreateWithContext />} />
              <Route path="workflow/:name" element={<WorkflowDetailWithContext />} />
            </Route>
            <Route path="activity" element={<RequireAdmin><Activity /></RequireAdmin>} />
            <Route path="job-stats" element={<Outlet />}>
              <Route index element={<Dashboard />} />
              <Route path="timeview" element={<DashboardTimeView />} />
            </Route>
            <Route path="doctor" element={<RequireAdmin><Doctor /></RequireAdmin>} />
            <Route path="servers" element={<RequireAdmin><Servers /></RequireAdmin>} />
            <Route path="user" element={<UserProfile />} />
          </Route>
          <Route path="*" element={<CatchAllRedirect />} />
        </Routes>
      </IncidentTimelineProvider>
    </ToastProvider>
  )
}
