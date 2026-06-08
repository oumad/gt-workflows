import { loadSession } from './storage'

// In dev, Vite proxies /api → the backend; VITE_API_URL overrides for prod.
const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * POST a multipart workflow-import request — the dropped `file` plus any extra
 * string fields. Raw `fetch` (not the JSON `api` helper) so the browser sets
 * the multipart boundary itself; only the auth header is added manually.
 * Throws an `Error` carrying the server's message on any non-2xx response.
 */
async function postImport<T>(
  path: string,
  file: File,
  fields: Record<string, string | undefined> = {},
): Promise<T> {
  const session = loadSession()
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v)
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: fd,
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok || !data) {
    throw new Error((data as { error?: string } | null)?.error ?? `Server error ${res.status}`)
  }
  return data as T
}

/**
 * Inspect a dropped file (params.json / workflow.json / .zip) — the server
 * parses and validates it but writes nothing. Pass `wfId` to analyze against
 * an existing workflow; omit it for a brand-new one. The response shape differs
 * between the two endpoints, so the caller supplies the type parameter.
 */
export function analyzeImport<T>(file: File, wfId?: string): Promise<T> {
  return postImport<T>(
    wfId ? `/api/workflows/${wfId}/import/analyze` : '/api/workflows/import/analyze',
    file,
  )
}

/**
 * Commit a reviewed import into an existing workflow. The original `file` is
 * re-sent so the server can import every file a ZIP carries (icons, sidecars);
 * `params` is the reviewed, server-adjusted params.json (pass null for a bare
 * workflow-file import).
 */
export function applyImport<T>(
  wfId: string,
  file: File,
  params: Record<string, unknown> | null,
): Promise<T> {
  return postImport<T>(`/api/workflows/${wfId}/import/apply`, file, {
    params: params ? JSON.stringify(params) : undefined,
  })
}

/**
 * Create a new workflow from a dropped file. The original `file` is re-sent so
 * a ZIP seeds the whole folder; `params` carries the form-field overrides.
 */
export function createImport<T>(
  folderName: string,
  file: File,
  params: Record<string, unknown> | null,
): Promise<T> {
  return postImport<T>('/api/workflows/import/create', file, {
    folderName,
    params: params ? JSON.stringify(params) : undefined,
  })
}
