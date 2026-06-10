import { Agent } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// All knobs are optional env vars (set by dev.ps1 / start.ps1, docker, or the
// shell):
//   VITE_DEV_API_PROXY  where /api/* is proxied. Default http://127.0.0.1:3001
//                       (native API on the same box). docker dev.yml sets
//                       http://api:3001 so the proxy crosses the docker network.
//   FRONTEND_PORT       port for BOTH `vite` (dev) and `vite preview` (start).
//                       Defaults: 5173 dev, 4173 preview.
//
// 127.0.0.1 (not "localhost") on purpose: on Windows, "localhost" often
// resolves to ::1 first while the API listens on IPv4 only, which makes the
// proxy intermittently fail with ECONNREFUSED mid-session. dev.ps1/start.ps1
// force the same value; the default here protects a bare `npm run dev`.
const apiProxyTarget = process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:3001'
const devPort = Number(process.env.FRONTEND_PORT ?? 5173)
const previewPort = Number(process.env.FRONTEND_PORT ?? 4173)

// One keep-alive agent shared by the dev + preview proxies. Without it,
// http-proxy opens a BRAND-NEW TCP connection for every /api call and closes
// it after the response (it defaults to `Connection: close` when no agent is
// set). With the app polling several endpoints, Windows piles up thousands
// of TIME_WAIT sockets toward 127.0.0.1:<api> until the ephemeral-port pool
// runs dry — then connects fail with EADDRINUSE, the proxy returns 502, and
// the whole box's networking (RDP sessions included) crawls while Task
// Manager shows nothing. Pooled keep-alive sockets make the churn ~zero.
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 32 })

// Shared /api proxy. `vite preview` reuses it so the BUILT SPA can be served
// production-style on a native Windows box (npm start → build + preview) with
// the same same-origin /api shape nginx provides in the docker stack.
const apiProxy = {
  '/api': {
    target: apiProxyTarget,
    changeOrigin: true,
    agent: keepAliveAgent,
    // Don't let a wedged API pin browser requests (and their sockets) open
    // indefinitely — give up after 30s and return a 504 instead.
    timeout: 30_000,
    proxyTimeout: 30_000,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    // '0.0.0.0' = every IPv4 interface (docker-mapped ports + LAN) and IPv4
    // ONLY — Windows' IPv6-loopback quirks have caused enough phantom
    // "connection lost" reports that we exclude that stack outright.
    host: '0.0.0.0',
    port: devPort,
    // Fail loudly when the port is taken instead of silently bumping to the
    // next one — an auto-bumped port looks exactly like "the app is up but
    // the API connection is broken" from the browser's point of view.
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: previewPort,
    strictPort: true,
    proxy: apiProxy,
  },
  // Vite's default `appType: 'spa'` already serves index.html for non-asset
  // routes, so deep links like /workflows/:id work without extra config.
})
