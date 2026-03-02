/**
 * Utilities for parsing and formatting ComfyUI-style log content.
 */

export interface LogEntry {
  t?: string
  m?: string
}

/**
 * Parse JSON log content with an "entries" array. Returns null if invalid.
 */
export function tryParseLogEntries(content: string | null): LogEntry[] | null {
  if (content == null) return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const data = JSON.parse(content) as { entries?: unknown };
    const entries = data?.entries;
    if (!Array.isArray(entries)) return null;
    const valid = entries.every(
      (e) => e != null && typeof e === 'object' && ('t' in e || 'm' in e)
    );
    return valid ? (entries as LogEntry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Format an ISO timestamp for display (e.g. "2024-01-15 12:34:56.789").
 */
export function formatLogTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 23);
  } catch {
    return String(iso);
  }
}

/**
 * Prettify JSON string for raw display. Returns original string if not valid JSON.
 */
export function tryPrettifyJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }
  return raw;
}
