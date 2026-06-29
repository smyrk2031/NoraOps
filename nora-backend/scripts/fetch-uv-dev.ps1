# 髢狗匱逕ｨ: uv.exe 繧・GitHub 縺九ｉ蜿門ｾ励＠ data/tools 縺ｫ驟咲ｽｮ縺・manifest 縺ｮ sha256 繧呈峩譁ｰ縺吶ｋ
# 菴ｿ縺・婿・・owerShell・・
#   cd nora-backend  # ?????????
#   powershell -ExecutionPolicy Bypass -File .\scripts\fetch-uv-dev.ps1

$ErrorActionPreference = "Stop"
$version = "0.6.0"
$serverRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$destDir = Join-Path $serverRoot "data\tools\uv\$version"
$destExe = Join-Path $destDir "uv.exe"
$manifestPath = Join-Path $serverRoot "data\tools\windows-x64\manifest.json"
$zipUrl = "https://github.com/astral-sh/uv/releases/download/$version/uv-x86_64-pc-windows-msvc.zip"
$tmpZip = Join-Path $env:TEMP "uv-$version-win.zip"
$tmpExtract = Join-Path $env:TEMP "uv-$version-extract"

Write-Host "Downloading $zipUrl ..."
Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing

if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force

$srcExe = Get-ChildItem -Path $tmpExtract -Recurse -Filter "uv.exe" | Select-Object -First 1
if (-not $srcExe) { throw "uv.exe not found in zip" }

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item $srcExe.FullName $destExe -Force

$hash = (Get-FileHash -Path $destExe -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $destExe).Length

Write-Host "Placed: $destExe"
Write-Host "SHA256: $hash"
Write-Host "Size:   $size"

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.uv.version = $version
$manifest.uv.url = "http://127.0.0.1:8000/api/tools/files/uv/$version/uv.exe"
$manifest.uv.sha256 = $hash
$manifest.uv.size = $size
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), $utf8NoBom)

Write-Host "Updated manifest: $manifestPath"
Write-Host "Test: curl -I http://127.0.0.1:8000/api/tools/files/uv/$version/uv.exe"
