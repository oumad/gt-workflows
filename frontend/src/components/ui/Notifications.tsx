import { useEffect, useRef, useState } from 'react'
import { Check, AlertTriangle, AlertCircle, Info, X } from 'lucide-react'
import {
  useNotifications,
  type Notification,
  type NotifVariant,
} from '../../context/NotificationsContext'

/* ─── Variant tokens ─────────────────────────────────────────── */
const V: Record<
  NotifVariant,
  {
    bg: string
    border: string
    iconBg: string
    iconColor: string
    titleColor: string
    bodyColor: string
    closeColor: string
  }
> = {
  live: {
    bg: 'var(--ink)',
    border: '1px solid rgba(255,255,255,.1)',
    iconBg: 'transparent',
    iconColor: 'var(--accent)',
    titleColor: 'var(--bg)',
    bodyColor: 'rgba(255,255,255,.5)',
    closeColor: 'rgba(255,255,255,.5)',
  },
  success: {
    bg: 'var(--surface)',
    border: '1px solid var(--line)',
    iconBg: 'var(--good-soft)',
    iconColor: 'var(--good)',
    titleColor: 'var(--ink)',
    bodyColor: 'var(--ink-2)',
    closeColor: 'var(--ink-3)',
  },
  warn: {
    bg: 'var(--surface)',
    border: '1px solid var(--line)',
    iconBg: 'var(--warn-soft)',
    iconColor: 'var(--warn)',
    titleColor: 'var(--ink)',
    bodyColor: 'var(--info)',
    closeColor: 'var(--ink-3)',
  },
  error: {
    bg: 'var(--surface)',
    border: '1px solid var(--line)',
    iconBg: 'var(--bad-soft)',
    iconColor: 'var(--bad)',
    titleColor: 'var(--ink)',
    bodyColor: 'var(--ink-2)',
    closeColor: 'var(--ink-3)',
  },
  info: {
    bg: 'var(--surface)',
    border: '1px solid var(--line)',
    iconBg: 'var(--info-soft)',
    iconColor: 'var(--info)',
    titleColor: 'var(--ink)',
    bodyColor: 'var(--ink-2)',
    closeColor: 'var(--ink-3)',
  },
}

const ACCENT_BORDER: Partial<Record<NotifVariant, string>> = {
  success: 'var(--good)',
  warn: 'var(--warn)',
  error: 'var(--bad)',
  info: 'var(--info)',
}

function DefaultIcon({ variant }: { variant: NotifVariant }) {
  if (variant === 'live') {
    return (
      <span
        style={{
          display: 'block',
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: 'var(--accent)',
          boxShadow: '0 0 0 3px color-mix(in oklab, var(--accent) 30%, transparent)',
          animation: 'notif-pulse 1.4s ease-in-out infinite',
        }}
      />
    )
  }
  const icons: Record<NotifVariant, React.ReactNode> = {
    success: <Check size={15} strokeWidth={2.5} />,
    warn: <AlertTriangle size={15} strokeWidth={2.5} />,
    error: <AlertCircle size={15} strokeWidth={2.5} />,
    info: <Info size={15} strokeWidth={2.5} />,
    live: null,
  }
  return <>{icons[variant]}</>
}

/* ─── Single toast card ──────────────────────────────────────── */
function NotifCard({ n, onDismiss }: { n: Notification; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  const v = V[n.variant]
  const accentBorder = ACCENT_BORDER[n.variant]
  const action = n.action

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleDismiss() {
    setVisible(false)
    setTimeout(onDismiss, 220)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        background: v.bg,
        border: v.border,
        borderLeft: accentBorder ? `3px solid ${accentBorder}` : v.border,
        borderRadius: 10,
        boxShadow: 'var(--shadow-lg)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(18px)',
        transition: 'opacity .2s ease, transform .2s ease',
        pointerEvents: 'all',
      }}
    >
      {/* Icon */}
      <div
        style={{
          flexShrink: 0,
          width: n.variant === 'live' ? 'auto' : 32,
          height: n.variant === 'live' ? 'auto' : 32,
          borderRadius: 8,
          background: v.iconBg,
          display: 'grid',
          placeItems: 'center',
          color: v.iconColor,
          marginTop: n.variant === 'live' ? 3 : 0,
        }}
      >
        {n.icon ?? <DefaultIcon variant={n.variant} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: v.titleColor, lineHeight: 1.3 }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{ fontSize: 12.5, color: v.bodyColor, marginTop: 3, lineHeight: 1.45 }}>
            {n.body}
          </div>
        )}
        {action && (
          <button
            onClick={() => {
              action.onClick()
              handleDismiss()
            }}
            style={{
              marginTop: 8,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${v.closeColor}`,
              background: 'transparent',
              color: v.titleColor,
              cursor: 'pointer',
            }}
          >
            {action.label}
          </button>
        )}
      </div>

      {/* Close */}
      <button
        onClick={handleDismiss}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 2,
          color: v.closeColor,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 4,
          marginTop: 1,
        }}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}

/* ─── Toast stack ────────────────────────────────────────────── */
export function Notifications() {
  const { notifications, dismiss } = useNotifications()
  const injectedRef = useRef(false)

  // Inject keyframes once
  useEffect(() => {
    if (injectedRef.current) return
    injectedRef.current = true
    const style = document.createElement('style')
    style.textContent = `
      @keyframes notif-pulse {
        0%, 100% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 30%, transparent); }
        50%       { box-shadow: 0 0 0 6px color-mix(in oklab, var(--accent) 10%, transparent); }
      }
    `
    document.head.appendChild(style)
  }, [])

  if (notifications.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 'var(--z-toast)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 380,
        pointerEvents: 'none',
      }}
    >
      {notifications.map((n) => (
        <NotifCard key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
      ))}
    </div>
  )
}
