/**
 * Import flows for workflows. Two entry points each have a 2-step lifecycle:
 *   - /:id/import/analyze + /:id/import/apply  — overwrite an existing workflow
 *   - /import/analyze + /import/create         — create a new workflow from a drop
 *
 * `analyzeImportBuffer` is the shared "what is this file?" detector — params
 * vs workflow vs zip — used by both analyze endpoints. `applyImportToExisting`
 * and `createFromImport` do the actual write.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzip } from '../lib/unzip.js'
import {
  getWorkflowsDir,
  isInsideDir,
  snapshotWorkflow,
  extractZipToDir,
} from '../lib/workflowFs.js'
import { badRequest, notFound, conflict, forbidden, internalError } from '../lib/httpError.js'
import { findEntry, slugify, readParams, comfyServerUrls } from './workflows.js'
import type { ParamsJson, ImportAnalysis, WorkflowSummary } from '../models/workflows.js'
import { FOLDER_NAME_RE } from '../validators/workflows.js'
import { readWorkflows } from './workflows.js'

export interface ImportAnalysisWithContext extends ImportAnalysis {
  /** Servers currently configured on the target workflow. */
  currentServers: string[]
  /** Servers the imported params.json suggests. */
  incomingServers: string[]
}

export interface NewWorkflowImportAnalysis extends ImportAnalysis {
  incomingServers: string[]
  meta: {
    label: string | null
    category: string | null
    description: string | null
    parser: string | null
  }
  suggestedName: string
}

/** Shared "what is this file?" detector — used by both analyze endpoints.
 *  Throws on anything unusable so callers can return a 400. */
export function analyzeImportBuffer(buf: Buffer, fileName: string): ImportAnalysis {
  const fname = fileName.toLowerCase()
  const warnings: string[] = []
  let kind: ImportAnalysis['kind']
  let params: Record<string, unknown> | null = null
  let workflow: Record<string, unknown> | null = null

  const looksLikeWorkflow = (obj: Record<string, unknown>) =>
    Object.values(obj).some(
      (v) => v != null && typeof v === 'object' && 'class_type' in (v as object),
    )
  const asObject = (raw: string, label: string): Record<string, unknown> | null => {
    try {
      const j = JSON.parse(raw)
      if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>
      warnings.push(`${label} is not a JSON object — skipped`)
    } catch {
      warnings.push(`${label} is not valid JSON — skipped`)
    }
    return null
  }

  // ZIP if the extension says so or the buffer starts with the PK local-file magic.
  const isZip = fname.endsWith('.zip') || (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50)

  if (isZip) {
    kind = 'zip'
    const files = unzip(buf) // throws on a corrupt archive
    const pick = (pred: (base: string, full: string) => boolean): Buffer | null => {
      for (const [full, data] of files) {
        const base = full.split('/').pop()?.toLowerCase() ?? ''
        if (pred(base, full.toLowerCase())) return data
      }
      return null
    }
    const pBuf = pick((base) => base === 'params.json')
    if (pBuf) params = asObject(pBuf.toString('utf-8'), 'params.json in the ZIP')
    // The workflow file can be named anything — params.json declares it under
    // workflowFile / comfyui_config.workflow. Honour that first, then fall
    // back to the usual conventions.
    const declared = params
      ? ((params as ParamsJson).workflowFile ?? (params as ParamsJson).comfyui_config?.workflow)
      : undefined
    const declaredBase = declared?.toLowerCase().split('/').pop()
    const wBuf =
      (declaredBase ? pick((base) => base === declaredBase) : null) ??
      pick((base) => base === 'workflow.json') ??
      pick((_b, full) => /_api\.json$/.test(full))
    if (wBuf) workflow = asObject(wBuf.toString('utf-8'), 'workflow file in the ZIP')
    if (!params && !workflow) throw new Error('ZIP contains no usable params.json or workflow file')
  } else {
    let json: unknown
    try {
      json = JSON.parse(buf.toString('utf-8'))
    } catch {
      throw new Error('File is not valid JSON')
    }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('Expected a JSON object')
    }
    const obj = json as Record<string, unknown>
    // Filename is the strongest signal; fall back to content shape.
    const nameHint = fname.includes('params')
      ? 'params'
      : fname.includes('workflow') || /_api\.json$/.test(fname)
        ? 'workflow'
        : null
    if (nameHint === 'workflow' || (nameHint == null && looksLikeWorkflow(obj))) {
      kind = 'workflow'
      workflow = obj
    } else {
      kind = 'params'
      params = obj
    }
  }

  let nodeCount = 0
  if (workflow) {
    nodeCount = Object.values(workflow).filter(
      (v) => v != null && typeof v === 'object' && 'class_type' in (v as object),
    ).length
    if (nodeCount === 0) warnings.push('The workflow file has no recognizable ComfyUI nodes')
  }

  return { kind, params, workflow, nodeCount, warnings }
}

/** The few string fields the create form pre-fills from an imported params.json. */
function importMeta(params: Record<string, unknown> | null) {
  const s = (k: string) => (params && typeof params[k] === 'string' ? (params[k] as string) : null)
  return {
    label: s('label'),
    category: s('category'),
    description: s('description'),
    parser: s('parser'),
  }
}

function importServers(params: Record<string, unknown> | null): string[] {
  if (!params) return []
  return comfyServerUrls(params as ParamsJson)
}

/** Parse the optional `params` multipart field into a plain object. The wizard
 *  sends the reviewed, server-adjusted params.json here. Throws on bad JSON. */
function parseParamsField(raw: string | File | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  const p = JSON.parse(raw)
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('params must be an object')
  return p as Record<string, unknown>
}

/* ─── Analyze (existing workflow context) ───────────────────── */

export async function analyzeForExisting(
  id: string,
  file: File,
): Promise<ImportAnalysisWithContext> {
  const dir = getWorkflowsDir()
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')

  let analysis: ImportAnalysis
  try {
    analysis = analyzeImportBuffer(Buffer.from(await file.arrayBuffer()), file.name)
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Could not read file')
  }

  const currentParams = readParams(resolve(join(dir, entry.name)))
  return {
    ...analysis,
    currentServers: comfyServerUrls(currentParams),
    incomingServers: importServers(analysis.params),
  }
}

/* ─── Analyze (new workflow — no existing context) ──────────── */

export async function analyzeForNew(file: File): Promise<NewWorkflowImportAnalysis> {
  let analysis: ImportAnalysis
  try {
    analysis = analyzeImportBuffer(Buffer.from(await file.arrayBuffer()), file.name)
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Could not read file')
  }

  const meta = importMeta(analysis.params)
  // A .zip is named after the folder it wraps; otherwise fall back to the label.
  const suggestedName = file.name.toLowerCase().endsWith('.zip')
    ? slugify(file.name.replace(/\.zip$/i, ''))
    : meta.label
      ? slugify(meta.label)
      : ''

  return {
    ...analysis,
    incomingServers: importServers(analysis.params),
    meta,
    suggestedName,
  }
}

/* ─── Apply (overwrite an existing workflow) ────────────────── */

export async function applyImportToExisting(
  id: string,
  file: File,
  paramsField: string | File | undefined,
): Promise<WorkflowSummary> {
  const dir = getWorkflowsDir()
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')

  let paramsOverride: Record<string, unknown> | null
  try {
    paramsOverride = parseParamsField(paramsField)
  } catch {
    throw badRequest('Invalid params payload')
  }

  const buf = Buffer.from(await file.arrayBuffer())
  let analysis: ImportAnalysis
  try {
    analysis = analyzeImportBuffer(buf, file.name)
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Could not read file')
  }

  const folderAbs = resolve(join(dir, entry.name))

  // Snapshot the current state first — restoring this snapshot from the
  // History modal is how the user undoes the import.
  snapshotWorkflow(id, folderAbs, 'import')

  try {
    if (analysis.kind === 'zip') {
      // Import the whole bundle — every file, overwriting / creating.
      extractZipToDir(buf, folderAbs)
      // The reviewed params (with the chosen server set) win over whatever
      // params.json the ZIP carried.
      if (paramsOverride) {
        writeFileSync(
          join(folderAbs, 'params.json'),
          JSON.stringify(paramsOverride, null, 2),
          'utf-8',
        )
      }
    } else if (analysis.kind === 'params') {
      writeFileSync(
        join(folderAbs, 'params.json'),
        JSON.stringify(paramsOverride ?? analysis.params ?? {}, null, 2),
        'utf-8',
      )
    } else {
      // bare workflow file — write it to the name the existing params declares
      const params = readParams(folderAbs)
      const wfFile = params.workflowFile ?? params.comfyui_config?.workflow ?? 'workflow.json'
      const wfAbs = resolve(join(folderAbs, wfFile))
      if (!isInsideDir(wfAbs, folderAbs)) throw forbidden('Forbidden workflow path')
      writeFileSync(wfAbs, JSON.stringify(analysis.workflow ?? {}, null, 2), 'utf-8')
    }
  } catch (e) {
    throw internalError(e instanceof Error ? e.message : 'Import failed')
  }

  const item = readWorkflows().find((w) => w.id === id)
  if (!item) throw internalError('Imported but could not read back')
  const { order: _o, ...w } = item
  return w
}

/* ─── Create (new workflow from import) ─────────────────────── */

export async function createFromImport(
  file: File,
  folderName: string,
  paramsField: string | File | undefined,
): Promise<WorkflowSummary> {
  if (!FOLDER_NAME_RE.test(folderName)) {
    throw badRequest('Alphanumeric, underscores and hyphens only')
  }

  let paramsOverride: Record<string, unknown> | null
  try {
    paramsOverride = parseParamsField(paramsField)
  } catch {
    throw badRequest('Invalid params payload')
  }

  const buf = Buffer.from(await file.arrayBuffer())
  let analysis: ImportAnalysis
  try {
    analysis = analyzeImportBuffer(buf, file.name)
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Could not read file')
  }

  const dir = getWorkflowsDir()
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      throw internalError('Cannot create workflows directory')
    }
  }
  const folderPath = join(dir, folderName)
  if (existsSync(folderPath)) throw conflict('Folder already exists')
  mkdirSync(folderPath, { recursive: true })
  const folderAbs = resolve(folderPath)

  try {
    if (analysis.kind === 'zip') {
      extractZipToDir(buf, folderAbs)
      writeFileSync(
        join(folderAbs, 'params.json'),
        JSON.stringify(paramsOverride ?? analysis.params ?? {}, null, 2),
        'utf-8',
      )
    } else if (analysis.kind === 'params') {
      writeFileSync(
        join(folderAbs, 'params.json'),
        JSON.stringify(paramsOverride ?? analysis.params ?? {}, null, 2),
        'utf-8',
      )
    } else {
      writeFileSync(
        join(folderAbs, 'params.json'),
        JSON.stringify(paramsOverride ?? {}, null, 2),
        'utf-8',
      )
      const p = (paramsOverride ?? null) as ParamsJson | null
      const wfFile = p?.workflowFile ?? p?.comfyui_config?.workflow ?? 'workflow.json'
      const wfAbs = resolve(join(folderAbs, wfFile))
      if (!isInsideDir(wfAbs, folderAbs)) throw forbidden('Forbidden workflow path')
      writeFileSync(wfAbs, JSON.stringify(analysis.workflow ?? {}, null, 2), 'utf-8')
    }
  } catch (e) {
    throw internalError(e instanceof Error ? e.message : 'Import failed')
  }

  const id = slugify(folderName)
  const item = readWorkflows().find((w) => w.id === id)
  if (!item) throw internalError('Created but could not read back')
  const { order: _o, ...w } = item
  return w
}
