param(
  [string]$Container = "voxlink-postgres",
  [string]$Database = "voxlink_voice",
  [string]$User = "voxlink",
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI is required for this backup script."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fileName = "$Database-$timestamp.dump"
$containerPath = "/tmp/$fileName"
$resolvedOutputDirectory = Resolve-Path -LiteralPath $OutputDirectory -ErrorAction SilentlyContinue

if (-not $resolvedOutputDirectory) {
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
  $resolvedOutputDirectory = Resolve-Path -LiteralPath $OutputDirectory
}

$hostPath = Join-Path $resolvedOutputDirectory $fileName

docker exec $Container pg_dump -U $User -d $Database --format=custom --file=$containerPath
docker cp "${Container}:${containerPath}" $hostPath
docker exec $Container rm -f $containerPath

Write-Output "Postgres backup written to $hostPath"
