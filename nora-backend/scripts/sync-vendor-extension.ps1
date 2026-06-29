# 拡張ソースを nora-backend/vendor/vscode-extension へ同期（配備同梱用）
#
# 使い方（nora-backend フォルダで）:
#   powershell -ExecutionPolicy Bypass -File .\scripts\sync-vendor-extension.ps1
#
# オプション:
#   -ExtensionRoot "..\vscode-extension"  … ソース（既定: 兄弟ディレクトリ）
#   -VendorRoot ".\vendor\vscode-extension" … 出力先

param(
  [string]$ExtensionRoot = "",
  [string]$VendorRoot = ""
)

$ErrorActionPreference = "Stop"
$serverRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ExtensionRoot) {
  $ExtensionRoot = Join-Path (Split-Path $serverRoot -Parent) "vscode-extension"
}
if (-not $VendorRoot) {
  $VendorRoot = Join-Path $serverRoot "vendor\vscode-extension"
}

$src = Resolve-Path $ExtensionRoot
$dest = $VendorRoot
$cli = Join-Path $src "scripts\repo-audit-cli.js"
if (-not (Test-Path $cli)) {
  throw "Extension source invalid (repo-audit-cli.js missing): $src"
}

Write-Host "Sync extension -> vendor"
Write-Host "  from: $src"
Write-Host "  to:   $dest"

$excludeDirs = @("node_modules", ".git", ".vscode", "out", "dist", ".nora")
$excludeNames = @("*.vsix")

if (Test-Path $dest) {
  Remove-Item -Path $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null

Get-ChildItem -Path $src -Force | ForEach-Object {
  if ($excludeDirs -contains $_.Name) { return }
  Copy-Item -Path $_.FullName -Destination (Join-Path $dest $_.Name) -Recurse -Force
}

Write-Host "Done. Set NORAOPS_EXTENSION_DIR=./vendor/vscode-extension in .env"
