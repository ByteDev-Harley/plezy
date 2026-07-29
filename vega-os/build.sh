#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="${PLEZY_VEGA_PROJECT_DIR:-$SCRIPT_DIR/generated/PlezyVega}"
APP_VERSION="${PLEZY_VEGA_VERSION:-2.10.1}"
BUILD_NUMBER="${PLEZY_VEGA_BUILD_NUMBER:-2}"
PACKAGE_ID="com.edde746.plezy.vega"

case "$(uname -s)" in
  Darwin|Linux) ;;
  *)
    echo "Vega SDK builds require native macOS or Ubuntu. Windows and WSL are not supported by Amazon." >&2
    exit 2
    ;;
esac

for command_name in vega node npm npx; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 2
  fi
done

if [[ ! -f "$PROJECT_DIR/manifest.toml" ]]; then
  mkdir -p "$(dirname "$PROJECT_DIR")"
  vega project generate \
    --template hello-world \
    --name PlezyVega \
    --packageId "$PACKAGE_ID" \
    --outputDir "$PROJECT_DIR"
fi

node "$SCRIPT_DIR/tools/prepare-project.mjs" "$PROJECT_DIR"

cd "$PROJECT_DIR"
npm install
npm install --save '@amazon-devices/webview@~3.3.0'
vega exec vpt validate "$PROJECT_DIR/manifest.toml"
npx react-native build-vega \
  --build-type Release \
  --target armv7 \
  --build-version "$APP_VERSION" \
  --build-number "$BUILD_NUMBER"

VPKG_PATH="$(find "$PROJECT_DIR/build/armv7-release" -maxdepth 1 -type f -name '*.vpkg' -print -quit)"
if [[ -z "$VPKG_PATH" || ! -f "$VPKG_PATH" ]]; then
  echo "Build completed but no armv7 release VPKG was found." >&2
  exit 1
fi

vega exec vpt info "$VPKG_PATH" --json
mkdir -p "$REPO_ROOT/dist/vega-os"
OUTPUT_PATH="$REPO_ROOT/dist/vega-os/plezy-vega-os-${APP_VERSION}-release.vpkg"
cp "$VPKG_PATH" "$OUTPUT_PATH"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$OUTPUT_PATH")" && sha256sum "$(basename "$OUTPUT_PATH")" > SHA256SUMS.txt)
else
  (cd "$(dirname "$OUTPUT_PATH")" && shasum -a 256 "$(basename "$OUTPUT_PATH")" > SHA256SUMS.txt)
fi

echo "Vega OS package ready: $OUTPUT_PATH"
echo "Install with: vega device install-app --packagePath '$OUTPUT_PATH'"
echo "Launch with:  vega device launch-app --appName ${PACKAGE_ID}.main"
