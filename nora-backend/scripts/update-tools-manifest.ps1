# manifest.json の sha256 / size を、配置済み実ファイルから自動で書き込む
#
# 使い方（nora-backend フォルダで）:
#   powershell -ExecutionPolicy Bypass -File .\scripts\update-tools-manifest.ps1 `
#     -BaseUrl "http://127.0.0.1:8000" `
#     -UvVersion "0.6.0" `
#     -GitVersion "2.54.0"

param(
  [string]$BaseUrl = "http://127.0.0.1:8000",
  [string]$UvVersion = "0.6.0",
  [string]$GitVersion = "2.54.0"
)

$ErrorActionPreference = "Stop"
$serverRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $serverRoot "data\tools\windows-x64\manifest.json"
$uvFile = Join-Path $serverRoot "data\tools\uv\$UvVersion\uv.exe"
$gitFile = Join-Path $serverRoot "data\tools\git\$GitVersion\PortableGit-$GitVersion-64-bit.7z.exe"

function Get-FileDigest($path) {
  if (-not (Test-Path $path)) {
    throw "File not found: $path"
  }
  $hash = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item -Path $path).Length
  return @{ sha256 = $hash; size = $size }
}

$uv = Get-FileDigest $uvFile
$git = Get-FileDigest $gitFile
$base = $BaseUrl.TrimEnd("/")

$json = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$json.uv.version = $UvVersion
$json.uv.url = "$base/api/tools/files/uv/$UvVersion/uv.exe"
$json.uv.sha256 = $uv.sha256
$json.uv.size = $uv.size
$json.portableGit.version = $GitVersion
$json.portableGit.url = "$base/api/tools/files/git/$GitVersion/PortableGit-$GitVersion-64-bit.7z.exe"
$json.portableGit.sha256 = $git.sha256
$json.portableGit.size = $git.size
$json.generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($manifestPath, ($json | ConvertTo-Json -Depth 10), $utf8NoBom)

Write-Host "Updated: $manifestPath"
Write-Host "uv  sha256=$($uv.sha256)  size=$($uv.size)"
Write-Host "git sha256=$($git.sha256)  size=$($git.size)"
