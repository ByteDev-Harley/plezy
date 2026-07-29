[CmdletBinding()]
param(
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release",
  [string]$AndroidSdk = "",
  [switch]$Universal,
  [switch]$SkipPubGet
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dist = Join-Path $workspace "dist\android-tv"
$manifest = Join-Path $workspace "android\app\src\main\AndroidManifest.xml"

function Assert-AndroidTvManifest {
  $content = Get-Content -LiteralPath $manifest -Raw
  $required = @(
    'android.software.leanback',
    'android.hardware.touchscreen" android:required="false"',
    'android.intent.category.LEANBACK_LAUNCHER',
    'android:banner="@drawable/tv_banner"'
  )
  foreach ($value in $required) {
    if (-not $content.Contains($value)) {
      throw "Android TV manifest validation failed; missing: $value"
    }
  }
}

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw "Flutter is not on PATH. Plezy requires Flutter 3.44.0 or newer."
}

if ($AndroidSdk) {
  $resolvedSdk = (Resolve-Path -LiteralPath $AndroidSdk).Path
  $env:ANDROID_HOME = $resolvedSdk
  $env:ANDROID_SDK_ROOT = $resolvedSdk
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw "Android SDK not configured. Pass -AndroidSdk or set ANDROID_HOME."
}

Assert-AndroidTvManifest
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Push-Location $workspace
try {
  if (-not $SkipPubGet) {
    & flutter pub get
    if ($LASTEXITCODE -ne 0) { throw "flutter pub get failed." }
  }

  $buildArguments = @("build", "apk")
  if ($Configuration -eq "Release") {
    $buildArguments += "--release"
    $env:PLEZY_TV_SIDELOAD_SIGNING = "1"
  } else {
    $buildArguments += "--debug"
  }
  if (-not $Universal) { $buildArguments += "--split-per-abi" }

  & flutter @buildArguments
  if ($LASTEXITCODE -ne 0) { throw "Flutter APK build failed." }

  $suffix = $Configuration.ToLowerInvariant()
  $outputRoot = Join-Path $workspace "build\app\outputs\flutter-apk"
  $artifacts = if ($Universal) {
    @(Join-Path $outputRoot "app-$suffix.apk")
  } else {
    @(
      (Join-Path $outputRoot "app-arm64-v8a-$suffix.apk"),
      (Join-Path $outputRoot "app-armeabi-v7a-$suffix.apk")
    )
  }

  foreach ($artifact in $artifacts) {
    if (-not (Test-Path -LiteralPath $artifact)) { throw "Expected APK was not produced: $artifact" }
    $abi = if ($Universal) { "universal" } elseif ($artifact.Contains("arm64-v8a")) { "arm64-v8a" } else { "armeabi-v7a" }
    $destination = Join-Path $dist "plezy-android-tv-$abi-$suffix.apk"
    Copy-Item -LiteralPath $artifact -Destination $destination -Force
  }
  $checksums = Get-ChildItem -LiteralPath $dist -Filter "*.apk" | Sort-Object Name | ForEach-Object {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
  }
  Set-Content -LiteralPath (Join-Path $dist "SHA256SUMS.txt") -Value $checksums -Encoding utf8

  Write-Output "Android TV APKs:"
  Get-ChildItem -LiteralPath $dist -Filter "*.apk" | Select-Object FullName, Length
} finally {
  Remove-Item Env:\PLEZY_TV_SIDELOAD_SIGNING -ErrorAction SilentlyContinue
  Pop-Location
}
