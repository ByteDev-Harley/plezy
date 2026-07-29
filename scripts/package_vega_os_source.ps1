[CmdletBinding()]
param(
    [string]$Version = '2.10.1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'validate_vega_os.ps1')

$stageRoot = Join-Path $root '.tv-build/vega-os-source'
$stage = Join-Path $stageRoot 'plezy-vega-os-source'
$destination = Join-Path $root ("dist/vega-os/plezy-vega-os-source-{0}.zip" -f $Version)

if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStageRoot = [IO.Path]::GetFullPath($stageRoot)
    $resolvedBuildRoot = [IO.Path]::GetFullPath((Join-Path $root '.tv-build'))
    if (-not $resolvedStageRoot.StartsWith($resolvedBuildRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected path: $resolvedStageRoot"
    }
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'vega-os') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root 'samsung-tizen') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $stage 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $root 'TV_INSTALL.md') -Destination $stage

$generatedVega = Join-Path $stage 'vega-os/generated'
if (Test-Path -LiteralPath $generatedVega) { Remove-Item -LiteralPath $generatedVega -Recurse -Force }
Get-ChildItem -LiteralPath (Join-Path $stage 'vega-os') -Recurse -File -Filter '*.vpkg' | Remove-Item -Force
Get-ChildItem -LiteralPath (Join-Path $stage 'samsung-tizen') -Recurse -Directory -Filter '.buildResult' | Remove-Item -Recurse -Force
$debugOutput = Join-Path $stage 'samsung-tizen/Debug'
if (Test-Path -LiteralPath $debugOutput) { Remove-Item -LiteralPath $debugOutput -Recurse -Force }
Get-ChildItem -LiteralPath (Join-Path $stage 'samsung-tizen') -Recurse -File -Filter '*.wgt' | Remove-Item -Force

New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $destination -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = Join-Path (Split-Path -Parent $destination) 'SHA256SUMS-source.txt'
Set-Content -LiteralPath $checksumPath -Value ("{0}  {1}" -f $hash, (Split-Path -Leaf $destination)) -Encoding ascii
$provenancePath = Join-Path (Split-Path -Parent $destination) 'PROVENANCE.txt'
$provenance = @"
Artifact: $(Split-Path -Leaf $destination)
Source: local PlezyTV workspace, including vega-os/ and the shared samsung-tizen/ TV web client
Package ID: com.edde746.plezy.vega
Target: Amazon Fire TV devices running Vega OS (armv7 release VPKG)
Status: validated portable source; not an installable VPKG
Build requirement: native macOS 10.15+ or Ubuntu 20.04+ with Amazon Vega SDK; Windows and WSL are unsupported by Amazon
Build command: PLEZY_VEGA_BUILD_NUMBER=2 ./vega-os/build.sh
SHA-256: $hash
"@
Set-Content -LiteralPath $provenancePath -Value $provenance -Encoding utf8
Write-Host "Created $destination"
Write-Host "SHA-256 $hash"
