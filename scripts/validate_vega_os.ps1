[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
    'vega-os/overlay/src/App.tsx',
    'vega-os/tools/prepare-project.mjs',
    'vega-os/build.sh',
    'vega-os/install.sh',
    'vega-os/README.md',
    'samsung-tizen/index.html',
    'samsung-tizen/js/api.js',
    'samsung-tizen/js/app.js'
)

foreach ($relativePath in $requiredFiles) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing Vega source file: $relativePath"
    }
}

$app = Get-Content -LiteralPath (Join-Path $root 'vega-os/overlay/src/App.tsx') -Raw
$prepare = Get-Content -LiteralPath (Join-Path $root 'vega-os/tools/prepare-project.mjs') -Raw
$build = Get-Content -LiteralPath (Join-Path $root 'vega-os/build.sh') -Raw
$webApp = Get-Content -LiteralPath (Join-Path $root 'samsung-tizen/js/app.js') -Raw

$checks = [ordered]@{
    'local packaged WebView entry point' = $app.Contains('file:///pkg/assets/index.html')
    'TV preferred focus' = $app.Contains('hasTVPreferredFocus={true}')
    'local asset access' = $app.Contains('allowFileAccess={true}')
    'remote Back delivery' = $app.Contains('allowSystemKeyEvents={true}')
    'Vega exit bridge' = $webApp.Contains('window.ReactNativeWebView.postMessage')
    'non-Amazon package id' = $build.Contains('com.edde746.plezy.vega')
    'official hello-world template' = $build.Contains('--template hello-world')
    'physical Fire TV armv7 target' = $build.Contains('--target armv7')
    'release VPKG build' = $build.Contains('build-vega') -and $build.Contains('--build-type Release')
    'WebView dependency pin' = $build.Contains('@amazon-devices/webview@~3.3.0')
    'main app category guard' = $prepare.Contains('com.amazon.category.main')
    'media server manifest service' = $prepare.Contains('com.amazon.media.server')
    'media buffer manifest service' = $prepare.Contains('com.amazon.mediabuffer.service')
    'audio control manifest service' = $prepare.Contains('com.amazon.audio.control')
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
foreach ($check in $checks.GetEnumerator()) {
    $status = if ($check.Value) { 'PASS' } else { 'FAIL' }
    Write-Host ("[{0}] {1}" -f $status, $check.Key)
}
if ($failed.Count -gt 0) {
    throw "$($failed.Count) Vega validation check(s) failed."
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node --check (Join-Path $root 'vega-os/tools/prepare-project.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Node syntax validation failed.' }
}

Write-Host 'Vega OS source validation passed.'
