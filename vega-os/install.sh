#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VPKG_PATH="${1:-}"
DEVICE_DSN="${2:-}"
COMPONENT_ID="com.edde746.plezy.vega.main"

if [[ -z "$VPKG_PATH" ]]; then
  VPKG_PATH="$(find "$REPO_ROOT/dist/vega-os" -maxdepth 1 -type f -name '*.vpkg' -print -quit 2>/dev/null || true)"
fi
if [[ -z "$VPKG_PATH" || ! -f "$VPKG_PATH" ]]; then
  echo "Usage: ./vega-os/install.sh /path/to/plezy.vpkg [DEVICE_DSN]" >&2
  exit 2
fi

vega exec vpt info "$VPKG_PATH" --json
if [[ -n "$DEVICE_DSN" ]]; then
  vega device -d "$DEVICE_DSN" install-app --packagePath "$VPKG_PATH"
  vega device -d "$DEVICE_DSN" launch-app --appName "$COMPONENT_ID"
else
  vega device install-app --packagePath "$VPKG_PATH"
  vega device launch-app --appName "$COMPONENT_ID"
fi
