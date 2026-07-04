# 同梱 uv.exe を resources に配置
param(
  [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$extRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $extRoot -Parent
$destDir = Join-Path $extRoot "resources\tools\windows-x64"
$dest = Join-Path $destDir "uv.exe"

if (-not $Source) {
  $candidates = @(
    (Join-Path $repoRoot "nora-backend\data\tools\uv\0.6.0\uv.exe"),
    (Join-Path $repoRoot "nora-backend\app\bootstrap_data\tools\uv\0.6.0\uv.exe"),
    "$env:LOCALAPPDATA\NoraOps\runtime\tools\uv\uv.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $Source = $c; break }
  }
}

if (-not $Source -or -not (Test-Path $Source)) {
  Write-Error "uv.exe not found. Pass -Source or install tools via NoraOps setup."
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item -Force $Source $dest
Write-Host "Copied: $Source -> $dest"
