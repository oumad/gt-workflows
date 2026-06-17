/**
 * Headless RDP credential probe — validates that a target host accepts stored
 * credentials by opening a real RDP session and briefly holding it. The API
 * spawns Xvfb + xfreerdp inside its own container (the image bundles
 * `freerdp` + `xvfb`; see api/Dockerfile) against a virtual display, exactly
 * like the operator's connect.sh, minus the screenshot. A held session is a
 * STRONGER proof than NLA-only auth — it proves an interactive login, not just
 * that the security layer answered. (An earlier revision used xfreerdp
 * /auth-only, but that fails security negotiation against hosts a full session
 * connects to fine — ERRCONNECT_SECURITY_NEGO_CONNECT_FAILED.) Linux-only — a
 * natively-run Windows api can't use it (requireEmbeddedToolchain throws 500).
 *
 * Returns a structured result on success/failure; throws HttpError on
 * misconfigurations (no creds, server unreachable, missing binary).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, existsSync, constants as fsConstants } from 'node:fs'
import { join, delimiter } from 'node:path'
import { hostnameOf, resolveFqdn } from '../lib/serverUrl.js'
import { decrypt } from '../lib/crypto.js'
import { badRequest, notFound, HttpError } from '../lib/httpError.js'
import * as serversRepo from '../repositories/servers.js'
import * as credentialsRepo from '../repositories/credentials.js'
import { deriveHealth } from './servers.js'
import { config } from '../config/index.js'

// How long to hold the RDP session open before tearing it down. A session that
// stays up this long proves the login succeeded; xfreerdp exits early on its
// own (non-zero) when auth or negotiation fails. Matches connect.sh.
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

// Max time to wait for Xvfb's X socket to appear before launching xfreerdp.
// We poll for readiness (waitForXvfb) rather than blind-sleeping: a fixed wait
// that was too short raced xfreerdp ahead of the display and made it die early
// (a bogus "exit 133 on good credentials"). Falls through after the cap so a
// truly-absent display still surfaces as a clear xfreerdp error, not a hang.
const XVFB_READY_CAP_MS = 4000
// Cap the tail we keep — xfreerdp can be chatty under verbose log levels.
const STDERR_TAIL_BYTES = 8 * 1024

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

export type RdpVerdict = 'credentials_ok' | 'auth_failed' | 'inconclusive' | 'failed'

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
  /** Human interpretation — a raw exit code alone left users asking "but did
   *  the LOGIN work?". See classifyRdpOutcome. */
  verdict: RdpVerdict
  summary: string
}

/** What the execution paths produce — verdict/summary are layered on top. */
type RdpRawResult = Omit<RdpConnectResult, 'verdict' | 'summary'>

// Auth-failure signatures in xfreerdp output — a definitive "credentials
// rejected" verdict. Robust across FreeRDP 2/3 wording.
const RDP_AUTH_FAIL_RE =
  /LOGON_FAILURE|AUTHENTICATION_FAILED|ERRCONNECT_AUTHENTICATION|ERRCONNECT_LOGON|STATUS_LOGON|ERRCONNECT_PASSWORD|ACCESS_DENIED|ACCOUNT_(?:LOCKED|DISABLED|RESTRICTION)|password (?:has )?expired/i

// Connection / security-negotiation failures — NOT credential rejections.
// These mean we reached the host but couldn't establish the RDP channel
// (negotiation refused, TLS/transport failure, or the host isn't speaking
// RDP). classifyRdpOutcome maps them to a precise "connection failed" verdict
// rather than the generic fallback. (0x0002000C = ERRCONNECT_SECURITY_NEGO_
// CONNECT_FAILED.)
const RDP_CONN_FAIL_RE =
  /ERRCONNECT_(?:SECURITY_NEGO|CONNECT|TRANSPORT|TCP|DNS|SSL|TLS)|0x0002000C|nego_connect|negotiation or connection failure|Failed to connect/i

/** Turn the raw probe outcome into a human verdict. The probe opens a real RDP
 *  session and holds it for HOLD_SECONDS: if the session stays up that long (we
 *  tear it down — `timedOut`) or exits cleanly, the login is valid. A failure
 *  makes xfreerdp exit early on its own with a non-zero code and a telltale log
 *  line, so we read the log first to name the cause precisely. */
function classifyRdpOutcome(r: RdpRawResult): { verdict: RdpVerdict; summary: string } {
  const sec = Math.round(r.durationMs / 1000)
  // Credential rejection is the most specific verdict — trust the log over the
  // exit code (it can arrive on either). 129 = XF_EXIT_LOGON_FAILURE,
  // 130 = XF_EXIT_ACCOUNT_LOCKED_OUT.
  if (RDP_AUTH_FAIL_RE.test(r.stderrTail) || r.exitCode === 129 || r.exitCode === 130) {
    return {
      verdict: 'auth_failed',
      summary:
        'The server answered but REJECTED the credentials (authentication failure). Check the linked credential — username, domain and password.',
    }
  }
  // Reached the host but couldn't establish the RDP channel — a connection
  // problem, not a credential verdict. Checked before the success path so a
  // negotiation failure can never be mistaken for a held session.
  if (RDP_CONN_FAIL_RE.test(r.stderrTail)) {
    return {
      verdict: 'failed',
      summary: `Reached the host but the RDP connection / security negotiation failed (${sec}s) — this is NOT a credential verdict. Usually means RDP isn't reachable on this host or the server refused the negotiation. The output below has the detail.`,
    }
  }
  // Held the session for the full hold (we tore it down) or it exited cleanly,
  // with no failure markers — a real interactive login succeeded.
  if (r.ok) {
    return {
      verdict: 'credentials_ok',
      summary: `The server accepted the credentials — opened and held an RDP session for ${sec}s before we tore it down. The login is valid.`,
    }
  }
  // Exited early, non-zero, with nothing we recognise in the log.
  return {
    verdict: 'failed',
    summary: `Could not establish the session (exit ${r.exitCode ?? 'null'}${r.signal ? ` / ${r.signal}` : ''}) — a connection, certificate or network failure rather than a credential rejection. The output below has the reason.`,
  }
}

/** Quick check used to decide whether the UI shows the "RDP In" button.
 *  Cheap — pulls only the server + linked credential, no network calls. */
export async function rdpStatus(serverId: string): Promise<RdpStatus> {
  const server = await serversRepo.findById(serverId)
  if (!server) throw notFound('Server not found')

  const health = deriveHealth(server)
  const pingOk = health?.status === 'online'
  // "Services OK" reflects the ACTUAL service records on this host — it used
  // to mirror the host's ping, so a pinging box with dead ComfyUI showed a
  // green services pip. Maintenance services don't count against it.
  const all = await serversRepo.findAll()
  const hostname0 = hostnameOf(server.url)
  const siblings = hostname0
    ? all.filter((s) => {
        if (s.id === server.id || s.isMaintenance) return false
        if (hostnameOf(s.url) !== hostname0) return false
        try {
          return !!new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`).port
        } catch {
          return false
        }
      })
    : []
  const servicesOk =
    siblings.length === 0 ? pingOk : siblings.every((s) => !!s.lastPingAt && !!s.lastPingOk)

  const cred = await credentialsRepo.findCredentialForServer(serverId)

  const rawHost = hostnameOf(server.url)
  const rdpHost = rawHost ? await resolveFqdn(rawHost) : null

  return {
    reachable: pingOk,
    pingOk,
    servicesOk,
    credentialId: cred?.id ?? null,
    rdpHost,
  }
}

/** Run the RDP test for a server: open and briefly hold a full xfreerdp session
 *  in the API container. Throws HttpError for preflight failures so the route
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

  const rawHost = hostnameOf(server.url)
  if (!rawHost) {
    throw badRequest('Server URL has no resolvable hostname — cannot target an RDP session.')
  }
  // Resolve short hostnames (e.g. x1201491) to FQDN before connecting — RDP
  // security negotiation fails against domain hosts when only the short name
  // is given (TLS cert is issued to the FQDN; negotiation rejects the mismatch).
  const rdpHost = await resolveFqdn(rawHost)

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
      `Could not decrypt the linked credential: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const params = {
    host: rdpHost,
    username: cred.username,
    domain: cred.domain ?? null,
    password,
    holdSeconds: HOLD_SECONDS,
  }

  const raw = await runRdpEmbedded(params)
  const outcome = classifyRdpOutcome(raw)
  // `ok` is authoritative from the verdict (a held session vs a recognised
  // failure in the log), not the bare exit code (see classifyRdpOutcome).
  return { ...raw, ...outcome, ok: outcome.verdict === 'credentials_ok' }
}

/* ─── Probe runner ───────────────────────────────────────────────────── */

type RdpParams = {
  host: string
  username: string
  domain: string | null
  password: string
  holdSeconds: number
}

// Embedded mode needs the Linux RDP toolchain inside OUR image. Resolve it
// once up-front and fail with an actionable message — otherwise a missing
// binary only surfaces as `spawn xfreerdp ENOENT` mid-probe and the UI shows
// a cryptic "probe failed (exit null)". Debian bookworm's freerdp2-x11
// installs the client as plain `xfreerdp`.
const RDP_CLIENT_CANDIDATES = ['xfreerdp']

function findOnPath(names: string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      const full = join(dir, name)
      try {
        accessSync(full, fsConstants.X_OK)
        return full
      } catch {
        /* keep looking */
      }
    }
  }
  return null
}

let toolchain: { client: string; xvfb: string } | null | undefined
function requireEmbeddedToolchain(): { client: string; xvfb: string } {
  if (process.platform === 'win32') {
    throw new HttpError(
      500,
      'rdp_toolchain_missing',
      'RDP credential testing needs the Linux toolchain (xfreerdp + Xvfb), which ' +
        'does not exist on a native Windows api — run the api in the Docker image ' +
        '(which bundles them) to use this feature.',
    )
  }
  if (toolchain === undefined) {
    const client = findOnPath(RDP_CLIENT_CANDIDATES)
    const xvfb = findOnPath(['Xvfb'])
    toolchain = client && xvfb ? { client, xvfb } : null
  }
  if (!toolchain) {
    throw new HttpError(
      500,
      'rdp_toolchain_missing',
      'xfreerdp / Xvfb not found in this container. The api image installs them ' +
        '(api/Dockerfile) — this is usually a STALE image built before that ' +
        'layer existed: rebuild it (docker compose build api) and redeploy.',
    )
  }
  return toolchain
}

/** Spawn xfreerdp + Xvfb the way connect.sh does, minus the screenshot.
 *  Resolves once xfreerdp exits (either on its own or because we killed it
 *  after holdSeconds). */
async function runRdpEmbedded(p: RdpParams): Promise<RdpRawResult> {
  // Throws a precise 500 when the toolchain is absent (stale image, native
  // Windows) instead of letting spawn() ENOENT mid-flight.
  const bins = requireEmbeddedToolchain()
  const displayNum = allocDisplay()
  const display = `:${displayNum}`
  const start = Date.now()

  // 1. Start Xvfb. -nolisten tcp keeps it local to the container (its unix
  //    socket at /tmp/.X11-unix/X<n> is what waitForXvfb polls for).
  const xvfb = spawn(bins.xvfb, [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: false,
  })
  xvfb.on('error', (err) => {
    // Reachable when Xvfb isn't installed — surface as a 500 from the route.
    console.error('[rdp] Xvfb failed to launch:', err.message)
  })

  // Wait until Xvfb is actually listening before launching xfreerdp — racing
  // it ahead of the display makes it die early (the bogus "exit 133 on good
  // credentials" that prompted the ill-fated switch to /auth-only).
  await waitForXvfb(displayNum, XVFB_READY_CAP_MS)

  // 2. Build xfreerdp args — a full session, exactly like connect.sh: open the
  //    desktop (wallpaper/themes off for speed, clipboard on) and hold it.
  //    /p:<password> appears in `ps` — acceptable inside the container (nothing
  //    else to spy on us); avoid logging or echoing the full arg list elsewhere.
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
  // Operator-tunable extra flags (config.RDP_EXTRA_ARGS) — escape hatch for
  // FreeRDP-3 negotiation quirks (e.g. /tls:seclevel:0, /sec:nla). Passed as
  // separate argv tokens (spawn, not a shell), so there's no injection surface.
  for (const a of config.RDP_EXTRA_ARGS.split(/\s+/)) if (a) args.push(a)

  const xfreerdp = spawn(bins.client, args, {
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

  const stderrTail = stderrBuf.toString('utf8')
  // Success = the session stayed up for the whole hold (we tore it down →
  // timedOut) or it exited cleanly. A real auth/connection failure makes
  // xfreerdp exit early on its own with a non-zero code. Provisional —
  // rdpConnect re-derives the authoritative `ok` from classifyRdpOutcome, which
  // also reads the log so a held-but-failed edge can't read as success.
  const ok = exitInfo.timedOut || exitInfo.code === 0

  return {
    ok,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    rdpHost: p.host,
    durationMs: Date.now() - start,
    stderrTail,
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

/** Poll for Xvfb's X socket (/tmp/.X11-unix/X<n>) to appear, up to capMs, so we
 *  launch xfreerdp only once the display is accepting clients. Returns as soon
 *  as it's ready; falls through after the cap so a genuinely-absent display
 *  surfaces as a clear xfreerdp failure rather than a hang here. */
async function waitForXvfb(displayNum: number, capMs: number): Promise<void> {
  const sock = `/tmp/.X11-unix/X${displayNum}`
  const deadline = Date.now() + capMs
  while (Date.now() < deadline) {
    if (existsSync(sock)) return
    await new Promise((r) => setTimeout(r, 50))
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
