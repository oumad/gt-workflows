/**
 * ComfyUI proxy endpoints: /:id/test runs a workflow live and streams events,
 * /:id/audit checks every node/model against the server's /object_info.
 *
 * `runWorkflowTest` exposes a callback-driven runner so the HTTP route can
 * wrap it with NDJSON streaming. `auditWorkflow` is request/response (no
 * streaming), so it returns a plain AuditResult.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import crypto from 'node:crypto'
import { getWorkflowsDir, isInsideDir } from '../lib/workflowFs.js'
import { badRequest, notFound, internalError, HttpError } from '../lib/httpError.js'
import { internalFetch, internalWebSocket } from '../lib/proxy.js'
import { findEntry, readParams, resolveComfyServer } from './workflows.js'
import type { AuditResult } from '../models/workflows.js'

/** Read + validate the workflow.json for a given workflow id, returning the
 *  parsed JSON and resolved server. Throws HttpError on every failure mode. */
function loadWorkflowAndServer(id: string, preferredServer?: string) {
  const dir = getWorkflowsDir()
  const entry = findEntry(dir, id)
  if (!entry) throw notFound('Workflow not found')

  const folderAbs = resolve(join(dir, entry.name))
  const params = readParams(folderAbs)
  const wfFile = params.workflowFile ?? params.comfyui_config?.workflow ?? 'workflow.json'
  const wfAbs = resolve(join(folderAbs, wfFile))
  if (!isInsideDir(wfAbs, folderAbs) || !existsSync(wfAbs)) {
    throw badRequest('No ComfyUI workflow file found. This may be a script-type workflow.')
  }

  let workflowJson: unknown
  try {
    workflowJson = JSON.parse(readFileSync(wfAbs, 'utf-8'))
  } catch {
    throw badRequest('Workflow file is not valid JSON')
  }

  const server = resolveComfyServer(params, preferredServer)
  if (!server) throw badRequest('No ComfyUI server configured for this workflow')

  return { workflowJson, server }
}

/** ComfyUI event fields are strings/numbers in practice; objects are never
 *  expected — JSON.stringify is just the safe fallback for the unexpected. */
const asStr = (v: unknown): string =>
  typeof v === 'object' && v != null ? JSON.stringify(v) : String(v)

/* ─── Test runner (streaming) ───────────────────────────────── */

export interface TestEvent {
  event:
    | 'status'
    | 'submitted'
    | 'connected'
    | 'executing'
    | 'executed'
    | 'progress'
    | 'done'
    | 'error'
  [k: string]: unknown
}

export interface TestRunnerOptions {
  id: string
  preferredServer: string | undefined
  send: (event: TestEvent) => void
  onCleanup: (closer: () => void) => void
}

/**
 * Submit a workflow to ComfyUI and stream the resulting events through `send`.
 * Promise resolves when the run is over (success / error / interrupted /
 * timeout) — the route uses it to keep the SSE/NDJSON stream open. Errors
 * are reported as `event: 'error'` and the promise resolves normally; only
 * the loadWorkflowAndServer pre-checks throw HttpError.
 */
export async function runWorkflowTest(opts: TestRunnerOptions): Promise<void> {
  const { workflowJson, server } = loadWorkflowAndServer(opts.id, opts.preferredServer)
  const clientId = crypto.randomUUID()

  let ws: ReturnType<typeof internalWebSocket> | null = null
  opts.onCleanup(() => {
    try {
      ws?.close()
    } catch {}
  })

  opts.send({ event: 'status', message: `Connecting to ${server.name}…` })

  let submitRes: Response
  try {
    // internalFetch: the ComfyUI server is a LAN host — must not go through
    // the corporate HTTP_PROXY.
    submitRes = await internalFetch(`${server.url}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflowJson, client_id: clientId }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    opts.send({ event: 'error', message: err instanceof Error ? err.message : 'Submit failed' })
    return
  }

  if (!submitRes.ok) {
    let errMsg = `Server returned ${submitRes.status}`
    try {
      const j = (await submitRes.json()) as Record<string, unknown>
      if (typeof j['error'] === 'string') errMsg = j['error']
      else if (j['node_errors'])
        errMsg = 'Node errors on: ' + Object.keys(j['node_errors']).join(', ')
    } catch {}
    opts.send({ event: 'error', message: errMsg })
    return
  }

  const submitData = (await submitRes.json()) as {
    prompt_id?: string
    error?: string
    node_errors?: Record<string, unknown>
  }

  if (submitData.error) {
    opts.send({ event: 'error', message: submitData.error })
    return
  }
  if (submitData.node_errors && Object.keys(submitData.node_errors).length > 0) {
    opts.send({
      event: 'error',
      message: 'Node validation errors on: ' + Object.keys(submitData.node_errors).join(', '),
    })
    return
  }
  if (!submitData.prompt_id) {
    opts.send({ event: 'error', message: 'No prompt_id from server' })
    return
  }

  const promptId = submitData.prompt_id
  opts.send({ event: 'submitted', promptId, serverName: server.name })

  // Connect to ComfyUI WebSocket for live events
  const wsUrl =
    server.url.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws')) +
    `/ws?clientId=${clientId}`
  // internalWebSocket: same LAN routing policy as the HTTP calls — a bare
  // WebSocket would dispatch through the global (proxy) dispatcher.
  // `sock` is the non-null handle for the handlers below; `ws` mirrors it so
  // the onCleanup closure registered above can close it.
  const sock = internalWebSocket(wsUrl)
  ws = sock

  await new Promise<void>((res) => {
    const timer = setTimeout(
      () => {
        opts.send({ event: 'error', message: 'Timed out waiting for execution' })
        try {
          sock.close()
        } catch {}
        res()
      },
      10 * 60 * 1000,
    )

    sock.addEventListener('open', () => {
      opts.send({ event: 'connected' })
    })

    sock.addEventListener('message', (event: { data: unknown }) => {
      if (typeof event.data !== 'string') return
      let msg: { type?: string; data?: Record<string, unknown> }
      try {
        msg = JSON.parse(event.data) as typeof msg
      } catch {
        return
      }
      const { type, data } = msg
      if (!type || !data) return
      if (data['prompt_id'] && data['prompt_id'] !== promptId) return // not our prompt

      if (type === 'executing') {
        if (data['node'] == null) {
          opts.send({ event: 'done', success: true })
          clearTimeout(timer)
          try {
            sock.close()
          } catch {}
          res()
        } else {
          opts.send({ event: 'executing', node: asStr(data['node']) })
        }
      } else if (type === 'executed') {
        opts.send({ event: 'executed', node: asStr(data['node']) })
      } else if (type === 'progress') {
        opts.send({
          event: 'progress',
          node: asStr(data['node']),
          value: Number(data['value']),
          max: Number(data['max']),
        })
      } else if (type === 'execution_success') {
        opts.send({ event: 'done', success: true })
        clearTimeout(timer)
        try {
          ws?.close()
        } catch {}
        res()
      } else if (type === 'execution_error') {
        opts.send({
          event: 'done',
          success: false,
          nodeId: asStr(data['node_id'] ?? ''),
          nodeType: asStr(data['node_type'] ?? ''),
          error: asStr(data['exception_message'] ?? 'Unknown error'),
        })
        clearTimeout(timer)
        try {
          ws?.close()
        } catch {}
        res()
      } else if (type === 'execution_interrupted') {
        opts.send({ event: 'done', success: false, error: 'Execution interrupted' })
        clearTimeout(timer)
        try {
          ws?.close()
        } catch {}
        res()
      }
    })

    sock.addEventListener('error', () => {
      opts.send({ event: 'error', message: 'WebSocket connection to ComfyUI failed' })
      clearTimeout(timer)
      res()
    })

    sock.addEventListener('close', () => {
      clearTimeout(timer)
      res()
    })
  })
}

/* ─── Audit (request/response) ──────────────────────────────── */

export async function auditWorkflow(id: string, preferredServer?: string): Promise<AuditResult> {
  const { workflowJson, server } = loadWorkflowAndServer(id, preferredServer)
  const wfJson = workflowJson as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >

  type ObjNode = {
    input?: {
      required?: Record<string, [unknown, unknown]>
      optional?: Record<string, [unknown, unknown]>
    }
  }

  let objectInfo: Record<string, ObjNode>
  try {
    const res = await internalFetch(`${server.url}/object_info`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok)
      throw new HttpError(
        502,
        'comfy_bad_response',
        `Server returned ${res.status} for /object_info`,
      )
    objectInfo = (await res.json()) as Record<string, ObjNode>
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(
      502,
      'comfy_unreachable',
      `Cannot reach server: ${err instanceof Error ? err.message : 'timeout'}`,
    )
  }

  const nodeMap = new Map<string, 'ok' | 'missing'>()
  const models: AuditResult['models'] = []

  const looksLikeFile = (s: string) => /\.[a-zA-Z0-9]{1,10}$/.test(s)

  for (const [nodeId, node] of Object.entries(wfJson)) {
    const ct = node.class_type
    if (!nodeMap.has(ct)) nodeMap.set(ct, objectInfo[ct] ? 'ok' : 'missing')

    const info = objectInfo[ct]
    if (!info) continue

    const schemas: Record<string, [unknown, unknown]> = {
      ...info.input?.required,
      ...info.input?.optional,
    }

    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) || typeof value !== 'string' || !value) continue
      const schema = schemas[inputName]
      if (!schema || !Array.isArray(schema[0])) continue
      const opts = schema[0] as unknown[]
      // Only check file-like combo inputs (checkpoints, LoRAs, etc.) — skip sampler/scheduler names
      if (!opts.some((o) => typeof o === 'string' && looksLikeFile(o))) continue
      const avail = opts.some(
        (o) =>
          typeof o === 'string' &&
          (o === value || o.endsWith('/' + value) || o.endsWith('\\' + value)),
      )
      models.push({ nodeId, classType: ct, inputName, value, status: avail ? 'ok' : 'missing' })
    }
  }

  return {
    serverName: server.name,
    serverUrl: server.url,
    nodes: Array.from(nodeMap, ([classType, status]) => ({ classType, status })),
    models,
  }
}

// Suppress unused — internalError isn't referenced now but is part of the
// httpError surface this module conceptually depends on.
void internalError
