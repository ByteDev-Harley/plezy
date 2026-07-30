[CmdletBinding()]
param(
  [string]$CertificateProfile = "",
  [string]$TizenCli = "tizen"
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$project = Join-Path $workspace "samsung-tizen"
$stageRoot = Join-Path $workspace ".tv-build\samsung-tizen"
$stageProject = Join-Path $stageRoot "PlezyTV"
$dist = Join-Path $workspace "dist\samsung-tizen"

function Assert-WorkspaceChild([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $rootWithSeparator = $workspace.TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the workspace: $full"
  }
}

Assert-WorkspaceChild $stageRoot
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageProject, $dist | Out-Null

Push-Location $project
try {
  & node --check js/profile-store.js
  if ($LASTEXITCODE -ne 0) { throw "profile-store.js syntax validation failed." }
  & node --check js/api.js
  if ($LASTEXITCODE -ne 0) { throw "api.js syntax validation failed." }
  & node --check js/navigation.js
  if ($LASTEXITCODE -ne 0) { throw "navigation.js syntax validation failed." }
  & node --check js/app.js
  if ($LASTEXITCODE -ne 0) { throw "app.js syntax validation failed." }
  & node tools/validate-package.js
  if ($LASTEXITCODE -ne 0) { throw "Samsung package validation failed." }
  & node --test tests/*.test.js
  if ($LASTEXITCODE -ne 0) { throw "Samsung API tests failed." }
} finally {
  Pop-Location
}

Copy-Item -LiteralPath (Join-Path $project "config.xml") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $project "index.html") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $project "icon.png") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $project "css") -Destination $stageProject -Recurse
Copy-Item -LiteralPath (Join-Path $project "js") -Destination $stageProject -Recurse
Copy-Item -LiteralPath (Join-Path $project "tests") -Destination $stageProject -Recurse
Copy-Item -LiteralPath (Join-Path $project "tools") -Destination $stageProject -Recurse
Copy-Item -LiteralPath (Join-Path $project "README.md") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $project "package.json") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $project "tizen_web_project.yaml") -Destination $stageProject
Copy-Item -LiteralPath (Join-Path $workspace "LICENSE") -Destination (Join-Path $stageProject "LICENSE.txt")

$sourceArchive = Join-Path $dist "plezy-samsung-tizen-source.zip"
if (Test-Path -LiteralPath $sourceArchive) { Remove-Item -LiteralPath $sourceArchive -Force }
Compress-Archive -Path (Join-Path $stageProject "*") -DestinationPath $sourceArchive -CompressionLevel Optimal

if ($CertificateProfile) {
  $tizenCommand = Get-Command $TizenCli -ErrorAction SilentlyContinue
  if (-not $tizenCommand) {
    throw "Tizen CLI was not found. Install Tizen Studio, Web CLI, TV Extensions, and Samsung Certificate Extension."
  }
  & $tizenCommand.Source build-web -- $stageProject
  if ($LASTEXITCODE -ne 0) { throw "Tizen web build failed." }
  $buildResult = Join-Path $stageProject ".buildResult"
  & $tizenCommand.Source package -t wgt -s $CertificateProfile -- $buildResult
  if ($LASTEXITCODE -ne 0) { throw "Signed Tizen WGT packaging failed." }
  $wgt = Get-ChildItem -LiteralPath $buildResult -Filter "*.wgt" | Select-Object -First 1
  if (-not $wgt) { throw "Tizen CLI did not produce a WGT package." }
  Copy-Item -LiteralPath $wgt.FullName -Destination (Join-Path $dist "plezy-samsung-tizen.wgt") -Force
} else {
  Write-Warning "No certificate profile supplied. Source archive created; a WGT cannot be installed until it is signed with your Samsung certificate."
}

$artifacts = Get-ChildItem -LiteralPath $dist -File
$checksums = $artifacts | Where-Object Name -ne "SHA256SUMS.txt" | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  "$hash  $($_.Name)"
}
Set-Content -LiteralPath (Join-Path $dist "SHA256SUMS.txt") -Value $checksums -Encoding utf8

Write-Output "Samsung Tizen artifacts:"
Get-ChildItem -LiteralPath $dist -File | Select-Object FullName, Length
