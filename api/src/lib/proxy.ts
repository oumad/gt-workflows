/**
 * Outbound HTTP policy — every fetch/WebSocket the API makes goes one of
 * three ways:
 *
 *   fetch()              internet targets (Discord). Honors HTTP_PROXY /
 *                        NO_PROXY via the global dispatcher set at boot.
 *   internalFetch() /    LAN targets addressed by server records (ComfyUI,
 *   internalWebSocket()  AI-Toolkit). Direct by default — operator NO_PROXY
 *                        lists rarely cover bare GPU hostnames, which would
 *                        wrongly route through the proxy and fail.
 *                        MONITOR_USE_PROXY=true flips them onto the proxy.
 *
 * directFetch / directDispatcher below are the internal no-proxy primitives
 * the two internal* helpers build on.
 *
 * VERSION PIN: keep the npm `undici` dependency on the SAME MAJOR as the
 * copy bundled in Node (`node -p process.versions.undici`). Native fetch()
 * is the bundled copy and dispatchers cross that boundary — a major mismatch
 * fails every dispatched request with UND_ERR_INVALID_ARG (this once marked
 * all monitored services down). Verify after bumping Node or undici.
 */
import { setGlobalDispatcher, ProxyAgent, Agent, Dispatcher, WebSocket } from 'undici'
import { config } from '../config/index.js'

// ── Global proxy (internet-facing traffic) ──────────────────────

function parseNoProxy(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function matchesNoProxy(hostname: string, patterns: string[]): boolean {
  const h = hostname.toLowerCase()
  return patterns.some((p) => {
    if (p === '*') return true
    const bare = p.startsWith('.') ? p.slice(1) : p
    return h === bare || h.endsWith(`.${bare}`)
  })
}

/** Routes through HTTP(S)_PROXY except for NO_PROXY matches, which go direct. */
class SelectiveProxyDispatcher extends Dispatcher {
  private readonly proxy: ProxyAgent
  private readonly direct: Agent
  private readonly bypass: string[]

  constructor(proxyUrl: string, noProxy: string) {
    super()
    this.proxy = new ProxyAgent(proxyUrl)
    this.direct = new Agent()
    this.bypass = parseNoProxy(noProxy)
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin =
      typeof options.origin === 'string' ? options.origin : (options.origin?.toString() ?? '')
    let hostname = ''
    try {
      hostname = new URL(origin).hostname
    } catch {
      /* use proxy if unparseable */
    }
    const d = hostname && matchesNoProxy(hostname, this.bypass) ? this.direct : this.proxy
    return d.dispatch(options, handler)
  }
}

/** Install the global dispatcher so ALL plain fetch() calls honor the proxy
 *  env vars. Runs once at boot, before any fetch. No-op without a proxy. */
export function setupGlobalProxy(): void {
  if (!config.proxyUrl) return

  setGlobalDispatcher(new SelectiveProxyDispatcher(config.proxyUrl, config.noProxy))

  const bypass = config.noProxy ? ` (bypassing: ${config.noProxy})` : ''
  console.log(`[proxy] routing outbound HTTP through ${config.proxyUrl}${bypass}`)
}

// ── Direct / internal traffic ───────────────────────────────────

/** Shared no-proxy dispatcher. Singleton — cheap to share. */
const directDispatcher: Dispatcher = new Agent()

/** RequestInit plus a convenience timeout (ignored when a signal is given). */
export type FetchInit = RequestInit & { timeoutMs?: number }

function prepare(init: FetchInit): RequestInit {
  const { timeoutMs, ...rest } = init
  if (timeoutMs && !rest.signal) rest.signal = AbortSignal.timeout(timeoutMs)
  return rest
}

/** fetch() that ALWAYS bypasses the proxy — the no-proxy primitive
 *  internalFetch uses for its direct path. The cast bridges undici-types
 *  (from @types/node) and the explicit undici package; `dispatcher` is
 *  honored by native fetch. */
function directFetch(url: string | URL, init: FetchInit = {}): Promise<Response> {
  return fetch(url, {
    ...prepare(init),
    dispatcher: directDispatcher,
  } as unknown as RequestInit)
}

/** fetch() for LAN targets — anything addressed by a server record. New LAN
 *  calls MUST use this; plain fetch() is for internet targets only. */
export function internalFetch(url: string | URL, init: FetchInit = {}): Promise<Response> {
  return config.MONITOR_USE_PROXY ? fetch(url, prepare(init)) : directFetch(url, init)
}

/** WebSocket with the same routing policy as internalFetch — a bare
 *  `new WebSocket()` would use the global dispatcher, i.e. the proxy. */
export function internalWebSocket(url: string): WebSocket {
  const dispatcher = config.MONITOR_USE_PROXY ? undefined : directDispatcher
  return new WebSocket(url, { dispatcher })
}
