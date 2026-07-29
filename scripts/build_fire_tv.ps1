[CmdletBinding()]
param(
  [string]$AndroidSdk = "",
  [switch]$SkipPubGet
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $AndroidSdk) {
  $AndroidSdk = Join-Path $workspace ".android-sdk"
}
$sdk = (Resolve-Path -LiteralPath $AndroidSdk).Path
$dist = Join-Path $workspace "dist\fire-tv"
$manifestPath = Join-Path $workspace "android\app\src\main\AndroidManifest.xml"
$detectionPath = Join-Path $workspace "android\app\src\main\kotlin\com\edde746\plezy\TvDetection.kt"
$gradlePath = Join-Path $workspace "android\app\build.gradle.kts"
$apkAnalyzer = Join-Path $sdk "cmdline-tools\latest\bin\apkanalyzer.bat"
if (-not (Test-Path -LiteralPath $apkAnalyzer -PathType Leaf)) {
  $apkAnalyzer = Join-Path $workspace ".android-sdk-cache\tools\cmdline-tools\bin\apkanalyzer.bat"
}
$apkSigner = Join-Path $sdk "build-tools\36.1.0\apksigner.bat"
$adb = Join-Path $sdk "platform-tools\adb.exe"
$windowsTools = Join-Path $workspace "scripts\windows-tools"

function Get-ApkAnalyzerScalar {
  param(
    [string]$Analyzer,
    [string]$Verb,
    [string]$Apk
  )
  $output = @(& $Analyzer manifest $Verb $Apk)
  if ($LASTEXITCODE -ne 0) { throw "apkanalyzer manifest $Verb failed." }
  $values = @($output | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' })
  if ($values.Count -eq 0) { throw "apkanalyzer manifest $Verb returned no numeric value." }
  return $values[-1]
}

function Remove-GeneratedNativePackaging {
  $buildRoot = Join-Path $workspace "build"
  if (-not (Test-Path -LiteralPath $buildRoot -PathType Container)) { return }
  $resolvedBuildRoot = (Resolve-Path -LiteralPath $buildRoot).Path.TrimEnd('\') + '\'
  $relativeTargets = @(
    "app\intermediates\merged_native_libs\release",
    "app\intermediates\stripped_native_libs\release",
    "libass\intermediates\merged_native_libs\release",
    "libass\intermediates\stripped_native_libs\release",
    "libass\intermediates\library_and_local_jars_jni\release",
    "libass\intermediates\library_jni\release"
  )
  foreach ($relativeTarget in $relativeTargets) {
    $target = Join-Path $buildRoot $relativeTarget
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    if (-not ($resolvedTarget + '\').StartsWith($resolvedBuildRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove generated path outside the build directory: $resolvedTarget"
    }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  }
}

foreach ($tool in @($apkAnalyzer, $apkSigner, $adb)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "Required Android SDK tool is missing: $tool"
  }
}
if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw "Flutter is not on PATH. Plezy requires Flutter 3.44.0 or newer."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw
$detection = Get-Content -LiteralPath $detectionPath -Raw
$gradle = Get-Content -LiteralPath $gradlePath -Raw
foreach ($marker in @(
  'android.intent.category.LEANBACK_LAUNCHER',
  'android:banner="@drawable/tv_banner"',
  'android.hardware.touchscreen" android:required="false"'
)) {
  if (-not $manifest.Contains($marker)) {
    throw "Fire TV manifest validation failed; missing: $marker"
  }
}
if (-not $detection.Contains('amazon.hardware.fire_tv')) {
  throw "Fire TV hardware detection is missing from TvDetection.kt."
}
if (-not $gradle.Contains('System.getenv("AMAZON")') -or -not $gradle.Contains('versionCode = (flutter.versionCode ?: 0) + 3000')) {
  throw "The Amazon APK variant/version-code configuration is missing."
}

$pubspec = Get-Content -LiteralPath (Join-Path $workspace "pubspec.yaml") -Raw
$versionMatch = [regex]::Match($pubspec, '(?m)^version:\s*([^+\r\n]+)\+(\d+)\s*$')
if (-not $versionMatch.Success) { throw "Could not read the Plezy version from pubspec.yaml." }
$versionName = $versionMatch.Groups[1].Value.Trim()
$expectedVersionCode = [int]$versionMatch.Groups[2].Value + 3000
$commit = (& git -C $workspace rev-parse --short=12 HEAD).Trim()
if (-not $commit) { $commit = "unknown" }

New-Item -ItemType Directory -Path $dist -Force | Out-Null

$oldAmazon = [Environment]::GetEnvironmentVariable("AMAZON", "Process")
$oldSigning = [Environment]::GetEnvironmentVariable("PLEZY_TV_SIDELOAD_SIGNING", "Process")
$oldAndroidHome = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "Process")
$oldAndroidSdkRoot = [Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT", "Process")
$oldPath = [Environment]::GetEnvironmentVariable("PATH", "Process")
$oldGradleOpts = [Environment]::GetEnvironmentVariable("GRADLE_OPTS", "Process")

Push-Location $workspace
try {
  $env:AMAZON = "1"
  $env:PLEZY_TV_SIDELOAD_SIGNING = "1"
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
  $env:PATH = $windowsTools + ";" + $oldPath
  $env:GRADLE_OPTS = '-Dorg.gradle.jvmargs="-Xmx2G -XX:MaxMetaspaceSize=768m -XX:ReservedCodeCacheSize=256m -XX:+HeapDumpOnOutOfMemoryError -Dkotlin.daemon.jvm.options=-Xmx768m,-XX:MaxMetaspaceSize=384m,-XX:ReservedCodeCacheSize=128m" -Dorg.gradle.workers.max=1 -Dorg.gradle.parallel=false'

  if (-not $SkipPubGet) {
    & flutter pub get --enforce-lockfile --no-example
    if ($LASTEXITCODE -ne 0) { throw "flutter pub get failed." }
  }

  & (Join-Path $workspace "android\gradlew.bat") --stop | Out-Null
  # Gradle can retain native-library merge outputs when switching between the
  # generic Android and ARM-only Amazon variants. Remove only those generated
  # release packaging directories; downloads and compiled native caches remain.
  Remove-GeneratedNativePackaging
  $buildArguments = @(
    "build", "apk", "--release",
    "--target-platform", "android-arm,android-arm64",
    "--dart-define=GIT_COMMIT=$commit",
    "--dart-define=SENTRY_ENVIRONMENT=amazon-sideload",
    "--dart-define=SENTRY_DIST=amazon-sideload"
  )
  if ($SkipPubGet) { $buildArguments += "--no-pub" }
  & flutter @buildArguments
  if ($LASTEXITCODE -ne 0) { throw "Flutter Fire TV APK build failed." }

  $builtApk = Join-Path $workspace "build\app\outputs\flutter-apk\app-release.apk"
  if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf)) {
    throw "Expected Fire TV APK was not produced: $builtApk"
  }

  $minSdk = Get-ApkAnalyzerScalar -Analyzer $apkAnalyzer -Verb "min-sdk" -Apk $builtApk
  $targetSdk = Get-ApkAnalyzerScalar -Analyzer $apkAnalyzer -Verb "target-sdk" -Apk $builtApk
  $versionCode = Get-ApkAnalyzerScalar -Analyzer $apkAnalyzer -Verb "version-code" -Apk $builtApk
  if ($minSdk -ne "25") { throw "Unexpected Fire TV minSdk: $minSdk (expected 25)." }
  if ($versionCode -ne $expectedVersionCode.ToString()) {
    throw "Unexpected Amazon version code: $versionCode (expected $expectedVersionCode)."
  }

  $mergedManifest = (& $apkAnalyzer manifest print $builtApk) -join "`n"
  foreach ($marker in @('com.edde746.plezy', 'android.intent.category.LEANBACK_LAUNCHER', 'android.software.leanback')) {
    if (-not $mergedManifest.Contains($marker)) {
      throw "Built Fire TV APK manifest is missing: $marker"
    }
  }

  $apkFiles = (& $apkAnalyzer files list $builtApk) -join "`n"
  foreach ($abi in @("arm64-v8a", "armeabi-v7a")) {
    if (-not $apkFiles.Contains("lib/$abi/")) { throw "Built Fire TV APK is missing the $abi ABI." }
  }
  foreach ($unsupportedAbi in @("x86", "x86_64")) {
    if ($apkFiles.Contains("lib/$unsupportedAbi/")) { throw "Built Fire TV APK unexpectedly contains $unsupportedAbi." }
  }

  & $apkSigner verify --verbose --print-certs $builtApk
  if ($LASTEXITCODE -ne 0) { throw "Fire TV APK signature verification failed." }

  $destination = Join-Path $dist "plezy-fire-tv-universal-$versionName-release.apk"
  Copy-Item -LiteralPath $builtApk -Destination $destination -Force
  $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $([System.IO.Path]::GetFileName($destination))" | Set-Content -LiteralPath (Join-Path $dist "SHA256SUMS.txt") -Encoding ascii

  $provenance = @(
    "Plezy Fire TV sideload package"
    "Version: $versionName"
    "Amazon version code: $versionCode"
    "Source commit: $commit"
    "Minimum SDK: $minSdk (Fire OS 6 / Android 7.1)"
    "Target SDK: $targetSdk"
    "ABIs: arm64-v8a, armeabi-v7a"
    "Artifact: $([System.IO.Path]::GetFileName($destination))"
    "SHA-256: $hash"
    ""
    "This local release build uses the Android debug certificate for private sideloading unless android/key.properties supplies a publisher keystore."
  )
  $provenance | Set-Content -LiteralPath (Join-Path $dist "PROVENANCE.txt") -Encoding utf8

  Write-Host "Built and verified Fire TV APK:"
  Write-Host "  $destination"
  Write-Host "  SHA-256: $hash"
  Write-Host "  SDK: min $minSdk, target $targetSdk; version code $versionCode"
} finally {
  [Environment]::SetEnvironmentVariable("AMAZON", $oldAmazon, "Process")
  [Environment]::SetEnvironmentVariable("PLEZY_TV_SIDELOAD_SIGNING", $oldSigning, "Process")
  [Environment]::SetEnvironmentVariable("ANDROID_HOME", $oldAndroidHome, "Process")
  [Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $oldAndroidSdkRoot, "Process")
  [Environment]::SetEnvironmentVariable("PATH", $oldPath, "Process")
  [Environment]::SetEnvironmentVariable("GRADLE_OPTS", $oldGradleOpts, "Process")
  Pop-Location
}
