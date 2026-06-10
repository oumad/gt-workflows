# dev.ps1 -- start the API and the frontend in DEV mode (hot reload), each in
# its own PowerShell window so their outputs stay readable.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less
# files as ANSI, and bytes from chars like em dashes decode to smart quotes
# that the parser treats as string delimiters.
#
# Usage (from repo root):
#   .\dev.ps1                                # api :3001, frontend :5173
#   .\dev.ps1 -ApiPort 3005 -FrontendPort 5500
#
# Ports are governed by the parameters and exported into both windows, so the
# Vite proxy ALWAYS points at the API's real port. -ApiPort takes precedence
# over PORT in api\.env (dotenv never overrides an existing shell variable).
#
# What each window does:
#   API      -- cd api      ; npm run dev            (tsx watch src/index.ts)
#               Loads the rest of its env from api\.env. Binds HOST (default
#               0.0.0.0 = every IPv4 interface, IPv4 only) so 127.0.0.1
#               always works on Windows.
#   Frontend -- cd frontend ; npm run dev            (vite, HMR)
#               VITE_DEV_API_PROXY is forced to http://127.0.0.1:<ApiPort> so
#               the proxy never resolves to the IPv6 loopback. strictPort is
#               on: if the port is taken, vite fails loudly instead of
#               silently moving to the next port.
#
# To stop: close the two spawned windows (Ctrl+C inside them works too).
# Each runs independently -- restart only the one you need.

param(
  [int]$ApiPort = 3001,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Test-Path "$root\api\.env")) {
  Write-Warning "api\.env not found. The API will refuse to boot without DATABASE_URL, REDIS_URL and JWT_SECRET (>=16 chars). Create it from api\.env.example before running."
}
if (-not (Test-Path "$root\api\node_modules")) {
  Write-Warning "api\node_modules missing -- run 'npm install' inside api\ first."
}
if (-not (Test-Path "$root\frontend\node_modules")) {
  Write-Warning "frontend\node_modules missing -- run 'npm install' inside frontend\ first."
}

Write-Host "[dev] starting API window (port $ApiPort)..."
Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  @"
Set-Location '$root\api'
`$env:PORT = '$ApiPort'
Write-Host '[api] npm run dev (PORT=$ApiPort)' -ForegroundColor Cyan
npm run dev
"@
)

# Give the API a head-start so the frontend's first /api/health poll lands on
# something. Vite would retry anyway, but this avoids the initial "offline"
# banner flash.
Start-Sleep -Seconds 2

Write-Host "[dev] starting frontend window (port $FrontendPort)..."
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
Write-Host '[frontend] npm run dev (port $FrontendPort)' -ForegroundColor Magenta
npm run dev
"@
)

Write-Host ""
Write-Host "[dev] launched. Open http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "[dev] close the two spawned windows to stop." -ForegroundColor DarkGray
