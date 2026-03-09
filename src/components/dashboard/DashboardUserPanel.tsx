import { Users, UserX, X } from 'lucide-react'

interface UserActivityItem {
  user: string
  count: number
}

interface DashboardUserPanelProps {
  isAdmin: boolean
  anonymiseUsers: boolean
  selectedUser: string | null
  userActivity: UserActivityItem[]
  getDisplayName: (userId: string | null) => string
  onToggleAnonymise: () => void
  onClearUser: () => void
  onSelectUser: (user: string) => void
}

export function DashboardUserPanel({
  isAdmin, anonymiseUsers, selectedUser, userActivity,
  getDisplayName, onToggleAnonymise, onClearUser, onSelectUser,
}: DashboardUserPanelProps) {
  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-header">
        <Users size={18} />
        <span>Who&apos;s using</span>
        {isAdmin && (
          <button
            type="button"
            className="dashboard-anonymise-btn"
            onClick={onToggleAnonymise}
            title={anonymiseUsers ? 'Show real user names' : 'Anonymise user names'}
            aria-pressed={anonymiseUsers}
          >
            <UserX size={14} />
            {anonymiseUsers ? 'Show names' : 'Anonymise'}
          </button>
        )}
        {selectedUser && (
          <button type="button" className="dashboard-clear-user" onClick={onClearUser} title="Show all">
            <X size={14} />
          </button>
        )}
      </div>
      {!selectedUser && userActivity.length > 0 && (
        <p className="dashboard-sidebar-total">
          {userActivity.length} user{userActivity.length !== 1 ? 's' : ''} in range
        </p>
      )}
      <div className="dashboard-who-using-body">
        {selectedUser && (
          <div className="dashboard-viewing-badge">
            Viewing: <strong>{getDisplayName(selectedUser)}</strong>
          </div>
        )}
        {userActivity.length === 0 ? (
          <p className="dashboard-sidebar-empty">No user data in range.</p>
        ) : (
          <ul className="dashboard-user-list">
            {userActivity.map((item, index) => (
              <li key={item.user}>
                <button
                  type="button"
                  className={`dashboard-user-btn ${selectedUser === item.user ? 'selected' : ''}`}
                  onClick={() => onSelectUser(item.user)}
                  title={anonymiseUsers ? 'See workflows used by this user' : `See workflows used by ${item.user}`}
                >
                  <span className="dashboard-user-name" title={!anonymiseUsers ? item.user : undefined}>
                    {getDisplayName(item.user)}{index === 0 ? ' 🏆' : ''}
                  </span>
                  <span className="dashboard-user-count">{item.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
