import {
  Home,
  Workflow,
  Briefcase,
  Boxes,
  Server,
  BarChart2,
  Calendar,
  Users,
  Building2,
  KeyRound,
  Bot,
  Settings,
  LogOut,
  Stethoscope,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { canSee } from '../../lib/permissions'
import { isHostRecord } from '../../lib/serverLinks'
import type { Page } from '../../types'

type NavItem = {
  id: Page
  label: string
  icon: React.ReactNode
  tooltip: string
  badge?: number
  badgeWarn?: boolean
}

const WORKSPACE: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <Home size={16} />,
    tooltip: 'Your home base — the whole cluster at a glance',
  },
]

const TOOLS: NavItem[] = [
  {
    id: 'workflows',
    label: 'Workflows',
    icon: <Workflow size={16} />,
    tooltip: 'Browse and run your ComfyUI pipelines',
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: <Briefcase size={16} />,
    tooltip: "Live feed — what's running and waiting",
  },
  {
    id: 'services',
    label: 'Services',
    icon: <Boxes size={16} />,
    tooltip: 'ComfyUI & AI-Toolkit, running on your servers',
  },
  {
    id: 'servers',
    label: 'Servers',
    icon: <Server size={16} />,
    tooltip: 'The physical hosts behind your services',
  },
  {
    id: 'doctor',
    label: 'Doctor',
    icon: <Stethoscope size={16} />,
    tooltip: 'Diagnose failures and slow jobs',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart2 size={16} />,
    tooltip: 'Numbers, time-series and breakdowns',
  },
]

// Side-bar visibility is gated by `canSee(role, page)` from lib/permissions
// — not a per-item adminOnly flag any more. The role table is the single
// source of truth, mirrored on the backend so a hidden item also gets a
// 403 if someone hits its API directly.
const ADMIN: NavItem[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    icon: <Calendar size={16} />,
    tooltip: 'Manage your calendar',
  },
  { id: 'clients', label: 'GT Users', icon: <Users size={16} />, tooltip: 'GearTracker users' },
  { id: 'users', label: 'Users', icon: <Building2 size={16} />, tooltip: 'Coffee Maker users' },
  {
    id: 'credentials',
    label: 'Credentials',
    icon: <KeyRound size={16} />,
    tooltip: 'Server logins, all in one place',
  },
  { id: 'seto', label: 'Seto', icon: <Bot size={16} />, tooltip: 'Your in-app assistant' },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: <Settings size={16} />,
    tooltip: 'Tweak your preferences',
  },
]

type Props = { page: Page; navigate: (p: Page) => void }

function NavGroup({
  items,
  page,
  navigate,
  role,
}: {
  items: NavItem[]
  page: Page
  navigate: (p: Page) => void
  role: import('../../lib/permissions').Role | null
}) {
  const visible = items.filter((i) => canSee(role, i.id))
  if (visible.length === 0) return null
  return (
    <div className="nav">
      {visible.map((item) => (
        <button
          key={item.id}
          className={`nav-item${page === item.id ? ' active' : ''}`}
          onClick={() => navigate(item.id)}
          title={item.tooltip}
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
          {item.badge != null && (
            <span className={`nav-badge${item.badgeWarn ? ' nav-badge-warn' : ''}`}>
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Sidebar({ page, navigate }: Props) {
  const { user, role, logout } = useAuth()
  const { servers, runningJobs } = useData()
  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase()
  // Down = probed and found offline (a server's failed ping, or a service's
  // failed reachability), excluding maintenance. Split so each nav item shows
  // its own count: hosts on Servers, ComfyUI/AI-Toolkit on Services.
  const isDown = (s: (typeof servers)[number]) => !s.isMaintenance && s.health?.status === 'offline'
  const downServers = servers.filter((s) => isHostRecord(s) && isDown(s)).length
  const downServices = servers.filter((s) => !isHostRecord(s) && isDown(s)).length

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand-mark">☕</div>
        <div>
          <div className="brand-name">GT Coffee Maker</div>
          <div className="brand-sub">internal brews</div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="sidebar-section">Workspace</div>
        <NavGroup items={WORKSPACE} page={page} navigate={navigate} role={role} />

        <div className="sidebar-section">Brews</div>
        <NavGroup
          items={TOOLS.map((item) => {
            if (item.id === 'servers' && downServers > 0)
              return { ...item, badge: downServers, badgeWarn: true }
            if (item.id === 'services' && downServices > 0)
              return { ...item, badge: downServices, badgeWarn: true }
            if (item.id === 'jobs' && runningJobs > 0) return { ...item, badge: runningJobs }
            return item
          })}
          page={page}
          navigate={navigate}
          role={role}
        />

        <div className="sidebar-section">Admin</div>
        <NavGroup items={ADMIN} page={page} navigate={navigate} role={role} />
      </div>

      <div className="sidebar-foot">
        <div className="avatar">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="user-name">{user?.username}</div>
          <div className="user-role">{user?.isAdmin ? 'Admin' : 'Member'}</div>
        </div>
        <button
          className="btn btn-ghost btn-icon"
          onClick={logout}
          title="Sign out"
          style={{ width: 28, height: 28 }}
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  )
}
