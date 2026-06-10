/**
 * SKILL.md helpers — minimal YAML-frontmatter handling, no new dependency.
 *
 * SKILL.md is a workflow-folder file with a YAML frontmatter block on top:
 *
 *   ---
 *   name: image-edit-qwen
 *   mediaType: image
 *   description: Edits an image with a Qwen-VL prompt
 *   ---
 *
 *   # Body in markdown...
 *
 * For our use case the frontmatter is always flat `key: value` pairs — name,
 * mediaType, description, etc. We don't need a full YAML parser; a focused
 * one keeps the dependency footprint zero and avoids the surprise behaviour
 * of full YAML (Norway problem, anchors, etc.) on workflow author content.
 *
 * If we ever need richer frontmatter (lists, nested objects), swap this for
 * the `yaml` package — the helper API is shaped to make that one-line swap.
 */
import { join } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'

export const SKILL_MD_FILENAME = 'SKILL.md'

/* ─── Parsing ─────────────────────────────────────────────────── */

export type Frontmatter = Record<string, unknown>

export type ParsedSkillMd = {
  /** True if the file existed on disk. */
  exists: boolean
  /** Raw file bytes as UTF-8. Empty string when the file doesn't exist. */
  raw: string
  /** Parsed frontmatter, or null if no `---`-delimited block was found. */
  frontmatter: Frontmatter | null
  /** Everything after the closing `---` (markdown body). */
  body: string
  /** Soft issues the parser couldn't represent — e.g. indented or list-style
   *  lines in frontmatter. The caller can surface these to the AI so it
   *  knows the round-trip will be lossy if it rewrites the file. */
  warnings: string[]
  /** Last-modified timestamp; null when the file doesn't exist. */
  modifiedAt: string | null
}

/** Coerce a raw YAML scalar string into a JS value — strings, numbers,
 *  booleans, null. Quote-stripping handles both single and double quotes. */
function parseScalar(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // Strip outer quotes and unescape minimally. We only support the common
  // escapes (\\ and \" / \') — anything more exotic is unlikely in SKILL.md.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1)
    return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
  }

  // Numbers — integers and decimals only. YAML's full numeric syntax is
  // overkill here.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed)
    if (!Number.isNaN(n)) return n
  }
  return trimmed
}

/** Parse a frontmatter block + body out of SKILL.md text. Resilient: if the
 *  file has no frontmatter, returns `frontmatter: null` and the whole text as
 *  the body. Indented lines / list items in the frontmatter are flagged in
 *  `warnings` rather than silently dropped. */
export function parseSkillMdText(text: string): {
  frontmatter: Frontmatter | null
  body: string
  warnings: string[]
} {
  // Frontmatter must be the very first thing in the file. Trailing newline
  // after the closing `---` is optional.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { frontmatter: null, body: text, warnings: [] }

  const fmText = m[1] ?? ''
  const body = text.slice(m[0].length)
  const fm: Frontmatter = {}
  const warnings: string[] = []

  for (const line of fmText.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (/^\s/.test(line)) {
      warnings.push(`Indented frontmatter line ignored: ${line.trim()}`)
      continue
    }
    if (line.trimStart().startsWith('-')) {
      warnings.push(`List-style frontmatter line ignored: ${line.trim()}`)
      continue
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) {
      warnings.push(`Malformed frontmatter line (no colon): ${line}`)
      continue
    }
    const key = line.slice(0, colonIdx).trim()
    const raw = line.slice(colonIdx + 1)
    fm[key] = parseScalar(raw)
  }

  return { frontmatter: fm, body, warnings }
}

/* ─── Serialising ─────────────────────────────────────────────── */

/** True when a string can be emitted as a YAML plain (unquoted) scalar. We
 *  err on the side of quoting — only well-behaved ASCII strings ship plain. */
function isSafePlainScalar(value: string): boolean {
  if (value.length === 0) return false
  if (/^[\s]/.test(value) || /[\s]$/.test(value)) return false // leading/trailing space
  if (/^[!&*?|>'"%@`{}[\]]/.test(value)) return false // YAML indicators as first char
  // Disallow chars that would confuse the parser later (colon, hash, etc.).
  // Note: `:` is fine inside a scalar as long as it's NOT followed by a
  // space; we still quote to keep things obvious for the reader.
  if (/[:#]/.test(value)) return false
  return true
}

function serialiseScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '"' + String(value) + '"'
  if (typeof value === 'string') {
    if (isSafePlainScalar(value)) return value
    // Double-quote and escape `"` and `\`. Newlines collapse to `\n` since
    // we don't emit block scalars in this minimal serialiser — SKILL.md
    // frontmatter values are short by convention.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }
  // Non-primitive — JSON-encode as a fallback so it round-trips, though our
  // parser will read it back as a string. Document this limitation if you
  // see a tool author hitting it.
  return JSON.stringify(value)
}

/** Build the full SKILL.md file text from a frontmatter object and a body
 *  string. Preserves key order from `Object.keys(frontmatter)`. A trailing
 *  newline is appended to the body if missing — Markdown rendering tools
 *  expect files to end with one. */
export function buildSkillMdText(frontmatter: Frontmatter, body: string): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${serialiseScalar(v)}`)
  }
  lines.push('---', '')
  const trailingNewline = body.endsWith('\n') ? '' : '\n'
  return lines.join('\n') + body + trailingNewline
}

/* ─── Disk I/O ────────────────────────────────────────────────── */

/** Read SKILL.md from a workflow's absolute folder path. Always returns a
 *  ParsedSkillMd — when the file doesn't exist, `exists` is false and the
 *  other fields are empty/null so the caller can render a consistent shape. */
export function readSkillMdAt(folderAbs: string): ParsedSkillMd {
  const abs = join(folderAbs, SKILL_MD_FILENAME)
  if (!existsSync(abs)) {
    return { exists: false, raw: '', frontmatter: null, body: '', warnings: [], modifiedAt: null }
  }
  const raw = readFileSync(abs, 'utf-8')
  const { frontmatter, body, warnings } = parseSkillMdText(raw)
  const stat = statSync(abs)
  return {
    exists: true,
    raw,
    frontmatter,
    body,
    warnings,
    modifiedAt: stat.mtime.toISOString(),
  }
}
