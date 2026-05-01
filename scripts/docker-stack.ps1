# Full stack: build images, start containers, apply Prisma schema to Postgres.
# Requires Docker Desktop (Linux engine) running.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[docker-stack] Working directory: $Root"

$PrevEa = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  $ErrorActionPreference = $PrevEa
  Write-Error "docker compose not found."
  exit 1
}
docker info *> $null
$dockerOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $PrevEa
if (-not $dockerOk) {
  Write-Error "Docker daemon is not running. Start Docker Desktop, wait until it is idle, then run: pnpm docker:stack"
  exit 1
}

$buildArgs = @("compose", "up", "-d", "--build")
if ($args -contains "--no-build") {
  $buildArgs = @("compose", "up", "-d")
}

Write-Host "[docker-stack] Starting stack: docker $($buildArgs -join ' ')"
& docker @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[docker-stack] prisma db push (gateway container)..."
docker compose run --rm --entrypoint "" gateway sh -c "pnpm --filter @crm/db exec prisma db push"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[docker-stack] Done. Status:"
docker compose ps
