/**
 * Headless RDP probe — validates that a target host accepts stored credentials
 * by holding a brief xfreerdp session against it. Two execution modes:
 *
 *   1. EMBEDDED (default, RDP_BRIDGE_URL unset):
 *      The API spawns Xvfb + xfreerdp inside its own container. The image
 *      bundles `freerdp` and `xorg-server-xvfb` (see api/Dockerfile). Models
 *      the user's connect.sh script (Xvfb + xfreerdp + HOLD) minus the
 *      screenshot.
 *
 *   2. SIDECAR (RDP_BRIDGE_URL set):
 *      The API POSTs to a tiny RDP-only container that runs the same dance
 *      (see rdp-sidecar/). Used when the API runs natively on Windows or you
 *      want to keep the API image slim. The wire contract mirrors the local
 *      result shape exactly so callers don't care which path was taken.
 *
 * Returns a structured result on success/failure; throws HttpError on
 * misconfigurations (no creds, server unreachable, missing binary).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { hostnameOf } from '../lib/serverUrl.js'
import { decrypt } from '../lib/crypto.js'
import { badRequest, notFound, HttpError } from '../lib/httpError.js'
import * as serversRepo from '../repositories/servers.js'
import * as credentialsRepo from '../repositories/credentials.js'
import { deriveHealth } from './servers.js'
import { config } from '../config/index.js'
import { directDispatcher } from '../lib/proxy.js'

const HOLD_SECONDS = 15
// Display numbers above :100 are conventional for one-off virtual displays.
// A module-level counter lets concurrent calls each get their own — wraps
// at 999 so a long-lived process can't drift into kernel-reserved numbers.
let nextDisplay = 100
function allocDisplay(): number {
  const n = nextDisplay
  nextDisplay = nextDisplay >= 999 ? 100 : nextDisplay + 1
  return n
}

const XVFB_BOOT_MS = 600
const KILL_WAIT_MS = 1000
// Cap the tail we keep — xfreerdp can be chatty under verbose log levels.
const STDERR_TAIL_BYTES = 8 * 1024
// Sidecar request timeout: hold + Xvfb boot + a generous teardown margin so we
// never abort the bridge mid-probe.
const SIDECAR_TIMEOUT_MS = (HOLD_SECONDS + 10) * 1000

export type RdpStatus = {
  /** Server exists and we know how to reach it via RDP. */
  reachable: boolean
  /** Last ping derived via deriveHealth(); false when offline / unknown. */
  pingOk: boolean
  /** Whether any service on the host is healthy. Surfaced to the UI so the
   *  badge can read "ping OK · services degraded" when applicable. */
  servicesOk: boolean
  /** Linked credential id (if any) — null means the button must be disabled
   *  with an "add credentials" hint. */
  credentialId: string | null
  /** Hostname the connect call will target. Surfaced so the UI can render
   *  "RDP In to worker-03" without recomputing. */
  rdpHost: string | null
}

export type RdpConnectResult = {
  ok: boolean
  /** Exit code from xfreerdp. 0 = clean; other codes are surfaced verbatim
   *  so users can grep them against the freerdp docs. -1 means we killed it
   *  after HOLD_SECONDS (the normal success path for a test connect). */
  exitCode: number | null
  signal: NodeJS.Signals | null
  rdpHost: string
  durationMs: number
  /** Tail of xfreerdp stderr — useful when the connection fails (bad creds,
   *  cert issues, host refused). Truncated to STDERR_TAIL_BYTES. */
  stderrTail: string
  /** Which execution path served this call: the API's own xfreerdp or the
   *  remote sidecar. Surfaced for logging / debugging. */
  mode: 'embedded' | 'sidecar'
}

/** Quick check used to decide whether the UI shows the "RDP In" button.
 *  Cheap — pulls only the server + linked credential, no network calls. */
export async function rdpStatus(serverId: string): Promise<RdpStatus> {
  const server = await serversRepo.findById(serverId)
  if (!server) throw notFound('Server not found')

  const health = deriveHealth(server)
  const pingOk = health?.status === 'online'
  // For a server (host) record, "services OK" is resolved by the frontend,
  // which has the full servers list and can check the linked service records.
  // Here we just report the host's own ping.
  const servicesOk = pingOk

  const cred = await credentialsRepo.findCredentialForServer(serverId)

  const rdpHost = hostnameOf(server.url)

  return {
    reachable: pingOk,
    pingOk,
    servicesOk,
    credentialId: cred?.id ?? null,
    rdpHost,
  }
}

/** Run the RDP test for a server. Dispatches to embedded or sidecar mode based
 *  on whether RDP_BRIDGE_URL is configured. Throws HttpError for preflight
 *  failures so the route layer can return a precise status. */
export async function rdpConnect(serverId: string): Promise<RdpConnectResult> {
  const server = await serversRepo.findById(serverId)
  if (!server) throw notFound('Server not found')

  const health = deriveHealth(server)
  if (health?.status !== 'online') {
    throw badRequest(
      `Server is ${health?.status ?? 'unknown'} — refusing to RDP without an OK ping.`,
    )
  }

  const rdpHost = hostnameOf(server.url)
  if (!rdpHost) {
    throw badRequest('Server URL has no resolvable hostname — cannot target an RDP session.')
  }

  const cred = await credentialsRepo.findCredentialForServer(serverId)
  if (!cred) throw badRequest('No credentials linked to this server. Add one in /credentials.')
  if (!cred.passwordEnc) throw badRequest('Linked credential has no password stored.')

  let password: string
  try {
    password = decrypt(cred.passwordEnc)
  } catch (err) {
    throw new HttpError(
      500,
      'decrypt_failed',
      `Could not decrypt the linked credential: ${err instanceof Error ? err.message : err}`,
    )
  }

  const params = {
    host: rdpHost,
    username: cred.username,
    domain: cred.domain ?? null,
    password,
    holdSeconds: HOLD_SECONDS,
  }

  return config.RDP_BRIDGE_URL
    ? runRdpSidecar(params, config.RDP_BRIDGE_URL, config.RDP_BRIDGE_TOKEN)
    : runRdpEmbedded(params)
}

/* ─── Embedded mode ──────────────────────────────────────────────────── */

type RdpParams = {
  host: string
  username: string
  domain: string | null
  password: string
  holdSeconds: number
}

/** Spawn xfreerdp + Xvfb the way connect.sh does, minus the screenshot.
 *  Resolves once xfreerdp exits (either on its own or because we killed it
 *  after holdSeconds). */
async function runRdpEmbedded(p: RdpParams): Promise<RdpConnectResult> {
  const display = `:${allocDisplay()}`
  const start = Date.now()

  // 1. Start Xvfb. -nolisten tcp keeps it local to the container.
  const xvfb = spawn(
    'Xvfb',
    [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
    { stdio: 'ignore', detached: false },
  )
  xvfb.on('error', (err) => {
    // Reachable when Xvfb isn't installed — surface as a 500 from the route.
    console.error('[rdp] Xvfb failed to launch:', err.message)
  })

  // Give Xvfb a moment to come up. xfreerdp will retry once on a missing
  // display, but this is more reliable + matches the script's `sleep 1`.
  await new Promise((r) => setTimeout(r, XVFB_BOOT_MS))

  // 2. Build xfreerdp args. /p:<password> appears in `ps` — acceptable
  //    inside the container (no other processes to spy on us); avoid logging
  //    or echoing the full arg list elsewhere.
  const args: string[] = [
    `/v:${p.host}`,
    `/u:${p.username}`,
    `/p:${p.password}`,
    '/cert:ignore',
    '/w:1280',
    '/h:800',
    '-wallpaper',
    '-themes',
    '+clipboard',
    '/log-level:WARN',
  ]
  if (p.domain) args.splice(2, 0, `/d:${p.domain}`)

  const xfreerdp = spawn('xfreerdp', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, DISPLAY: display },
    detached: false,
  })

  let stderrBuf = Buffer.alloc(0)
  xfreerdp.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf = Buffer.concat([stderrBuf, chunk])
    if (stderrBuf.length > STDERR_TAIL_BYTES) {
      stderrBuf = stderrBuf.subarray(stderrBuf.length - STDERR_TAIL_BYTES)
    }
  })

  const exitInfo = await waitForExitOrTimeout(xfreerdp, p.holdSeconds * 1000)

  // 3. Tear down both processes. waitForExitOrTimeout has already SIGTERM-ed
  //    xfreerdp on timeout; do Xvfb here regardless of which path we took.
  killAndForget(xvfb)
  // Belt-and-braces — if xfreerdp ignored SIGTERM (rare), SIGKILL it.
  if (xfreerdp.exitCode === null && xfreerdp.signalCode === null) {
    try {
      xfreerdp.kill('SIGKILL')
    } catch {
      /* already dead */
    }
  }
  await new Promise((r) => setTimeout(r, KILL_WAIT_MS))

  const stderrTail = stderrBuf.toString('utf8')
  // A timed-out hold is the normal "success" path for a test connection —
  // exitCode null + signal SIGTERM means we got our window and tore it down
  // cleanly. Any other non-zero exit means xfreerdp itself failed.
  const ok =
    exitInfo.timedOut ||
    exitInfo.code === 0 ||
    exitInfo.signal === 'SIGTERM' ||
    exitInfo.signal === 'SIGKILL'

  return {
    ok,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    rdpHost: p.host,
    durationMs: Date.now() - start,
    stderrTail,
    mode: 'embedded',
  }
}

/* ─── Sidecar mode ───────────────────────────────────────────────────── */

/** Wire shape returned by the sidecar's POST /rdp. All fields optional on the
 *  wire — Go's `omitempty` drops the `signal` field on clean exits and we
 *  defensively coerce anything that's missing so the result shape matches the
 *  embedded path exactly. */
type SidecarResponse = {
  ok?: boolean
  exitCode?: number | null
  signal?: string | null
  durationMs?: number
  stderrTail?: string
}

/** Forward the RDP test to the sidecar over HTTP. Errors (network down,
 *  bad-status, malformed body) bubble up as 502 HttpError so the route can
 *  surface them precisely — the user's credentials are NOT logged. */
async function runRdpSidecar(
  p: RdpParams,
  bridgeUrl: string,
  token: string | undefined,
): Promise<RdpConnectResult> {
  const url = `${bridgeUrl.replace(/\/+$/, '')}/rdp`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SIDECAR_TIMEOUT_MS)
  try {
    // The bridge lives next to the API (sidecar container / same host), so go
    // direct — a corporate HTTP_PROXY must never sit in this path. Operator
    // NO_PROXY lists rarely include localhost / 127.0.0.1, which would route
    // this call through the proxy and fail. Same rationale as the health
    // probes' directDispatcher in serverHealth.ts. The double cast bridges
    // undici-types (bundled with @types/node) and the explicit undici package
    // the Agent comes from; `dispatcher` is honored by native fetch since 18.
    const init = {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(p),
      dispatcher: directDispatcher,
    } as unknown as RequestInit
    const res = await fetch(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new HttpError(
        502,
        'rdp_bridge_bad_response',
        `RDP bridge returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      )
    }
    const body = (await res.json()) as SidecarResponse
    // Normalize: omitempty/absent → null/zero so callers don't see undefined.
    return {
      ok: body.ok === true,
      exitCode: body.exitCode ?? null,
      signal: (body.signal ?? null) as NodeJS.Signals | null,
      rdpHost: p.host,
      durationMs: body.durationMs ?? 0,
      stderrTail: body.stderrTail ?? '',
      mode: 'sidecar',
    }
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(
      502,
      'rdp_bridge_unreachable',
      err instanceof Error ? err.message : 'RDP bridge request failed',
    )
  } finally {
    clearTimeout(timer)
  }
}

/* ─── Shared helpers ─────────────────────────────────────────────────── */

function killAndForget(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  try {
    proc.kill('SIGTERM')
  } catch {
    /* already dead */
  }
}

type ExitInfo = { code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }

function waitForExitOrTimeout(proc: ChildProcess, timeoutMs: number): Promise<ExitInfo> {
  return new Promise((resolve) => {
    let settled = false
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, timedOut: false })
    }
    const timer = setTimeout(() => {
      if (settled) return
      // The HOLD window is up — gently end the session. The 'exit' handler
      // above will fire from the kill and resolve with timedOut=true.
      settled = true
      try {
        proc.kill('SIGTERM')
      } catch {
        /* already dead */
      }
      resolve({ code: proc.exitCode, signal: proc.signalCode, timedOut: true })
    }, timeoutMs)
    proc.once('exit', onExit)
    proc.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      console.error('[rdp] xfreerdp process error:', err)
      resolve({ code: null, signal: null, timedOut: false })
    })
  })
}
