# dev.ps1 -- API + frontend in DEV mode (hot reload), one console window per
# service. Windows run node directly: closing a window kills its service, and
# no npm nesting means no extra windows.
#
#   .\dev.ps1 [-ApiPort 3001] [-FrontendPort 5173]
#
# Ports are exported into both windows (they override PORT in api\.env) so
# the /api proxy always targets the real API port. Busy ports abort with the
# owning process named. Keep this file pure ASCII: PS 5.1 reads BOM-less
# files as ANSI, where em-dash bytes decode to quote chars and break parsing.

param(
  [int]$ApiPort = 3001,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Test-Path "$root\api\.env")) {
  Write-Warning "api\.env not found -- create it from api\.env.example (DATABASE_URL, REDIS_URL and JWT_SECRET are required)."
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
  Write-Warning "Port $Port is in use by: $($owners -join ', '). Kill it (taskkill /PID <pid> /T /F) or pass a different -$ParamName."
  return $false
}

$ok = (Test-PortFree $ApiPort 'ApiPort')
$ok = (Test-PortFree $FrontendPort 'FrontendPort') -and $ok
if (-not $ok) { exit 1 }

# Spawns `cmd /k title <t> && node <args>` with env vars set for the child
# only. Space-free args stay unquoted, so cmd sees the raw '&&'.
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

Write-Host "[dev] starting API window [coffee-api] on port $ApiPort..."
Start-NodeWindow 'coffee-api' "$root\api" @('node_modules\tsx\dist\cli.mjs', 'watch', 'src\index.ts') @{
  PORT = "$ApiPort"
}

# Head start so the frontend's first /api/health poll lands on something.
Start-Sleep -Seconds 2

Write-Host "[dev] starting frontend window [coffee-frontend] on port $FrontendPort..."
Start-NodeWindow 'coffee-frontend' "$root\frontend" @('node_modules\vite\bin\vite.js') @{
  FRONTEND_PORT      = "$FrontendPort"
  VITE_DEV_API_PROXY = "http://127.0.0.1:$ApiPort"
}

Write-Host ""
Write-Host "[dev] launched. Open http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "[dev] closing a window stops its service." -ForegroundColor DarkGray
