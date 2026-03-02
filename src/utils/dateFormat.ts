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
