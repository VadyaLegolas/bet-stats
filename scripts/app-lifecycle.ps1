# One-file launcher/stopper for the bet-stats dev stack (PostgreSQL + Redis via docker,
# migrations, league seeding, then web :3000 + API :3001 + data-sync worker).
#
#   scripts\app-lifecycle.ps1               start everything and open the browser
#   scripts\app-lifecycle.ps1 -Action Stop  stop the running stack
#   scripts\app-lifecycle.ps1 -Action Status
#
# For double-click usage in Explorer use start-app.bat / stop-app.bat.
# The stack runs detached (hidden process) and logs to %TEMP%\bet-stats-stack.log.
param(
  [ValidateSet("Start", "Stop", "Status")]
  [string]$Action = "Start",
  [switch]$Daemon,
  [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $env:TEMP "bet-stats-stack.log"
$webPort = 3000
$apiPort = 3001

function Load-Env {
  # The API/worker read process.env only, so .env must be loaded into this process.
  if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
      if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
      }
    }
  }
  if (-not $env:REDIS_URL) { $env:REDIS_URL = "redis://127.0.0.1:6379" }
  $env:DATA_PROVIDER_MODE = "live"
  if (-not $env:DISPLAY_TIME_ZONE) { $env:DISPLAY_TIME_ZONE = "Europe/Warsaw" }
}

function Test-Http([int]$port, [string]$path = "/") {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -TimeoutSec 4 -UseBasicParsing
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch { return $false }
}

function Wait-Http([int]$port, [string]$path, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  do { if (Test-Http $port $path) { return $true }; Start-Sleep -Seconds 3 } while ((Get-Date) -lt $deadline)
  return $false
}

# PIDs of the whole dev stack: the hidden daemon (app-lifecycle.ps1 -Daemon), the turbo
# "run dev" tree it spawns, plus anything listening on the web/api ports (stale leftovers).
function Get-StackPids {
  $all = Get-CimInstance Win32_Process
  $roots = @()
  foreach ($p in $all) {
    $cl = $p.CommandLine
    if (-not $cl -or $p.ProcessId -eq $PID) { continue }
    if ($cl -match 'app-lifecycle\.ps1.*-Daemon' -or ($cl -match 'turbo' -and $cl -match 'run' -and $cl -match 'dev')) {
      $roots += $p.ProcessId
    }
  }
  foreach ($port in @($webPort, $apiPort)) {
    foreach ($c in (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
      if ($c.OwningProcess -ne $PID -and $c.OwningProcess -notin $roots) { $roots += $c.OwningProcess }
    }
  }
  if (-not $roots.Count) { return @() }
  $result = New-Object System.Collections.Generic.List[int]
  $front = @($roots)
  while ($front.Count) {
    $next = @()
    foreach ($parent in $front) {
      foreach ($child in ($all | Where-Object { $_.ParentProcessId -eq $parent })) {
        if ($child.ProcessId -ne $PID -and $child.ProcessId -notin $result) {
          $result.Add($child.ProcessId)
          $next += $child.ProcessId
        }
      }
    }
    $front = $next
  }
  return @($roots) + $result.ToArray()
}

function Stop-Stack {
  $pids = Get-StackPids
  if (-not $pids.Count) { Write-Host "Стек не запущен — останавливать нечего."; return }
  Write-Host "Останавливаю процессы стека ($($pids.Count))..."
  foreach ($p in ($pids | Sort-Object -Descending)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $left = Get-NetTCPConnection -LocalPort $webPort, $apiPort -State Listen -ErrorAction SilentlyContinue
  if ($left) { Write-Host "Порты ещё заняты: $(($left | ForEach-Object LocalPort) -join ', ') — проверьте вручную." }
  else { Write-Host "Стек остановлен, порты $webPort/$apiPort свободны." }
}

if ($Daemon) {
  Load-Env
  Write-Host "[$(Get-Date -Format o)] stack daemon starting" *>> $log
  corepack pnpm exec turbo run dev --env-mode=loose *>> $log
  exit $LASTEXITCODE
}

if ($Action -eq "Stop") { Stop-Stack; exit 0 }

if ($Action -eq "Status") {
  $web = Test-Http $webPort "/"; $api = Test-Http $apiPort "/fixtures/quota"
  Write-Host "web(:$webPort)=$(if ($web) { 'up' } else { 'down' }) api(:$apiPort)=$(if ($api) { 'up' } else { 'down' })"
  exit 0
}

# ---- Start ----
Load-Env
if ((Test-Http $webPort "/") -and (Test-Http $apiPort "/fixtures/quota")) {
  Write-Host "Стек уже запущен — открываю http://127.0.0.1:$webPort"
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$webPort" }
  exit 0
}
$stale = Get-NetTCPConnection -LocalPort $webPort, $apiPort -State Listen -ErrorAction SilentlyContinue
if ($stale) {
  Write-Host "Порты заняты зависшими процессами — убираю..."
  foreach ($c in $stale) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

Write-Host "1/4 Docker: PostgreSQL + Redis..."
docker compose -f infra\docker-compose.yml --env-file .env up -d | Out-Null
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 2
  docker compose -f infra\docker-compose.yml exec -T postgres pg_isready -U football_prediction | Out-Null
  $ready = $LASTEXITCODE -eq 0
} until ($ready -or (Get-Date) -gt $deadline)
if (-not $ready) { throw "PostgreSQL не поднялся за 60 с" }

Write-Host "2/4 Миграции и каталог лиг (идемпотентно)..."
corepack pnpm --filter @bet-stats/database exec prisma migrate deploy | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Миграции завершились с ошибкой (код $LASTEXITCODE)" }
node scripts\seed-configured-leagues.mjs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Сид каталога лиг завершился с ошибкой (код $LASTEXITCODE)" }

Write-Host "3/4 Сборка проекта (кэш Turbo — повторные запуски быстрые)..."
corepack pnpm build | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Сборка проекта завершилась с ошибкой (код $LASTEXITCODE)" }

Write-Host "4/4 Запуск web (:$webPort), API (:$apiPort) и воркера (фоном, лог: $log)..."
Start-Process -FilePath "pwsh" -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Daemon"

Write-Host "Жду готовности web и API (до 150 с)..."
$webOk = Wait-Http $webPort "/" 150
$apiOk = Wait-Http $apiPort "/fixtures/quota" 150
if (-not ($webOk -and $apiOk)) { throw "Стек не поднялся за отведённое время. Лог: $log" }
Write-Host "Готово: http://127.0.0.1:$webPort"
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$webPort" }
