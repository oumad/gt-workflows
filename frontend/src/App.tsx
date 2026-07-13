import { useEffect, useMemo } from 'react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { NotificationsProvider } from './context/NotificationsContext'
import { Notifications } from './components/ui/Notifications'
import { useJobCompletionNotifications } from './hooks/useJobCompletionNotifications'
import { canSee, derivePrimaryRole, landingFor } from './lib/permissions'
import { LoginPage } from './pages/login/LoginPage'
import { Sidebar } from './components/shell/Sidebar'
import { SystemStatusBanner, OpsTransitionToasts } from './components/shell/SystemStatusBanner'
import { WorkflowsPage } from './pages/workflows/WorkflowsPage'
import { HomePage } from './pages/home/HomePage'
import { JobsPage } from './pages/jobs/JobsPage'
import { DoctorPage } from './pages/doctor/DoctorPage'
import { ServersPage as ServicesPage } from './pages/services/ServersPage'
import { ServersPage } from './pages/servers/ServersPage'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { UsersPage } from './pages/users/UsersPage'
import { PreferencesPage } from './pages/preferences/PreferencesPage'
import { GtUsersPage } from './pages/clients/GtUsersPage'
import { CredentialsPage } from './pages/credentials/CredentialsPage'
import { SetoPage } from './pages/seto/SetoPage'
import type { Page } from './types'

/* ─── Routing ─────────────────────────────────────────────────
 * react-router-dom owns history/popstate now; this file maps URL → Page
 * (which page component to render) and Page → URL (where the sidebar's
 * navigate(page) lands). Page is intentionally kept as a string enum so we
 * don't churn every page component's existing `navigate: NavigateFn` prop.
 */
const ROUTES: Record<string, Page> = {
  '/login': 'home',
  '/home': 'home',
  '/workflows': 'workflows',
  '/jobs': 'jobs',
  '/doctor': 'doctor',
  '/services': 'services',
  '/servers': 'servers',
  '/analytics': 'analytics',
  '/calendar': 'calendar',
  '/gt-users': 'clients',
  '/users': 'users',
  '/credentials': 'credentials',
  '/seto': 'seto',
  '/preferences': 'preferences',
}

const PATHS: Record<Page, string> = {
  home: '/home',
  workflows: '/workflows',
  jobs: '/jobs',
  doctor: '/doctor',
  services: '/services',
  servers: '/servers',
  analytics: '/analytics',
  calendar: '/calendar',
  clients: '/gt-users',
  users: '/users',
  credentials: '/credentials',
  seto: '/seto',
  preferences: '/preferences',
}

function pageFromPath(path: string): Page {
  if (ROUTES[path]) return ROUTES[path]
  if (path.startsWith('/workflows/')) return 'workflows'
  if (path.startsWith('/services/')) return 'services'
  if (path.startsWith('/servers/')) return 'servers'
  if (path.startsWith('/gt-users/')) return 'clients'
  if (path === '/clients' || path.startsWith('/clients/')) return 'clients'
  // Back-compat: pre-rename /hosts/* URLs land on the servers page.
  if (path === '/hosts' || path.startsWith('/hosts/')) return 'servers'
  return 'home'
}

/* ─── App shell ─────────────────────────────────────────────── */
function AppShell() {
  const { user } = useAuth()
  const location = useLocation()
  const routerNav = useNavigate()
  const page = pageFromPath(location.pathname)

  // Bridge the old `navigate(page, path?)` API onto react-router's hook so
  // every existing page can keep its `navigate: NavigateFn` prop unchanged.
  const navigate = useMemo(
    () => (p: Page, path?: string) => routerNav(path ?? PATHS[p]),
    [routerNav],
  )

  // Back-compat URL redirects (replaces the old inline rewrite in pageFromPath).
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      routerNav('/home', { replace: true })
    } else if (location.pathname === '/clients' || location.pathname.startsWith('/clients/')) {
      routerNav(location.pathname.replace(/^\/clients/, '/gt-users'), { replace: true })
    } else if (location.pathname === '/hosts' || location.pathname.startsWith('/hosts/')) {
      // F10 rename: /hosts/* permanently moved to /servers/*.
      routerNav(location.pathname.replace(/^\/hosts/, '/servers'), { replace: true })
    }
  }, [location.pathname, routerNav])

  // Sync the URL with auth state — runs after commit so it's safe under
  // React strict mode (was a render-phase mutation before — see B03).
  // Post-login: viewer accounts land on /analytics (their only useful page);
  // everyone else lands on /home.
  useEffect(() => {
    if (user && location.pathname === '/login') {
      const r = derivePrimaryRole(user.roles ?? (user.isAdmin ? ['admin'] : ['operator']))
      const landing = landingFor(r)
      routerNav(`/${landing}`, { replace: true })
    } else if (!user && location.pathname !== '/login') {
      routerNav('/login', { replace: true })
    }
  }, [user, location.pathname, routerNav])

  if (!user) {
    return (
      <>
        <SystemStatusBanner />
        <LoginPage />
      </>
    )
  }

  // Force a page-component remount when the URL changes — preserves the
  // legacy `key={navKey}` behaviour where clicking the sidebar's "Workflows"
  // entry while already on /workflows/abc resets the page.
  const navKey = location.key

  // Role-based page access. The Sidebar already hides items the user can't
  // see, but a direct URL ( /servers, /users, etc.) would still mount the
  // page and fire API requests that 403. Block here so the UX is "page
  // doesn't open" instead of "page opens then breaks". `canSee` is the
  // source of truth, mirrored by the backend's requireCapability checks.
  const role = derivePrimaryRole(user.roles ?? (user.isAdmin ? ['admin'] : ['operator']))
  const blockedByAuth = !canSee(role, page)

  return (
    <NotificationsProvider>
      <JobCompletionToasts />
      <OpsTransitionToasts />
      <DataProvider>
        <SystemStatusBanner />
        <div className="app">
          <Sidebar page={page} navigate={navigate} />
          <main className="main">
            {blockedByAuth ? (
              <Forbidden onHome={() => navigate(landingFor(role))} />
            ) : (
              <>
                {page === 'home' && <HomePage navigate={navigate} />}
                {page === 'workflows' && <WorkflowsPage key={navKey} navigate={navigate} />}
                {page === 'jobs' && <JobsPage navigate={navigate} />}
                {page === 'doctor' && <DoctorPage />}
                {page === 'services' && <ServicesPage key={navKey} navigate={navigate} />}
                {page === 'servers' && <ServersPage key={navKey} navigate={navigate} />}
                {page === 'analytics' && <AnalyticsPage />}
                {page === 'calendar' && <CalendarPage navigate={navigate} />}
                {page === 'clients' && <GtUsersPage navigate={navigate} />}
                {page === 'users' && <UsersPage />}
                {page === 'credentials' && <CredentialsPage />}
                {page === 'seto' && <SetoPage />}
                {page === 'preferences' && <PreferencesPage />}
              </>
            )}
          </main>
        </div>
        <Notifications />
      </DataProvider>
    </NotificationsProvider>
  )
}

/** Renders nothing — exists only so the job-completion hook runs inside the
 *  NotificationsProvider (the hook calls useNotifications, which would throw
 *  if invoked from AppShell directly). */
function JobCompletionToasts() {
  useJobCompletionNotifications()
  return null
}

/** Inline 403 placeholder for admin pages reached by a non-admin user. */
function Forbidden({ onHome }: { onHome: () => void }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div className="col" style={{ gap: 12, alignItems: 'center', maxWidth: 380 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--bad-soft)',
            color: 'var(--bad)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 22,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
          }}
        >
          403
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600 }}>
          Admin access required
        </div>
        <div style={{ color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.55 }}>
          This page is only available to admin users. If you think this is a mistake, ask an
          administrator to grant your account admin rights.
        </div>
        <button className="btn btn-sm" onClick={onHome} style={{ marginTop: 6 }}>
          Back to Home
        </button>
      </div>
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}
