import { setGlobalDispatcher, ProxyAgent, Agent, Dispatcher } from 'undici'
import { config } from '../config/index.js'

// Reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY (and their lowercase variants)
// and installs a global undici dispatcher so that ALL native fetch() calls
// respect the proxy — including Discord webhooks and any future outbound HTTP.
//
// NO_PROXY is a comma-separated list of hostnames / domain suffixes.
// Requests whose host matches are sent directly, bypassing the proxy.

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

export function setupGlobalProxy(): void {
  if (!config.proxyUrl) return

  setGlobalDispatcher(new SelectiveProxyDispatcher(config.proxyUrl, config.noProxy))

  const bypass = config.noProxy ? ` (bypassing: ${config.noProxy})` : ''
  console.log(`[proxy] routing outbound HTTP through ${config.proxyUrl}${bypass}`)
}
