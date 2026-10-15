# Starts the full local stack with REAL data: Postgres + Redis (docker), migrations,
# league catalogue seeding, then API + web + data-sync worker with the provider tokens
# from .env. Use this instead of plain `pnpm dev` when you want live fixtures.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev-full.ps1
#
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. Load .env into this process (the API/worker read process.env only).
if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process")
    }
  }
}
if (-not $env:DATABASE_URL) { throw "DATABASE_URL is missing from .env" }
if (-not $env:REDIS_URL) { $env:REDIS_URL = "redis://127.0.0.1:6379" }
$env:DATA_PROVIDER_MODE = "live"
$env:FIXTURES_AUTO_SYNC = "true"
$env:DISPLAY_TIME_ZONE = if ($env:DISPLAY_TIME_ZONE) { $env:DISPLAY_TIME_ZONE } else { "Europe/Warsaw" }

# 2. Infrastructure.
docker compose -f infra\docker-compose.yml --env-file .env up -d
Write-Host "Waiting for Postgres..."
$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 2
  docker compose -f infra\docker-compose.yml exec -T postgres pg_isready -U football_prediction | Out-Null
  $ready = $LASTEXITCODE -eq 0
} until ($ready -or (Get-Date) -gt $deadline)
if (-not $ready) { throw "Postgres did not become ready in time" }

# 3. Schema + league catalogue (idempotent).
corepack pnpm --filter @bet-stats/database exec prisma migrate deploy
node scripts\seed-configured-leagues.mjs

# 4. Build workspace packages (API/worker run from dist), then start everything.
corepack pnpm build
Write-Host "Starting API (:3001), web (:3000) and the data-sync worker..."
corepack pnpm dev
