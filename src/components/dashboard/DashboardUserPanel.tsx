import { useState, useMemo } from 'react'
import { UserX, X, Search } from 'lucide-react'

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

const BADGE_STYLES: Record<number, React.CSSProperties> = {
  1: { background: 'linear-gradient(135deg,#d4a335,#f5c842)', color: '#1a1200', boxShadow: '0 0 6px rgba(212,163,53,0.35)' },
  2: { background: 'linear-gradient(135deg,#8b9aab,#c0c8d2)', color: '#1a2332', boxShadow: '0 0 6px rgba(139,154,171,0.25)' },
  3: { background: 'linear-gradient(135deg,#b45309,#d97706)', color: '#1a1200', boxShadow: '0 0 6px rgba(180,83,9,0.25)' },
}

export function DashboardUserPanel({
  isAdmin, anonymiseUsers, selectedUser, userActivity,
  getDisplayName, onToggleAnonymise, onClearUser, onSelectUser,
}: DashboardUserPanelProps) {
  const [search, setSearch] = useState('')

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return userActivity
    return userActivity.filter((item) => {
      const display = getDisplayName(item.user).toLowerCase()
      return display.includes(q) || item.user.toLowerCase().includes(q)
    })
  }, [userActivity, search, getDisplayName])

  const maxCount = userActivity.length ? userActivity[0].count : 1

  return (
    <div className="bg-primary border border-default rounded-[10px] px-[1.15rem] pt-4 pb-3 flex flex-col gap-[0.35rem] min-h-0 overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.06em] text-muted mb-[0.1rem]">
        <span>Who&apos;s using</span>
        <span className="inline-flex items-center justify-center min-w-[1.4em] px-[0.35em] py-[0.05em] rounded-full text-sm font-bold bg-[rgba(45,58,74,0.6)] text-muted normal-case tracking-normal">
          {userActivity.length}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {isAdmin && (
            <button
              type="button"
              className={`inline-flex items-center gap-[0.2rem] px-[0.45rem] py-[0.2rem] text-xs font-medium bg-transparent border border-default rounded cursor-pointer transition-all duration-150 normal-case tracking-normal ${anonymiseUsers ? 'bg-accent/[0.12] border-accent/30 text-accent-light' : 'text-muted hover:border-accent hover:text-accent-light'}`}
              onClick={onToggleAnonymise}
              title={anonymiseUsers ? 'Show real user names' : 'Anonymise user names'}
              aria-pressed={anonymiseUsers}
            >
              <UserX size={11} />
              {anonymiseUsers ? 'Show' : 'Hide'}
            </button>
          )}
          {selectedUser && (
            <button
              type="button"
              className="inline-flex items-center justify-center px-[0.3rem] py-[0.2rem] bg-transparent border border-default rounded text-muted cursor-pointer transition-all duration-150 hover:bg-semantic-error/10 hover:border-semantic-error/30 hover:text-semantic-error"
              onClick={onClearUser}
              title="Clear selection"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      {userActivity.length > 3 && (
        <div className="relative">
          <Search size={12} className="absolute left-[0.4rem] top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
          <input
            type="search"
            className="w-full pl-[1.4rem] pr-[0.4rem] py-[0.25rem] text-sm border border-default rounded-[5px] bg-[rgba(15,20,25,0.6)] text-primary placeholder:text-muted focus:outline-none focus:border-accent transition-[border-color] min-w-[110px]"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
      )}

      {/* Selected user badge */}
      {selectedUser && (
        <div className="text-sm text-muted px-[0.45rem] py-1 bg-accent/[0.08] rounded border-l-[3px] border-accent">
          Viewing: <strong className="text-accent-light">{getDisplayName(selectedUser)}</strong>
        </div>
      )}

      {/* User list */}
      {userActivity.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">No user data in range.</div>
      ) : filteredUsers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">No matching users.</div>
      ) : (
        <ul className="activity-rank-list list-none m-0 pr-2 overflow-y-auto flex-1 min-h-0 flex flex-col gap-0">
          {filteredUsers.map((item) => {
            const rank = userActivity.indexOf(item)
            const isSelected = selectedUser === item.user
            const barPct = (item.count / maxCount) * 100
            return (
              <li
                key={item.user}
                className={`group grid grid-cols-[1fr_auto] gap-[0.4rem] pb-[0.2rem] text-sm cursor-pointer rounded-md px-[0.3rem] py-[0.1rem] -mx-[0.3rem] transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-[rgba(147,102,204,0.1)]'}`}
                onClick={() => onSelectUser(item.user)}
                title={anonymiseUsers ? 'See workflows used by this user' : `See workflows used by ${item.user}`}
              >
                <span className={`overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[0.2rem] ${isSelected ? 'text-[#b88ae6]' : 'text-primary group-hover:text-[#c9a6f0]'}`}>
                  {rank < 3 && (
                    <span
                      className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full text-sm font-bold shrink-0 mr-[0.35rem] leading-none"
                      style={BADGE_STYLES[rank + 1]}
                    >
                      {rank + 1}
                    </span>
                  )}
                  {getDisplayName(item.user)}
                </span>
                <span className={`font-medium tabular-nums text-right text-sm ${isSelected ? 'text-accent-light' : 'text-muted'}`}>
                  {item.count}
                </span>
                <div className="col-span-full h-[5px] rounded-[3px] bg-[rgba(45,58,74,0.4)] overflow-hidden">
                  <div
                    className="h-full rounded-[3px] transition-[width] duration-300"
                    style={{
                      width: `${barPct}%`,
                      background: isSelected
                        ? 'linear-gradient(90deg,#7a4db0,#b88ae6)'
                        : 'linear-gradient(90deg,#6a3fa0,#9366cc)',
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
