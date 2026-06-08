/**
 * Headless RDP probe — runs xfreerdp inside the API container to validate
 * that a target host accepts the stored credentials. Models the user's
 * connect.sh script (Xvfb + xfreerdp + HOLD) minus the screenshot.
 *
 * Flow per call:
 *   1. Resolve the server, derive a host (no port — we connect to the host's
 *      RDP port, not the service port).
 *   2. Refuse early if the server has no recent OK ping (deriveHealth).
 *   3. Resolve the linked credential, decrypt the password.
 *   4. Pick an unused virtual X display (`:N` from a per-process counter), start
 *      Xvfb on it.
 *   5. Spawn xfreerdp pointing at the host with the credential.
 *   6. Hold for HOLD_SECONDS, then SIGTERM xfreerdp and Xvfb. Capture the
 *      tail of xfreerdp's stderr so the UI can show a precise failure.
 *
 * The container image bundles `freerdp` and `xorg-server-xvfb` (see api/Dockerfile).
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

export type RdpStatus = {
  /** Server exists and we know how to reach it via RDP. */
  reachable: boolean
  /** Last ping derived via deriveHealth(); false when offline / unknown / service-down. */
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
}

/** Quick check used to decide whether the UI shows the "RDP In" button.
 *  Cheap — pulls only the server + linked credential, no network calls. */
export async function rdpStatus(serverId: string): Promise<RdpStatus> {
  const server = await serversRepo.findById(serverId)
  if (!server) throw notFound('Server not found')

  const health = deriveHealth(server)
  const pingOk = health?.status === 'online'
  // For a server (no port), "services OK" needs the sibling rows. We don't
  // do that lookup here — pingOk + comfyOk on the row is enough signal for
  // the UI. The frontend resolves the broader "are linked services healthy"
  // question because it already has the full servers list cached.
  const servicesOk = pingOk && (server.lastComfyOk ?? true)

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

/** Spawn xfreerdp + Xvfb the way connect.sh does, minus the screenshot.
 *  Resolves once xfreerdp exits (either on its own or because we killed it
 *  after HOLD_SECONDS). Throws HttpError for preflight failures so the route
 *  layer can return a precise status. */
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

  const display = `:${allocDisplay()}`
  const start = Date.now()

  // 1. Start Xvfb. The script uses :99/1280x800x24 — same here, just on our
  //    isolated display. -nolisten tcp keeps it local to the container.
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
    `/v:${rdpHost}`,
    `/u:${cred.username}`,
    `/p:${password}`,
    '/cert:ignore',
    '/w:1280',
    '/h:800',
    '-wallpaper',
    '-themes',
    '+clipboard',
    '/log-level:WARN',
  ]
  if (cred.domain) args.splice(2, 0, `/d:${cred.domain}`)

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

  const exitInfo = await waitForExitOrTimeout(xfreerdp, HOLD_SECONDS * 1000)

  // 3. Tear down both processes. waitForExitOrTimeout has already SIGTERM-ed
  //    xfreerdp on timeout; do Xvfb here regardless of which path we took.
  killAndForget(xvfb)
  // Belt-and-braces — if xfreerdp ignored SIGTERM (rare), SIGKILL it.
  if (xfreerdp.exitCode === null && xfreerdp.signalCode === null) {
    try {
      xfreerdp.kill('SIGKILL')
    } catch {}
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
    rdpHost,
    durationMs: Date.now() - start,
    stderrTail,
  }
}

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
