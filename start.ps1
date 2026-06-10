# start.ps1 -- build + serve API and frontend in PROD-style mode, one console
# window per service: API runs node dist\index.js, frontend runs vite preview
# (built SPA + /api proxy, nginx-free). Both BUILDS run here first -- a build
# error stops the launch with the output in this window.
#
#   .\start.ps1 [-ApiPort 3001] [-FrontendPort 4173]
#
# Ports are exported into both windows (they override PORT in api\.env) so
# the /api proxy always targets the real API port. Closing a window kills its
# service; busy ports abort with the owning process named. Keep this file
# pure ASCII: PS 5.1 reads BOM-less files as ANSI, where em-dash bytes decode
# to quote chars and break parsing.

param(
  [int]$ApiPort = 3001,
  [int]$FrontendPort = 4173
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Test-Path "$root\api\.env")) {
  Write-Warning "api\.env not found -- create it from api\.env.example (DATABASE_URL, REDIS_URL and JWT_SECRET are required)."
}
if (-not (Test-Path "$root\api\node_modules")) {
  Write-Warning "api\node_modules missing -- run 'npm install' inside api\ first (dev deps included: the build needs tsc)."
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

Write-Host "[start] building api (tsc)..." -ForegroundColor Cyan
Push-Location "$root\api"
npm run build
$buildOk = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $buildOk) { Write-Host "[start] API build FAILED -- nothing launched." -ForegroundColor Red; exit 1 }

Write-Host "[start] building frontend (tsc + vite build)..." -ForegroundColor Cyan
Push-Location "$root\frontend"
npm run build
$buildOk = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $buildOk) { Write-Host "[start] frontend build FAILED -- nothing launched." -ForegroundColor Red; exit 1 }

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

Write-Host "[start] starting API window [coffee-api] on port $ApiPort..."
Start-NodeWindow 'coffee-api' "$root\api" @('dist\index.js') @{
  PORT = "$ApiPort"
}

Write-Host "[start] starting frontend window [coffee-frontend] on port $FrontendPort..."
Start-NodeWindow 'coffee-frontend' "$root\frontend" @('node_modules\vite\bin\vite.js', 'preview') @{
  FRONTEND_PORT      = "$FrontendPort"
  VITE_DEV_API_PROXY = "http://127.0.0.1:$ApiPort"
}

Write-Host ""
Write-Host "[start] launched. Open http://127.0.0.1:$FrontendPort" -ForegroundColor Green
Write-Host "[start] closing a window stops its service." -ForegroundColor DarkGray
