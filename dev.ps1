# dev.ps1 -- start the API and the frontend in DEV mode (hot reload), ONE
# console window per service, two windows total.
#
# Each window runs node DIRECTLY (cmd /k title ... && node <entry>) instead
# of going through npm: no nested shells means no extra windows, and because
# node is attached to its window's console, CLOSING THE WINDOW KILLS THE
# SERVICE -- no orphaned node left holding the port. The cmd /k wrapper only
# exists so the window stays open after a crash (you can read the error) and
# carries a recognizable title.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less
# files as ANSI, and bytes from chars like em dashes decode to smart quotes
# that the parser treats as string delimiters.
#
# Usage (from repo root):
#   .\dev.ps1                                # api :3001, frontend :5173
#   .\dev.ps1 -ApiPort 3005 -FrontendPort 5500
#
#   API window      [coffee-api]       tsx watch src/index.ts   (cwd api\)
#   Frontend window [coffee-frontend]  vite with HMR            (cwd frontend\)
#
# Ports come from the parameters and are exported into both windows, so the
# Vite proxy ALWAYS points at the API's real port (http://127.0.0.1:<ApiPort>).
# -ApiPort takes precedence over PORT in api\.env. If a port is already in
# use -- usually an orphaned node from a previous run -- the script names the
# process and exits instead of half-starting.

param(
  [int]$ApiPort = 3001,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ---- preflight ------------------------------------------------------------

if (-not (Test-Path "$root\api\.env")) {
  Write-Warning "api\.env not found. The API will refuse to boot without DATABASE_URL, REDIS_URL and JWT_SECRET (>=16 chars). Create it from api\.env.example before running."
}
if (-not (Test-Path "$root\api\node_modules")) {
  Write-Warning "api\node_modules missing -- run 'npm install' inside api\ first."
}
if (-not (Test-Path "$root\frontend\node_modules")) {
  Write-Warning "frontend\node_modules missing -- run 'npm install' inside frontend\ first."
}

function Test-PortFree([int]$Port, [string]$ParamName) {
  $conns = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($conns.Count -eq 0) { return $true }
  $owners = $conns | ForEach-Object OwningProcess | Sort-Object -Unique | ForEach-Object {
    try { $p = Get-Process -Id $_ -ErrorAction Stop; "$($p.ProcessName) (PID $_)" } catch { "PID $_" }
  }
  Write-Warning "Port $Port is already in use by: $($owners -join ', ')."
  Write-Warning "Likely an orphan from a previous run. Kill it with: taskkill /PID <pid> /T /F   (or pass a different -$ParamName)"
  return $false
}

$ok = (Test-PortFree $ApiPort 'ApiPort')
$ok = (Test-PortFree $FrontendPort 'FrontendPort') -and $ok
if (-not $ok) { exit 1 }

# ---- launcher ---------------------------------------------------------------
# Sets env vars in THIS process (inherited by the child), spawns the window,
# then restores the previous values so the calling shell isn't polluted.
# Every -ArgumentList element is space-free on purpose: Start-Process leaves
# them unquoted, so cmd sees the raw '&&' and chains title -> node.

function Start-NodeWindow([string]$Title, [string]$Dir, [string[]]$NodeArgs, [hashtable]$EnvVars) {
  $saved = @{}
  foreach ($k in $EnvVars.Keys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k)
    Set-Item "env:$k" $EnvVars[$k]
  }
  try {
    Start-Process cmd -WorkingDirectory $Dir -ArgumentList (@('/k', 'title', $Title, '&&', 'node') + $NodeArgs)
  } finally {
    foreach ($k in $EnvVars.Keys) {
      if ($null -ne $saved[$k]) { Set-Item "env:$k" $saved[$k] }
      else { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
    }
  }
}

# ---- go ---------------------------------------------------------------------

Write-Host "[dev] starting API window [coffee-api] on port $ApiPort..."
Start-NodeWindow 'coffee-api' "$root\api" @('node_modules\tsx\dist\cli.mjs', 'watch', 'src\index.ts') @{
  PORT = "$ApiPort"
}

# Small head start so the frontend's first /api/health poll lands on
# something -- avoids the initial "offline" banner flash.
Start-Sleep -Seconds 2

Write-Host "[dev] starting frontend window [coffee-frontend] on port $FrontendPort..."
Start-NodeWindow 'coffee-frontend' "$root\frontend" @('node_modules\vite\bin\vite.js') @{
  FRONTEND_PORT      = "$FrontendPort"
  VITE_DEV_API_PROXY = "http://127.0.0.1:$ApiPort"
}

Write-Host ""
Write-Host "[dev] launched. Open http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "[dev] closing a window stops its service (node dies with its console)." -ForegroundColor DarkGray
