import { createContext, useContext, useState, useCallback, useRef } from 'react'

export type NotifVariant = 'success' | 'error' | 'warn' | 'info' | 'live'

export interface Notification {
  id: string
  variant: NotifVariant
  title: string
  body?: string
  icon?: React.ReactNode
  action?: { label: string; onClick: () => void }
  autoDismiss?: number // ms; 0 = manual dismiss only
}

export type NotifInput = Omit<Notification, 'id'>

interface NotificationsCtx {
  notifications: Notification[]
  notify: (n: NotifInput) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

const Ctx = createContext<NotificationsCtx | null>(null)

const DEFAULT_DISMISS: Partial<Record<NotifVariant, number>> = {
  success: 4000,
  info: 5000,
  warn: 7000,
  error: 8000,
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Notification[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setList((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
    setList([])
  }, [])

  const notify = useCallback(
    (input: NotifInput): string => {
      const id = Math.random().toString(36).slice(2)
      const autoDismiss = input.autoDismiss ?? DEFAULT_DISMISS[input.variant] ?? 0
      const notif: Notification = { ...input, id, autoDismiss }
      setList((prev) => [notif, ...prev].slice(0, 7))
      if (autoDismiss > 0) {
        const t = setTimeout(() => dismiss(id), autoDismiss)
        timers.current.set(id, t)
      }
      return id
    },
    [dismiss],
  )

  return (
    <Ctx.Provider value={{ notifications: list, notify, dismiss, dismissAll }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
