# start.ps1 -- build + serve the API and frontend in PROD-style mode (no hot
# reload), each in its own PowerShell window. This is the native-Windows
# equivalent of the docker prod stack: use it on a box where Docker only runs
# postgres + the RDP sidecar (docker-compose-templates/postgres-rdp.yml) and
# node serves the rest -- e.g. when the workflows folder lives on a UNC share
# the containers can't reach.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less
# files as ANSI, and bytes from chars like em dashes decode to smart quotes
# that the parser treats as string delimiters.
#
# Usage (from repo root):
#   .\start.ps1                                # api :3001, frontend :4173
#   .\start.ps1 -ApiPort 3001 -FrontendPort 8080
#
# What each window does:
#   API      -- cd api      ; npm start
#               'prestart' runs 'npm run build' (tsc) first, so the server can
#               NEVER run a stale dist\. Env comes from api\.env; PORT comes
#               from -ApiPort (overrides api\.env so the frontend proxy always
#               matches). Binds HOST (default 0.0.0.0 = IPv4 only).
#   Frontend -- cd frontend ; npm start
#               'prestart' runs the full build (tsc + vite build), then
#               'vite preview' serves the built dist\ and proxies /api to the
#               API -- same same-origin shape nginx provides in docker, no
#               nginx needed. strictPort: a taken port fails loudly.
#
# First start is slower -- both builds run before anything serves. To stop:
# close the windows (Ctrl+C inside them works too).

param(
  [int]$ApiPort = 3001,
  [int]$FrontendPort = 4173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Test-Path "$root\api\.env")) {
  Write-Warning "api\.env not found. The API will refuse to boot without DATABASE_URL, REDIS_URL and JWT_SECRET (>=16 chars). Create it from api\.env.example before running."
}
if (-not (Test-Path "$root\api\node_modules")) {
  Write-Warning "api\node_modules missing -- run 'npm install' inside api\ first (dev deps included: the build needs tsc)."
}
if (-not (Test-Path "$root\frontend\node_modules")) {
  Write-Warning "frontend\node_modules missing -- run 'npm install' inside frontend\ first."
}

Write-Host "[start] starting API window (build + serve, port $ApiPort)..."
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  @"
Set-Location '$root\api'
`$env:PORT = '$ApiPort'
Write-Host '[api] npm start (build + node dist, PORT=$ApiPort)' -ForegroundColor Cyan
npm start
"@
)

Write-Host "[start] starting frontend window (build + preview, port $FrontendPort)..."
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  @"
Set-Location '$root\frontend'
# 127.0.0.1 (not localhost) so the proxy never resolves to the IPv6 loopback.
`$env:VITE_DEV_API_PROXY = 'http://127.0.0.1:$ApiPort'
`$env:FRONTEND_PORT = '$FrontendPort'
Write-Host '[frontend] proxy /api -> ' -NoNewline -ForegroundColor DarkGray
Write-Host `$env:VITE_DEV_API_PROXY -ForegroundColor Yellow
Write-Host '[frontend] npm start (build + vite preview, port $FrontendPort)' -ForegroundColor Magenta
npm start
"@
)

Write-Host ""
Write-Host "[start] launched. Both windows build first -- give them a moment." -ForegroundColor Green
Write-Host "[start] then open http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "[start] close the two spawned windows to stop." -ForegroundColor DarkGray
