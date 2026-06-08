import { useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useNotifications } from '../context/NotificationsContext'
import { loadPrefs } from '../pages/preferences/PreferencesPage'

/**
 * Toast notifications for the user's own jobs as they complete.
 *
 * Polls `/api/jobs?userId=<mine>&status={completed|failed}` on a relaxed
 * interval and fires a notification for any id that wasn't in the previous
 * snapshot. The first poll is silent — we don't surprise the user with a
 * stream of toasts for jobs that finished before they opened the page.
 *
 * Skipped entirely when no GT user is linked in Preferences. The poll only
 * runs while the document is visible so we don't pile up notifications for
 * jobs that completed while the tab was backgrounded.
 */

const POLL_INTERVAL_MS = 30_000
const PAGE_SIZE = 10
// Cap the "new since last poll" burst so a backlog after waking from sleep
// doesn't paper the screen with toasts.
const MAX_BURST = 4

type JobLite = {
  type: 'wf' | 'lora'
  id: string
  name: string | null
  status: string
  finishedAt: string | null
  failedReason: string | null
}

type JobsPageLite = { items: JobLite[] }

export function useJobCompletionNotifications() {
  const { notify } = useNotifications()
  const seenIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    const prefs = loadPrefs()
    const userId = prefs.myGtUserId
    if (!userId) return

    let cancelled = false
    let timer: number | null = null

    async function poll() {
      if (document.visibilityState !== 'visible') {
        // Reschedule without polling so we don't burst on resume.
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        return
      }
      try {
        const [done, failed] = await Promise.all([
          api.get<JobsPageLite>(
            `/api/jobs?userId=${userId}&status=completed&limit=${PAGE_SIZE}&page=1`,
          ),
          api.get<JobsPageLite>(
            `/api/jobs?userId=${userId}&status=failed&limit=${PAGE_SIZE}&page=1`,
          ),
        ])
        if (cancelled) return
        const all = [...(done.items ?? []), ...(failed.items ?? [])]

        if (seenIds.current === null) {
          // First poll — establish the baseline silently.
          seenIds.current = new Set(all.map((j) => `${j.type}:${j.id}`))
        } else {
          const fresh: JobLite[] = []
          for (const j of all) {
            const key = `${j.type}:${j.id}`
            if (!seenIds.current.has(key)) {
              fresh.push(j)
              seenIds.current.add(key)
            }
          }
          // Newest first by finishedAt so the top toast is the most recent.
          fresh.sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
          for (const j of fresh.slice(0, MAX_BURST)) {
            const isFailed = j.status === 'failed'
            const kind = j.type === 'wf' ? 'Workflow' : 'LoRA'
            notify({
              variant: isFailed ? 'error' : 'success',
              title: isFailed ? `${kind} job failed` : `${kind} job completed`,
              body: j.name
                ? isFailed && j.failedReason
                  ? `${j.name} — ${j.failedReason.slice(0, 140)}`
                  : j.name
                : undefined,
            })
          }
        }
      } catch {
        // Network blip — try again next interval.
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [notify])
}
