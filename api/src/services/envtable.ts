/**
 * workflow-envtable.json — gitignored, at the workflows root. Keyed by workflow
 * UUID (from each folder's metadata.json), value = that workflow's ORIGINAL
 * serverUrl stored VERBATIM: a literal URL or a `<globalEnv.x>` expression,
 * never a resolved value.
 *
 * Git only ever commits the `http://127.0.0.1:8188` placeholder, so this file is
 * each env's private memory of the real binding — written when a workflow is
 * sanitized for commit, read back to restore the binding after a pull/checkout.
 * Missing file / missing entry → fall back to whatever serverUrl is in git.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getWorkflowsDir, writeFileAtomic } from '../lib/workflowFs.js'

export const ENVTABLE_FILE = 'workflow-envtable.json'

/** Stored verbatim — a single ref or a list, exactly as it was in params.json. */
export type EnvServerUrl = string | string[]
type EnvTable = Record<string, { serverUrl: EnvServerUrl }>

function envtablePath(): string {
  return join(getWorkflowsDir(), ENVTABLE_FILE)
}

export function readEnvTable(): EnvTable {
  const p = envtablePath()
  if (!existsSync(p)) return {}
  try {
    const j: unknown = JSON.parse(readFileSync(p, 'utf-8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as EnvTable) : {}
  } catch {
    return {} // corrupt table → behave as if unbound (fall back to git's serverUrl)
  }
}

/** This env's stored binding for a workflow id, or undefined when unbound. */
export function getEnvServerUrl(id: string): EnvServerUrl | undefined {
  return readEnvTable()[id]?.serverUrl
}

/** Upsert one workflow's binding, verbatim. Read-modify-write the whole file
 *  (atomic) — the table is small and writes are rare (publish / bind). */
export function setEnvServerUrl(id: string, serverUrl: EnvServerUrl): void {
  const t = readEnvTable()
  t[id] = { serverUrl }
  writeFileAtomic(envtablePath(), JSON.stringify(t, null, 2) + '\n')
}
