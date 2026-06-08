/**
 * Workflow HTTP routes. Thin adapter onto the workflow service layer:
 *  - services/workflows.ts   — list / get / file IO / CRUD / duplicate / history
 *  - services/workflowImport.ts — analyze + apply + create flows
 *  - services/workflowTest.ts   — ComfyUI test runner + audit
 *
 * What lives here: HTTP wiring (auth middleware, multipart parsing, the
 * NDJSON streaming wrapper around the test runner, raw byte responses for
 * the icon and ZIP endpoints).
 */
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { httpErrorResponse, notFound } from '../lib/httpError.js'
import { createWorkflowSchema, patchWorkflowSchema } from '../validators/workflows.js'
import * as wf from '../services/workflows.js'
import * as wfs from '../services/workflowFiles.js'
import * as imp from '../services/workflowImport.js'
import { runWorkflowTest, auditWorkflow, type TestEvent } from '../services/workflowTest.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// Authentication: requireAuth on each route accepts both browser JWT and
// personal tokens (cm_pat_...) — see middleware/auth.ts. The legacy weekly-
// rotating X-API-Key mounted here was removed when MCP personal tokens
// replaced it.

// ── GET /workflows ────────────────────────────────────────
app.get('/', requireAuth, (c) => {
  return c.json(wf.listWorkflows(c.req.query('category')))
})

// ── GET /workflows/export — download all metadata as JSON ─
app.get('/export', requireAuth, (c) => {
  return new Response(JSON.stringify(wf.listWorkflows(), null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="workflows.json"',
    },
  })
})

// ── GET /workflows/:id/icon — public, no auth ─────────────
app.get('/:id/icon', (c) => {
  const icon = wf.getIcon(c.req.param('id'))
  if (!icon) return c.body(null, 404)
  return new Response(new Uint8Array(icon.buffer), {
    headers: { 'Content-Type': icon.mime, 'Cache-Control': 'public, max-age=3600' },
  })
})

// ─────────────────────────────────────────────────────────
// Generic /fs/* endpoints — power the "Files" tab. Distinct from /files/:kind
// (which is the params.json/workflow.json shortcut). See services/workflowFiles.
// ─────────────────────────────────────────────────────────

// ── GET /workflows/:id/fs/tree — recursive folder listing ─
app.get('/:id/fs/tree', requireAuth, (c) => {
  try {
    return c.json(wfs.listTree(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id/fs/file?path=... — read text contents ─
app.get('/:id/fs/file', requireAuth, (c) => {
  try {
    const path = c.req.query('path') ?? ''
    return c.json(wfs.readFile(c.req.param('id'), path))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id/fs/raw?path=... — stream raw file bytes ─
// Used by the Files tab to preview images / videos / PDFs / etc. inline.
// Returns the raw bytes with a Content-Type derived from the extension; a
// short-cache header lets the browser reuse the response when the same path
// is selected again (we don't ETag — workflow files change often enough that
// a strong cache would just delay the user seeing edits land).
app.get('/:id/fs/raw', requireAuth, (c) => {
  try {
    const path = c.req.query('path') ?? ''
    const { buffer, contentType, rel } = wfs.readFileBytes(c.req.param('id'), path)
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=60',
        // Help the browser pick a sane default download name if the user
        // saves the response. inline disposition so images render directly.
        'Content-Disposition': `inline; filename="${rel.split('/').pop() ?? 'file'}"`,
      },
    })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── PUT /workflows/:id/fs/file?path=... — write text contents ─
// Body: { text: string }. Creates the file if it doesn't exist (parent must).
app.put('/:id/fs/file', requireAdmin, async (c) => {
  let body: { path?: string; text?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const path = body.path ?? c.req.query('path') ?? ''
  const text = typeof body.text === 'string' ? body.text : ''
  try {
    return c.json(wfs.writeFile(c.req.param('id'), path, text))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/fs/folder — body { path } ─
app.post('/:id/fs/folder', requireAdmin, async (c) => {
  let body: { path?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  try {
    return c.json(wfs.createFolder(c.req.param('id'), body.path ?? ''), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/fs/rename — body { from, to } ─
app.post('/:id/fs/rename', requireAdmin, async (c) => {
  let body: { from?: string; to?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (!body.from || !body.to) return c.json({ error: 'from and to are required' }, 400)
  try {
    return c.json(wfs.renamePath(c.req.param('id'), body.from, body.to))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── DELETE /workflows/:id/fs/file?path=... ─
app.delete('/:id/fs/file', requireAdmin, (c) => {
  try {
    const path = c.req.query('path') ?? ''
    wfs.deletePath(c.req.param('id'), path)
    return c.body(null, 204)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/fs/upload — multipart, fields: file, dest ─
app.post('/:id/fs/upload', requireAdmin, async (c) => {
  let parsed: Record<string, string | File>
  try {
    parsed = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid upload' }, 400)
  }
  const file = parsed['file']
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
  const dest = typeof parsed['dest'] === 'string' ? parsed['dest'] : ''
  try {
    return c.json(await wfs.uploadFile(c.req.param('id'), dest, file), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id/files/:kind — raw params.json or workflow.json ──
app.get('/:id/files/:kind', requireAuth, (c) => {
  try {
    const kind = c.req.param('kind') as wf.WorkflowFileKind
    const buf = wf.readWorkflowFile(c.req.param('id'), kind)
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── PUT /workflows/:id/files/params — write raw params.json ──
app.put('/:id/files/params', requireAdmin, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  try {
    wf.writeParamsFile(c.req.param('id'), body)
    return c.body(null, 204)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── PUT /workflows/:id/files/workflow — write raw workflow.json ──
app.put('/:id/files/workflow', requireAdmin, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  try {
    wf.writeWorkflowFile(c.req.param('id'), body)
    return c.body(null, 204)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id/export — download as ZIP ───────────
app.get('/:id/export', requireAuth, (c) => {
  try {
    const { buffer, filename } = wf.buildExportZip(c.req.param('id'))
    // RFC 6266: bare ASCII filename for legacy clients, plus filename* with
    // RFC 5987 encoding so UTF-8 names (spaces, accents, parentheses) survive.
    const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const encoded = encodeURIComponent(filename)
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safe}.zip"; filename*=UTF-8''${encoded}.zip`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/duplicate ─────────────────────────
app.post('/:id/duplicate', requireAdmin, async (c) => {
  let body: { folderName?: string; label?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  try {
    return c.json(wf.duplicateWorkflow(c.req.param('id'), body), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id ────────────────────────────────────
app.get('/:id', requireAuth, (c) => {
  const summary = wf.getWorkflowSummary(c.req.param('id'))
  if (!summary) return httpErrorResponse(c, notFound('Workflow not found'))
  return c.json(summary)
})

// ── POST /workflows — create new ──────────────────────────
app.post('/', requireAdmin, zValidator('json', createWorkflowSchema), (c) => {
  try {
    return c.json(wf.createWorkflow(c.req.valid('json')), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── PATCH /workflows/:id — update params.json ─────────────
app.patch('/:id', requireAdmin, zValidator('json', patchWorkflowSchema), (c) => {
  try {
    return c.json(wf.patchWorkflow(c.req.param('id'), c.req.valid('json')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── DELETE /workflows/:id ─────────────────────────────────
app.delete('/:id', requireAdmin, (c) => {
  try {
    wf.deleteWorkflow(c.req.param('id'))
    return c.body(null, 204)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/test — submit to ComfyUI, stream events ──
// Returns NDJSON lines: { event, ...payload }
app.post('/:id/test', requireAuth, async (c) => {
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  c.header('X-Accel-Buffering', 'no')

  return stream(c, async (s) => {
    const send = (e: TestEvent) => s.writeln(JSON.stringify(e))
    let closer: (() => void) | null = null
    s.onAbort(() => {
      try {
        closer?.()
      } catch {}
    })

    try {
      await runWorkflowTest({
        id: c.req.param('id'),
        preferredServer: c.req.query('server'),
        send,
        onCleanup: (fn) => {
          closer = fn
        },
      })
    } catch (err) {
      send({ event: 'error', message: err instanceof Error ? err.message : 'Unexpected error' })
    }
  })
})

// ── POST /workflows/:id/audit — check dependencies against /object_info ──
app.post('/:id/audit', requireAuth, async (c) => {
  try {
    return c.json(await auditWorkflow(c.req.param('id'), c.req.query('server')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /workflows/:id/history — list saved snapshots ────
app.get('/:id/history', requireAuth, (c) => {
  try {
    return c.json(wf.listWorkflowHistory(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/history/:snapshotId/restore ──────
app.post('/:id/history/:snapshotId/restore', requireAdmin, (c) => {
  try {
    return c.json(wf.restoreSnapshotById(c.req.param('id'), c.req.param('snapshotId')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/import/analyze ───────────────────
app.post('/:id/import/analyze', requireAdmin, async (c) => {
  let parsed: Record<string, string | File>
  try {
    parsed = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid upload' }, 400)
  }
  const file = parsed['file']
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
  try {
    return c.json(await imp.analyzeForExisting(c.req.param('id'), file))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/:id/import/apply ─────────────────────
app.post('/:id/import/apply', requireAdmin, async (c) => {
  let parsed: Record<string, string | File>
  try {
    parsed = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid upload' }, 400)
  }
  const file = parsed['file']
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
  try {
    return c.json(await imp.applyImportToExisting(c.req.param('id'), file, parsed['params']))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/import/analyze — inspect a file for a NEW workflow ──
app.post('/import/analyze', requireAdmin, async (c) => {
  let parsed: Record<string, string | File>
  try {
    parsed = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid upload' }, 400)
  }
  const file = parsed['file']
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
  try {
    return c.json(await imp.analyzeForNew(file))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /workflows/import/create — create new workflow from an import ──
app.post('/import/create', requireAdmin, async (c) => {
  let parsed: Record<string, string | File>
  try {
    parsed = await c.req.parseBody()
  } catch {
    return c.json({ error: 'Invalid upload' }, 400)
  }
  const file = parsed['file']
  if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400)
  const folderName = typeof parsed['folderName'] === 'string' ? parsed['folderName'] : ''
  try {
    return c.json(await imp.createFromImport(file, folderName, parsed['params']), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
