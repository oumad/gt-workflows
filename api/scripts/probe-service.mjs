#!/usr/bin/env node
// probe-service.mjs -- diagnose why a ComfyUI / AI-Toolkit health probe fails
// from THIS machine, exercising the exact same code paths the API monitor
// uses (serverHealth.ts). Run it on the box where the API runs.
//
// Usage (from the api/ folder so node_modules/undici resolves):
//   node scripts/probe-service.mjs http://worker-03:8188          # ComfyUI
//   node scripts/probe-service.mjs http://worker-05:8675 lora     # AI-Toolkit
//   npm run probe:service -- http://worker-03:8188
//
// It reports, in order:
//   1. DNS  - what the OS resolver gives node (ping can also use
//             NetBIOS/LLMNR; node fetch cannot)
//   2. TCP  - raw connect to the port (firewall drop vs refused vs open)
//   3. HTTP - fetch exactly like the monitor: direct (MONITOR_USE_PROXY=false,
//             the default) and through HTTP_PROXY/HTTPS_PROXY if set
//             (MONITOR_USE_PROXY=true)
//
// How to read the output:
//   [dns] lookup FAILED            -> node can't resolve the name at all.
//                                     Use an IP in the server URL or fix DNS.
//   [tcp] TIMEOUT                  -> something drops the port from this box
//                                     (ICMP ping working proves nothing).
//   [tcp] ERROR ECONNREFUSED       -> box reachable, nothing listening there.
//   [http] direct FAILED, proxy OK -> set MONITOR_USE_PROXY=true in api/.env.
//   [http] 4xx/5xx                 -> port answers but not the expected app;
//                                     the monitor treats non-2xx as down.

import { lookup, resolve4, resolve6 } from 'node:dns/promises'
import net from 'node:net'
import { Agent, ProxyAgent } from 'undici'

const TIMEOUT_MS = 5000
const SERVICE_PATH = { workflow: '/system_stats', lora: '/api/gpu' }

const rawUrl = process.argv[2]
const type = (process.argv[3] ?? 'workflow').toLowerCase()
if (!rawUrl) {
  console.error('usage: node scripts/probe-service.mjs <baseUrl> [workflow|lora]')
  process.exit(1)
}

const base = rawUrl.replace(/\/+$/, '')
let u
try {
  u = new URL(base)
} catch {
  console.error('not a valid URL:', rawUrl)
  process.exit(1)
}
const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
const target = base + (SERVICE_PATH[type] ?? '')
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  ''

console.log(
  `node ${process.version} / bundled undici ${process.versions.undici} on ${process.platform}`,
)
console.log(`target : ${target}   (host=${u.hostname} port=${port} type=${type})`)
console.log(
  `proxy  : ${proxyUrl || '(none set)'}   NO_PROXY=${process.env.NO_PROXY || process.env.no_proxy || '(unset)'}`,
)
console.log('')

// -- 1. DNS -------------------------------------------------------
const addrs = []
if (net.isIP(u.hostname)) {
  console.log('[dns] hostname is an IP literal - skipping resolution')
  addrs.push(u.hostname)
} else {
  try {
    const found = await lookup(u.hostname, { all: true, verbatim: true })
    console.log(
      `[dns] lookup (OS resolver, what fetch uses): ${found.map((a) => `${a.address} (v${a.family})`).join(', ')}`,
    )
    addrs.push(...found.map((a) => a.address))
  } catch (e) {
    console.log(`[dns] lookup FAILED: ${e.code} - node cannot resolve this name at all.`)
    console.log('      ping may still work via NetBIOS/LLMNR; fetch cannot. Use an IP or fix DNS.')
  }
  try {
    console.log(`[dns] resolve4 (pure DNS): ${(await resolve4(u.hostname)).join(', ')}`)
  } catch (e) {
    console.log(`[dns] resolve4: no A record (${e.code})`)
  }
  try {
    console.log(`[dns] resolve6 (pure DNS): ${(await resolve6(u.hostname)).join(', ')}`)
  } catch (e) {
    console.log(`[dns] resolve6: no AAAA record (${e.code})`)
  }
}
console.log('')

// -- 2. raw TCP ---------------------------------------------------
function tcpTry(host) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const start = Date.now()
    let done = false
    const fin = (msg) => {
      if (done) return
      done = true
      sock.destroy()
      resolve(`${msg} in ${Date.now() - start}ms`)
    }
    sock.setTimeout(TIMEOUT_MS)
    sock.once('connect', () => fin('CONNECTED'))
    sock.once('timeout', () => fin('TIMEOUT (filtered/dropped - firewall?)'))
    sock.once('error', (e) => fin(`ERROR ${e.code}`))
    sock.connect(port, host)
  })
}
for (const a of addrs.length ? addrs : [u.hostname]) {
  console.log(`[tcp] ${a}:${port} -> ${await tcpTry(a)}`)
}
console.log('')

// -- 3. HTTP, exactly like the monitor ----------------------------
function describeErr(e) {
  const parts = [`${e.name}: ${e.message}`]
  let c = e.cause
  while (c) {
    parts.push(c.code ?? c.message ?? String(c))
    c = c.cause
  }
  return parts.join(' <- ')
}

async function tryFetch(label, dispatcher) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const start = Date.now()
  try {
    const init = { method: 'GET', signal: ctl.signal }
    if (dispatcher) init.dispatcher = dispatcher
    const res = await fetch(target, init)
    const body = (await res.text()).slice(0, 120).replace(/\s+/g, ' ')
    // The monitor's verdict is `res.ok` (2xx after redirects) -- mirror it.
    const verdict = res.ok ? 'monitor would say UP' : 'monitor would say DOWN (non-2xx)'
    console.log(`[http] ${label}: ${res.status} in ${Date.now() - start}ms -> ${verdict}`)
    console.log(`       body: ${body || '(empty)'}`)
  } catch (e) {
    console.log(`[http] ${label}: FAILED in ${Date.now() - start}ms -> ${describeErr(e)}`)
  } finally {
    clearTimeout(timer)
  }
}

await tryFetch('direct  (MONITOR_USE_PROXY=false, the default)', new Agent())
if (proxyUrl) {
  await tryFetch('proxied (MONITOR_USE_PROXY=true)', new ProxyAgent(proxyUrl))
} else {
  console.log('[http] no HTTP_PROXY/HTTPS_PROXY in this shell - skipping the proxied test')
}
