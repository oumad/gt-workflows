/**
 * Shared date/time formatters. Use these instead of inline toLocaleString/toISOString.
 */

/**
 * Format ISO timestamp for "last run" style: "Jan 15, 2024, 2:34 PM".
 */
export function formatDateTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Format ISO timestamp with seconds: "Jan 15, 2:34:56 PM".
 */
export function formatDateTimeWithSeconds(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Format for activity/processed dates: medium date, medium time.
 * Accepts ISO string or milliseconds.
 */
export function formatDateTimeMedium(isoOrMs: string | number): string {
  try {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  } catch {
    return typeof isoOrMs === 'number' ? '—' : String(isoOrMs);
  }
}

/**
 * Format a timestamp as a human-readable relative time string.
 * e.g. "just now", "45s ago", "3m ago", "2h ago", "1d ago"
 */
export function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const s = Math.floor(diffMs / 1000)
    if (s < 10) return 'just now'
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch {
    return '—'
  }
}

/**
 * Format for dashboard job time: short date, medium time.
 * Accepts ISO string or milliseconds.
 */
export function formatDateShortTimeMedium(isoOrMs: string | number): string {
  try {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return typeof isoOrMs === 'number' ? '—' : String(isoOrMs);
  }
}
