[CmdletBinding()]
param(
  [Alias("q")]
  [switch]$Quiet,
  [Alias("o")]
  [switch]$Overwrite,
  [Alias("d")]
  [string]$Destination,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

$archivePath = ""
$patterns = [System.Collections.Generic.List[string]]::new()
for ($index = 0; $index -lt $Arguments.Count; $index++) {
  $argument = $Arguments[$index]
  if (-not $archivePath) {
    $archivePath = $argument
  } else {
    $patterns.Add($argument.Replace('\', '/'))
  }
}

if (-not $archivePath) { throw "unzip: archive path is required" }
if (-not $Destination) { $Destination = (Get-Location).Path }
$archive = (Resolve-Path -LiteralPath $archivePath).Path
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$destination = (Resolve-Path -LiteralPath $Destination).Path
$destinationPrefix = $destination.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($entry in $zip.Entries) {
    $entryName = $entry.FullName.Replace('\', '/')
    $selected = $patterns.Count -eq 0
    foreach ($pattern in $patterns) {
      if ($entryName -like $pattern) { $selected = $true; break }
    }
    if (-not $selected) { continue }

    $target = [System.IO.Path]::GetFullPath((Join-Path $destination $entryName))
    if (-not $target.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "unzip: unsafe archive entry: $entryName"
    }
    if ($entryName.EndsWith('/')) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      continue
    }
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally {
  $zip.Dispose()
}
