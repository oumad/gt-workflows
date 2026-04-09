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
 * Colorize a JSON string for display. Returns an HTML string with inline-styled spans.
 * Uses VS Code dark-theme palette: keys=light-blue, strings=orange, numbers=green, booleans/null=blue.
 */
export function colorizeJson(json: string): string {
  const TOKEN_RE = /"(?:\\[\s\S]|[^"\\])*"\s*:|"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|true|false|null/g
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(json)) !== null) {
    result += esc(json.slice(lastIndex, match.index))
    const token = match[0]
    let color: string
    if (token[0] === '"') {
      color = /"\s*:$/.test(token) ? '#9cdcfe' : '#ce9178'
    } else if (token === 'true' || token === 'false' || token === 'null') {
      color = '#569cd6'
    } else {
      color = '#b5cea8'
    }
    result += `<span style="color:${color}">${esc(token)}</span>`
    lastIndex = TOKEN_RE.lastIndex
  }
  result += esc(json.slice(lastIndex))
  return result
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
