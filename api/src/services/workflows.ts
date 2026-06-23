/**
 * Business logic for workflows. Workflows live as folders on disk under
 * WORKFLOWS_DIR, one folder per workflow. This service owns:
 *  - reading the folder list into wire DTOs
 *  - per-workflow file reads/writes (params.json, workflow.json, icons)
 *  - create / patch / delete / duplicate
 *  - snapshot history (list, restore)
 *
 * Filesystem helpers (zip-slip guard, snapshots) live in lib/workflowFs.ts.
 * Import flows live in services/workflowImport.ts.
 * Test + audit (ComfyUI proxy) live in services/workflowTest.ts.
 */
import { readdirSync, existsSync, readFileSync, statSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { zipDirectory, zipSources, type ZipSource } from '../lib/zip.js'
import {
  getWorkflowsDir,
  isInsideDir,
  snapshotWorkflow,
  snapshotWorkflowAsync,
  writeFileAtomic,
  listSnapshots,
  historyRoot,
} from '../lib/workflowFs.js'
import {
  loadGlobalEnv,
  resolveServerRef,
  serverRefKey,
  setGlobalEnvKeys,
  isUnbound,
  type GlobalEnvMap,
} from './globalEnv.js'
import { config } from '../config/index.js'
import { notFound, badRequest, forbidden, conflict, internalError } from '../lib/httpError.js'
import type {
  ParamsJson,
  NormalizedIconBadge,
  WorkflowSummary,
  WorkflowItem,
  HistoryEntry,
} from '../models/workflows.js'
import type { CreateWorkflowInput, PatchWorkflowInput } from '../validators/workflows.js'

/* ─── Slug / category inference ─────────────────────────────── */

const CATEGORY_MAP: [RegExp, string][] = [
  [/lora|training/i, 'Training'],
  [/video|wan/i, 'Video'],
  [/caption|extract/i, 'Data'],
  [
    /image|render|layout|sketch|paint|vinyl|material|object|multiview|lighting|car|background|seamless|upscale|enhance|transfer|integrate|360/i,
    'Image',
  ],
]

export function inferCategory(name: string): string {
  for (const [re, cat] of CATEGORY_MAP) if (re.test(name)) return cat
  return 'General'
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/* ─── params.json IO ────────────────────────────────────────── */

export function findEntry(dir: string, id: string) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .find((e) => slugify(e.name) === id)
}

export function readParams(folderPath: string): ParamsJson {
  const p = join(folderPath, 'params.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ParamsJson
  } catch {
    return {}
  }
}

export function writeParams(folderPath: string, params: ParamsJson): void {
  writeFileAtomic(join(folderPath, 'params.json'), JSON.stringify(params, null, 2))
}

/** Normalize a `params.iconBadge` blob into the trimmed shape the UI uses.
 *  Returns null when content is missing or empty — the UI hides the chip then. */
export function normalizeIconBadge(raw: ParamsJson['iconBadge']): NormalizedIconBadge | null {
  if (!raw || typeof raw !== 'object') return null
  const label = typeof raw.content === 'string' ? raw.content.trim() : ''
  if (!label) return null
  return {
    label,
    bg: typeof raw.backgroundColor === 'string' ? raw.backgroundColor : null,
    color: typeof raw.color === 'string' ? raw.color : null,
  }
}

/** The raw server references a workflow targets, exactly as stored in
 *  `comfyui_config.serverUrl` (one or a list): literal URLs and/or
 *  `globalEnv.<key>` binding tokens. Use this for the editor and any
 *  read→edit→write round-trip, so a binding token is never silently baked
 *  into its resolved URL. */
export function comfyServerRefs(params: ParamsJson): string[] {
  const raw = params.comfyui_config?.serverUrl
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return list.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
}

/** The real server URLs a workflow targets — `globalEnv.<key>` tokens resolved
 *  against the WS config (a pool key expands to several URLs); literal URLs
 *  pass through unchanged. Use for listing, dispatch, display and
 *  server-matching. An unresolved token falls back to default → localhost
 *  (resolveServerRef never throws). */
export function comfyServerUrls(params: ParamsJson): string[] {
  const map = loadGlobalEnv()
  return comfyServerRefs(params).flatMap((ref) => resolveServerRef(ref, map))
}

/** Write a workflow's server list back to `comfyui_config.serverUrl` — a bare
 *  string for a single server, an array for several, `[]` for none. Also clears
 *  the legacy top-level `servers` / `serverIds` keys, which are no longer used. */
export function setComfyServerUrls(params: ParamsJson, urls: string[]): void {
  const clean = urls.map((u) => u.trim()).filter(Boolean)
  const cfg = params.comfyui_config ?? (params.comfyui_config = {})
  cfg.serverUrl = clean.length === 1 ? clean[0]! : clean
  delete params.servers
  delete params.serverIds
}

/** Distinct `globalEnv.<key>` keys referenced across every workflow's raw
 *  server refs. Drives the migration preview and the additive sync-reconcile. */
export function referencedGlobalEnvKeys(): string[] {
  const dir = getWorkflowsDir()
  const keys = new Set<string>()
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'script') continue
      for (const ref of comfyServerRefs(readParams(join(dir, entry.name)))) {
        const key = serverRefKey(ref)
        if (key != null) keys.add(key)
      }
    }
  }
  return [...keys].sort()
}

/** "N workflows need a server" nudge: workflows that reference a globalEnv key
 *  currently bound ONLY to the localhost placeholder (auto-created by reconcile
 *  during a sync, not yet pointed at a real server). */
export function serverNudge(): { needsServer: number } {
  const map = loadGlobalEnv()
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return { needsServer: 0 }
  let needsServer = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'script') continue
    const needs = comfyServerRefs(readParams(join(dir, entry.name))).some((ref) => {
      const key = serverRefKey(ref)
      const v = key != null ? map[key] : undefined
      return v != null && isUnbound(v)
    })
    if (needs) needsServer++
  }
  return { needsServer }
}

/** Migration generator/viewer: distinct referenced tokens diffed against the
 *  current WS config — which binding keys still need a URL. */
export function globalEnvPreview(): { referenced: string[]; present: string[]; missing: string[] } {
  const map = loadGlobalEnv()
  const refs = referencedGlobalEnvKeys()
  return {
    referenced: refs,
    present: refs.filter((k) => map[k] != null),
    missing: refs.filter((k) => map[k] == null),
  }
}

/** The complete `workflowStudio.globalEnv` block Workflow Studio should hold:
 *  every key referenced by a workflow (current value preserved, or the
 *  localhost placeholder if not bound yet) plus a `default` server. This is the
 *  "what to put in WS config" view — an operator can copy it back if the WS
 *  config is reset, and it shows which keys still point at localhost. */
export function globalEnvBlock(): { workflowStudio: { globalEnv: GlobalEnvMap } } {
  const map = loadGlobalEnv()
  const placeholder = 'http://127.0.0.1:8188'
  const globalEnv: GlobalEnvMap = { default: map['default'] ?? placeholder }
  for (const key of referencedGlobalEnvKeys()) globalEnv[key] = map[key] ?? placeholder
  return { workflowStudio: { globalEnv } }
}

/** A literal server URL that points at a real (non-loopback) host — exactly
 *  what must NOT be committed to git. Tokens and localhost placeholders are
 *  fine; an unparseable literal is treated as a violation (fail safe). Exported
 *  for the tokenization migration (which lifts exactly these into globalEnv). */
export function isLiteralRealUrl(ref: string): boolean {
  if (serverRefKey(ref) != null) return false // globalEnv token — fine
  let host: string
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ? ref : `http://${ref}`,
    ).hostname.toLowerCase()
  } catch {
    return true
  }
  return !(
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  )
}

/** Deterministic canonical pin key for a workflow — `url_<camelCaseId>`. Pure
 *  function of the id, so canonicalizing a literal serverUrl is never fragile. */
export function canonicalKey(id: string): string {
  const camel = id
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  return camel ? `url_${camel}` : 'default'
}

/** Make a workflow git-clean: replace any LITERAL serverUrl with this workflow's
 *  canonical token, lifting the literal into this env's (gitignored) globalEnv
 *  binding so the URL isn't lost. Existing tokens are kept. Git then only ever
 *  stores `globalEnv.<key>`. No-op when already all tokens. Called on publish. */
export function canonicalizeServerUrl(folderName: string): void {
  const folderPath = join(getWorkflowsDir(), folderName)
  const params = readParams(folderPath)
  const refs = comfyServerRefs(params)
  const literals = refs.filter((r) => serverRefKey(r) == null)
  if (literals.length === 0) return
  const key = canonicalKey(slugify(folderName))
  if (config.WS_CONFIG_PATH) setGlobalEnvKeys({ [key]: literals }) // keep the URL(s) as the binding
  const token = `globalEnv.${key}`
  setComfyServerUrls(params, [...new Set(refs.map((r) => (serverRefKey(r) == null ? token : r)))])
  writeParams(folderPath, params)
}

/** Re-apply the pre-pull (local) serverUrl from a snapshot after an Update —
 *  serverUrl is env-local, so a user's binding choice (custom URL, localhost, a
 *  different globalEnv key) survives a pull even when the remote changed the
 *  workflow. No-op if the local had none, or it's unchanged, or the workflow is
 *  gone. The pre-pull value is always in `.history` regardless. */
export function restoreLocalServerUrl(folderName: string, snapDir: string): void {
  const folderPath = join(getWorkflowsDir(), folderName)
  if (!existsSync(join(folderPath, 'params.json'))) return
  const localRefs = comfyServerRefs(readParams(snapDir))
  if (localRefs.length === 0) return // local never set one — keep the remote's
  const cur = readParams(folderPath)
  if (comfyServerRefs(cur).join(' ') === localRefs.join(' ')) return // unchanged
  setComfyServerUrls(cur, localRefs)
  writeParams(folderPath, cur)
}

/** Validate-on-publish guard: for the given repo-relative changed paths, reject
 *  invalid JSON and literal real server URLs (the secrets guard — real URLs are
 *  env-specific and must be bound to a globalEnv key first). Returns a list of
 *  human-readable violations; empty means OK to publish. */
export function validateForPublish(changedPaths: string[]): string[] {
  const dir = resolve(getWorkflowsDir())
  const violations: string[] = []
  for (const p of changedPaths) {
    const abs = resolve(join(dir, p))
    if (!isInsideDir(abs, dir) || !existsSync(abs)) continue // escaped / deleted — skip
    const base = p.split('/').pop() ?? ''
    if (base === 'params.json') {
      let params: ParamsJson
      try {
        params = JSON.parse(readFileSync(abs, 'utf-8')) as ParamsJson
      } catch {
        violations.push(`${p}: invalid JSON`)
        continue
      }
      for (const ref of comfyServerRefs(params)) {
        if (isLiteralRealUrl(ref)) {
          violations.push(`${p}: literal server URL "${ref}" — bind it to a globalEnv key first`)
        }
      }
    } else if (base.endsWith('.json')) {
      try {
        JSON.parse(readFileSync(abs, 'utf-8'))
      } catch {
        violations.push(`${p}: invalid JSON`)
      }
    }
  }
  return violations
}

/* ─── Listing ───────────────────────────────────────────────── */

export function readWorkflows(): WorkflowItem[] {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return []

  const entries = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'script',
  )

  const items = entries.flatMap((entry) => {
    const params = readParams(join(dir, entry.name))
    const stat = statSync(join(dir, entry.name))
    const id = slugify(entry.name)
    const name = params.label ?? entry.name
    const category = params.category ?? inferCategory(entry.name)
    const born = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime

    return [
      {
        id,
        name,
        path: entry.name,
        description: params.description ?? null,
        category,
        serverUrls: comfyServerUrls(params),
        serverRefs: comfyServerRefs(params),
        icon: params.icon ?? null,
        iconBadge: normalizeIconBadge(params.iconBadge),
        tags: params.tags ?? [],
        timeout: params.timeout ?? null,
        devMode: params.devMode ?? false,
        tested: params.tested ?? false,
        audited: params.audited ?? false,
        parser: params.parser ?? null,
        workflowFile: params.workflowFile ?? params.comfyui_config?.workflow ?? null,
        order: params.order ?? 999,
        createdAt: born.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      },
    ]
  })

  return items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

function toSummary(item: WorkflowItem): WorkflowSummary {
  const { order: _o, ...rest } = item
  return rest
}

export function listWorkflows(category?: string | null): WorkflowSummary[] {
  let items = readWorkflows()
  if (category) items = items.filter((w) => w.category === category)
  return items.map(toSummary)
}

export function getWorkflowSummary(id: string): WorkflowSummary | null {
  const item = readWorkflows().find((w) => w.id === id)
  return item ? toSummary(item) : null
}

/** Resolve folder name for an id, or throw notFound. Used by every file-touch
 *  endpoint to centralize the existence check. */
export function resolveFolder(id: string): { folderAbs: string; folderName: string } {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) throw notFound('Workflow not found')
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')
  return { folderAbs: resolve(join(dir, entry.name)), folderName: entry.name }
}

/* ─── Icon & raw file reads ─────────────────────────────────── */

export interface IconResponse {
  buffer: Buffer
  mime: string
}

const ICON_MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  webp: 'image/webp',
}

export function getIcon(id: string): IconResponse | null {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return null
  const entry = findEntry(dir, id)
  if (!entry) return null

  const params = readParams(join(dir, entry.name))
  if (!params.icon) return null

  const folderAbs = resolve(join(dir, entry.name))
  const iconAbs = resolve(join(folderAbs, params.icon))
  if (!isInsideDir(iconAbs, folderAbs)) return null
  if (!existsSync(iconAbs)) return null

  const ext = iconAbs.split('.').pop()?.toLowerCase() ?? ''
  return { buffer: readFileSync(iconAbs), mime: ICON_MIME[ext] ?? 'image/jpeg' }
}

export type WorkflowFileKind = 'params' | 'workflow'

export function readWorkflowFile(id: string, kind: WorkflowFileKind): Buffer {
  if (kind !== 'params' && kind !== 'workflow') throw badRequest('Unknown file kind')
  const { folderAbs } = resolveFolder(id)
  if (kind === 'params') {
    const p = join(folderAbs, 'params.json')
    return existsSync(p) ? readFileSync(p) : Buffer.from('{}')
  }
  const params = readParams(folderAbs)
  const wfFile = params.comfyui_config?.workflow ?? 'workflow.json'
  const wfAbs = resolve(join(folderAbs, wfFile))
  if (!isInsideDir(wfAbs, folderAbs)) throw forbidden()
  if (!existsSync(wfAbs)) throw notFound(`Workflow file not found: ${wfFile}`)
  return readFileSync(wfAbs)
}

export function writeParamsFile(id: string, body: unknown): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('params.json must be a JSON object')
  }
  const { folderAbs } = resolveFolder(id)
  writeFileAtomic(join(folderAbs, 'params.json'), JSON.stringify(body, null, 2))
  snapshotWorkflowAsync(id, folderAbs, 'params')
}

export function writeWorkflowFile(id: string, body: unknown): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Workflow must be a JSON object {}')
  }
  const { folderAbs } = resolveFolder(id)
  const params = readParams(folderAbs)
  const wfFile = params.workflowFile ?? params.comfyui_config?.workflow ?? 'workflow.json'
  const wfAbs = resolve(join(folderAbs, wfFile))
  if (!isInsideDir(wfAbs, folderAbs)) throw forbidden()
  writeFileAtomic(wfAbs, JSON.stringify(body, null, 2))
  snapshotWorkflowAsync(id, folderAbs, 'workflow')
}

/* ─── ZIP export ────────────────────────────────────────────── */

export interface ExportZip {
  buffer: Buffer
  filename: string
}

/** Embedded in every export so whoever imports the workflows elsewhere
 *  understands the binding model (the export carries TOKENS, never real URLs). */
const EXPORT_README =
  '# Workflows export\n\n' +
  'These workflows reference their ComfyUI server(s) through a portable token,\n' +
  '`comfyui_config.serverUrl = "globalEnv.<key>"`, NOT a real URL. The real,\n' +
  "environment-specific URL lives in Workflow Studio's per-env config\n" +
  '(`workflowStudio.globalEnv`), which is intentionally NOT included here.\n\n' +
  'On import into another environment, any referenced key that has no URL yet\n' +
  'defaults to `http://127.0.0.1:8188` (a local placeholder) — the app will then\n' +
  'nudge "N workflows need a server". Bind each key to a real server via the\n' +
  "server picker (or Workflow Studio's globalEnv) to run them.\n\n" +
  'A literal `127.0.0.1:8188` value means "unbound / local placeholder", not a\n' +
  'real binding.\n'

export function buildExportZip(id: string): ExportZip {
  const { folderAbs, folderName } = resolveFolder(id)
  try {
    // Just the workflow's folder. A root-level README here would defeat
    // extractZipToDir's single-folder strip on re-import (nesting the folder +
    // importing the README), so the explanatory README rides the ALL-bundle
    // export instead. params.json already carries the tokens.
    return { buffer: zipDirectory(folderAbs, folderName), filename: folderName }
  } catch (err) {
    throw internalError(err instanceof Error ? err.message : 'Failed to build archive')
  }
}

/** Bundle EVERY workflow into one ZIP: each workflow folder under its own
 *  top-level prefix, plus a `workflows.json` manifest (the metadata catalog).
 *  Snapshot history (the dot-prefixed `.history` dir) and transient atomic-write
 *  temp files are excluded. */
export function buildExportAllZip(): ExportZip {
  // Drive the archive off the same listing as the manifest, so the bundled
  // folders and workflows.json can't disagree (and the `.history` /
  // `script` / dotfile exclusions stay defined in one place — readWorkflows).
  const dir = getWorkflowsDir()
  const items = listWorkflows()
  if (items.length === 0) throw notFound('No workflows to export')
  try {
    const sources: ZipSource[] = items.map((w) => ({
      kind: 'dir',
      dir: resolve(join(dir, w.path)),
      archiveRoot: w.path,
      exclude: (rel) => rel.endsWith('.tmp'),
    }))
    sources.push({
      kind: 'file',
      name: 'workflows.json',
      data: Buffer.from(JSON.stringify(items, null, 2), 'utf-8'),
    })
    sources.push({ kind: 'file', name: 'README.md', data: Buffer.from(EXPORT_README, 'utf-8') })
    return { buffer: zipSources(sources), filename: 'workflows' }
  } catch (err) {
    throw internalError(err instanceof Error ? err.message : 'Failed to build archive')
  }
}

/* ─── Duplicate ─────────────────────────────────────────────── */

export function duplicateWorkflow(
  id: string,
  body: { folderName?: string; label?: string },
): WorkflowSummary {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) throw notFound('Workflow not found')
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')

  const rawName = (body.folderName ?? `${entry.name}-copy`).trim()
  const newFolder = rawName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '')
  if (!newFolder) throw badRequest('Invalid folder name')

  const destPath = join(dir, newFolder)
  if (existsSync(destPath)) throw conflict('Folder already exists')

  cpSync(join(dir, entry.name), destPath, { recursive: true })
  if (body.label) {
    const destParams = readParams(destPath)
    destParams.label = body.label
    writeParams(destPath, destParams)
  }
  const newId = slugify(newFolder)
  const newItem = readWorkflows().find((w) => w.id === newId)
  if (!newItem) throw internalError('Duplicated but could not read back')
  return toSummary(newItem)
}

/* ─── Create / patch / delete ───────────────────────────────── */

export function createWorkflow(input: CreateWorkflowInput): WorkflowSummary {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      throw internalError('Cannot create workflows directory')
    }
  }

  const folderPath = join(dir, input.folderName)
  if (existsSync(folderPath)) throw conflict('Folder already exists')
  mkdirSync(folderPath, { recursive: true })

  const params: ParamsJson = {}
  if (input.label) params.label = input.label
  if (input.parser && input.parser !== 'default') params.parser = input.parser
  if (input.category) params.category = input.category
  if (input.description) params.description = input.description
  if (input.serverUrls?.length) setComfyServerUrls(params, input.serverUrls)

  writeParams(folderPath, params)

  const id = slugify(input.folderName)
  const item = readWorkflows().find((w) => w.id === id)
  if (!item) throw internalError('Created but could not read back')
  return toSummary(item)
}

export function patchWorkflow(id: string, body: PatchWorkflowInput): WorkflowSummary {
  const { folderAbs, folderName } = resolveFolder(id)
  const folderPath = join(getWorkflowsDir(), folderName)
  const params = readParams(folderPath)

  if ('label' in body) params.label = body.label ?? undefined
  if ('description' in body) params.description = body.description ?? undefined
  if ('category' in body) params.category = body.category
  if ('parser' in body) params.parser = body.parser ?? undefined
  if ('tags' in body) params.tags = body.tags
  if ('timeout' in body) params.timeout = body.timeout ?? undefined
  if ('devMode' in body) params.devMode = body.devMode
  if ('serverUrls' in body) setComfyServerUrls(params, body.serverUrls ?? [])
  if ('order' in body) params.order = body.order

  writeParams(folderPath, params)

  // Snapshot only when the user made a meaningful edit. Drag-reorder and
  // drag-between-categories fire dozens of PATCHes that change only `order`
  // and/or `category`; we don't want those to bury actual saves in history.
  const meaningfulKeys = Object.keys(body).filter((k) => k !== 'order' && k !== 'category')
  if (meaningfulKeys.length > 0) {
    snapshotWorkflowAsync(id, folderAbs, 'meta')
  }

  const item = readWorkflows().find((w) => w.id === id)
  if (!item) throw internalError('Not found after update')
  return toSummary(item)
}

export function deleteWorkflow(id: string): void {
  const { folderAbs } = resolveFolder(id)
  rmSync(folderAbs, { recursive: true, force: true })
}

/** Set ONLY the server binding (`comfyui_config.serverUrl`) to the given raw
 *  refs — literal URLs and/or `globalEnv.<key>` tokens, written verbatim via
 *  setComfyServerUrls (never resolved). A single-purpose path over
 *  patchWorkflow's serverUrls write, for binding-only callers (the binding
 *  editor, MCP). */
export function setWorkflowBinding(id: string, refs: string[]): WorkflowSummary {
  return patchWorkflow(id, { serverUrls: refs })
}

/* ─── History ───────────────────────────────────────────────── */

const HISTORY_LABEL: Record<HistoryEntry['kind'], string> = {
  params: 'Params edit',
  workflow: 'Workflow edit',
  import: 'Before import',
  meta: 'Metadata edit',
  update: 'Before update',
}

export function listWorkflowHistory(id: string): HistoryEntry[] {
  const dir = getWorkflowsDir()
  if (!existsSync(dir)) return []
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')
  return listSnapshots(id).map((s) => ({
    id: s.id,
    savedAt: s.savedAt,
    kind: s.kind,
    label: HISTORY_LABEL[s.kind] ?? s.kind,
  }))
}

export function restoreSnapshotById(id: string, snapshotId: string): WorkflowSummary {
  const { folderAbs } = resolveFolder(id)
  const snapAbs = join(historyRoot(id), snapshotId)
  if (!existsSync(snapAbs) || !statSync(snapAbs).isDirectory()) {
    throw notFound('Snapshot not found')
  }

  // 1. Save current state under a "pre-restore" snapshot so the user can undo.
  snapshotWorkflow(id, folderAbs, 'meta')

  // 2. Wipe and replace. We delete the folder rather than just overwriting so
  //    files that exist now but weren't in the snapshot are also removed —
  //    matches the user's mental model of "go back to this exact state".
  try {
    rmSync(folderAbs, { recursive: true, force: true })
    cpSync(snapAbs, folderAbs, { recursive: true })
  } catch (err) {
    throw internalError(err instanceof Error ? err.message : 'Restore failed')
  }

  const item = readWorkflows().find((w) => w.id === id)
  if (!item) throw internalError('Restored but could not read back')
  return toSummary(item)
}

/** Resolve a ComfyUI server for a workflow's params. A workflow may list
 *  several servers under comfyui_config.serverUrl; `preferred` (chosen in the
 *  Test/Audit dialog) wins when it is one of them, otherwise the first listed
 *  server is used. */
export function resolveComfyServer(
  params: ParamsJson,
  preferred?: string,
): { url: string; name: string } | null {
  const urls = comfyServerUrls(params).map((u) => u.replace(/\/+$/, ''))
  if (urls.length === 0) return null
  const pref = preferred?.replace(/\/+$/, '')
  const chosen = pref && urls.includes(pref) ? pref : urls[0]!
  try {
    return { url: chosen, name: new URL(chosen).hostname }
  } catch {
    return { url: chosen, name: chosen }
  }
}
