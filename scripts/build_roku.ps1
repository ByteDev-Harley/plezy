[CmdletBinding()]
param(
    [string]$OutputDirectory = "",
    [switch]$SkipCompiler
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$rokuRoot = Join-Path $repoRoot "roku"
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "dist\roku"
}

function Assert-WorkspacePath {
    param([string]$Path)
    $workspace = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not ($resolved + '\').StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the workspace: $resolved"
    }
    return $resolved
}

$stagingDirectory = Assert-WorkspacePath (Join-Path $repoRoot ".tv-build\roku")
$resolvedOutput = Assert-WorkspacePath $OutputDirectory

foreach ($required in @(
    "manifest",
    "source\main.brs",
    "components\PlezyScene.xml",
    "components\PlezyScene.brs",
    "components\ApiTask.xml",
    "components\ApiTask.brs",
    "images\channel-icon_hd.png",
    "images\channel-icon_fhd.png",
    "images\splash-screen_hd.jpg",
    "images\splash-screen_fhd.jpg"
)) {
    $path = Join-Path $rokuRoot $required
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required Roku package file is missing: $path"
    }
}

& node (Join-Path $rokuRoot "tests\validate-package.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Roku package validation failed."
}

$bscCommand = Join-Path $rokuRoot "node_modules\.bin\bsc.cmd"
if (-not $SkipCompiler) {
    if (-not (Test-Path -LiteralPath $bscCommand -PathType Leaf)) {
        throw "BrighterScript is not installed. Run 'npm ci' in the roku directory, or pass -SkipCompiler only when CI has already compiled the source."
    }
    & $bscCommand --project (Join-Path $rokuRoot "bsconfig.json")
    if ($LASTEXITCODE -ne 0) {
        throw "BrighterScript compile validation failed."
    }
}

if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $rokuRoot "manifest") -Destination $stagingDirectory
foreach ($directory in @("source", "components", "images")) {
    Copy-Item -LiteralPath (Join-Path $rokuRoot $directory) -Destination $stagingDirectory -Recurse
}
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $stagingDirectory "LICENSE.txt")

$package = Get-Content -LiteralPath (Join-Path $rokuRoot "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$archiveName = "plezy-roku-$version.zip"
$archivePath = Join-Path $resolvedOutput $archiveName
$temporaryArchivePath = $archivePath + ".tmp"
if (Test-Path -LiteralPath $temporaryArchivePath) {
    Remove-Item -LiteralPath $temporaryArchivePath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($temporaryArchivePath, [System.IO.FileMode]::CreateNew)
$newArchive = [System.IO.Compression.ZipArchive]::new(
    $archiveStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
)
try {
    $stagingPrefix = $stagingDirectory.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $files = Get-ChildItem -LiteralPath $stagingDirectory -File -Recurse | Sort-Object FullName
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($stagingPrefix.Length).Replace('\', '/')
        $entry = $newArchive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $inputStream = [System.IO.File]::OpenRead($file.FullName)
        try {
            $inputStream.CopyTo($entryStream)
        }
        finally {
            $inputStream.Dispose()
            $entryStream.Dispose()
        }
    }
}
finally {
    $newArchive.Dispose()
    $archiveStream.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchivePath)
try {
    $rawEntries = @($archive.Entries | ForEach-Object { $_.FullName })
    if ($rawEntries | Where-Object { $_.Contains('\') }) {
        throw "The Roku ZIP is invalid: one or more entries use a Windows backslash."
    }
    $entries = @($rawEntries)
    if ($entries -notcontains "manifest") {
        throw "The Roku ZIP is invalid: manifest is not at the archive root."
    }
    if ($entries | Where-Object { $_ -match "^roku/" }) {
        throw "The Roku ZIP is invalid: it contains an extra roku/ root folder."
    }
    foreach ($requiredPrefix in @("source/", "components/", "images/")) {
        if (-not ($entries | Where-Object { $_.StartsWith($requiredPrefix) })) {
            throw "The Roku ZIP is invalid: no entries were found under $requiredPrefix"
        }
    }
}
finally {
    $archive.Dispose()
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
Move-Item -LiteralPath $temporaryArchivePath -Destination $archivePath

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $archiveName" | Set-Content -LiteralPath (Join-Path $resolvedOutput "SHA256SUMS.txt") -Encoding ascii

$sourceCommit = (& git -C $repoRoot rev-parse HEAD 2>$null)
if (-not $sourceCommit) {
    $sourceCommit = "unknown"
}
$provenance = @(
    "Plezy Roku developer package"
    "Version: $version"
    "Source commit: $sourceCommit"
    "Created: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
    "Artifact: $archiveName"
    "SHA-256: $hash"
    ""
    "This ZIP contains unencrypted SceneGraph/BrightScript source for developer-mode sideloading."
    "A Roku Streaming Store .pkg can only be encrypted and signed by a linked physical Roku device."
)
$provenance | Set-Content -LiteralPath (Join-Path $resolvedOutput "PROVENANCE.txt") -Encoding utf8

Write-Host "Built Roku developer package:"
Write-Host "  $archivePath"
Write-Host "  SHA-256: $hash"
