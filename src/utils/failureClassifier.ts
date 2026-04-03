/**
 * Classify a Bull job failure reason into a human-readable category.
 * Used across Doctor view, job modals, and slow jobs panel.
 */

export type FailureCategory =
  | 'timeout'
  | 'oom'
  | 'cancelled'
  | 'network'
  | 'server_error'
  | 'unknown'

export interface FailureClassification {
  category: FailureCategory
  label: string
  /** Tailwind color classes for badge text + bg + border */
  colorClass: string
  /** Short emoji/icon hint */
  icon: string
}

const CLASSIFICATIONS: Record<FailureCategory, Omit<FailureClassification, 'category'>> = {
  timeout: {
    label: 'Timeout',
    colorClass: 'text-amber-400 bg-amber-400/10 border-amber-400/25',
    icon: '⏱',
  },
  oom: {
    label: 'Out of Memory',
    colorClass: 'text-red-400 bg-red-400/10 border-red-400/25',
    icon: '💾',
  },
  cancelled: {
    label: 'Cancelled',
    colorClass: 'text-slate-400 bg-slate-400/10 border-slate-400/25',
    icon: '✕',
  },
  network: {
    label: 'Network Error',
    colorClass: 'text-orange-400 bg-orange-400/10 border-orange-400/25',
    icon: '🌐',
  },
  server_error: {
    label: 'Server Error',
    colorClass: 'text-red-500 bg-red-500/10 border-red-500/25',
    icon: '⚠',
  },
  unknown: {
    label: 'Unknown',
    colorClass: 'text-muted bg-[rgba(45,58,74,0.4)] border-default',
    icon: '?',
  },
}

export function classifyFailure(
  failedReason: string | null | undefined,
  /** duration in ms — used to detect timeout when reason is ambiguous */
  durationMs?: number | null,
  /** configured timeout in ms */
  timeoutMs?: number | null,
): FailureClassification {
  const r = (failedReason ?? '').toLowerCase()

  let category: FailureCategory = 'unknown'

  if (r.includes('timeout') || r.includes('timed out') || r.includes('time out')) {
    category = 'timeout'
  } else if (
    r.includes('cuda out of memory') ||
    r.includes('out of memory') ||
    r.includes('oom') ||
    r.includes('vram') ||
    r.includes('memory error') ||
    r.includes('alloc') && r.includes('memory')
  ) {
    category = 'oom'
  } else if (
    r.includes('interrupt') ||
    r.includes('cancel') ||
    r.includes('abort') ||
    r.includes('user stop')
  ) {
    category = 'cancelled'
  } else if (
    r.includes('econnrefused') ||
    r.includes('econnreset') ||
    r.includes('fetch failed') ||
    r.includes('network') ||
    r.includes('socket') ||
    (r.includes('http') && (r.includes('502') || r.includes('503') || r.includes('504')))
  ) {
    category = 'network'
  } else if (
    r.includes('error') ||
    r.includes('exception') ||
    r.includes('traceback') ||
    r.includes('typeerror') ||
    r.includes('valueerror') ||
    r.includes('runtimeerror')
  ) {
    category = 'server_error'
  }

  // If still unknown but duration exceeded configured timeout → classify as timeout
  if (
    category === 'unknown' &&
    durationMs != null &&
    timeoutMs != null &&
    durationMs >= timeoutMs * 0.98
  ) {
    category = 'timeout'
  }

  return { category, ...CLASSIFICATIONS[category] }
}

/** Format duration in ms to human readable string */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Tailwind color class for a duration value */
export function durationColorClass(ms: number | null | undefined): string {
  if (ms == null) return 'text-muted'
  const s = ms / 1000
  if (s < 60)  return 'text-emerald-400'
  if (s < 300) return 'text-primary'
  if (s < 600) return 'text-amber-400'
  return 'text-red-400'
}
