# Plezy for Amazon Fire TV devices running Vega OS

This target produces a native Vega application package (`.vpkg`) for Fire TV devices whose **Settings > My Fire TV > About** page reports **Vega OS**. It is separate from the Android-based Fire OS APK in `dist/fire-tv/`.

## What is implemented

- React Native for Vega host generated from Amazon's current `hello-world` template
- Local Vega WebView using `@amazon-devices/webview@~3.3.0`
- Bundled Plezy TV UI; no hosted website is required after installation
- Plex PIN linking and server selection
- Jellyfin URL, username, and password login
- Home shelves, libraries, search, details, series/season browsing, and resume
- HLS-first HTML5 playback with direct-play fallback and watch-progress reporting
- Fire TV remote D-pad, Select, media, seek, and Back handling
- Vega manifest media, input, audio, accessibility, and Group-IPC services
- Release `armv7` VPKG generation, VPT validation, version/build metadata, checksum, install, and launch scripts

The mature Flutter client contains features that this living-room web port does not yet expose, including downloads, watch together, metadata editing, tracker integrations, and advanced native player controls.

## Important host requirement

Amazon's Vega SDK currently requires **native macOS 10.15+ or Ubuntu 20.04+**. Windows and WSL are not supported or tested. You can inspect, validate, and package this source on Windows, but the final `.vpkg` must be compiled on a supported Mac or Ubuntu computer with the Vega SDK installed.

## One-command build on macOS or Ubuntu

From the repository root:

```bash
chmod +x vega-os/build.sh vega-os/install.sh
PLEZY_VEGA_BUILD_NUMBER=2 ./vega-os/build.sh
```

The script performs these operations:

1. Generates `vega-os/generated/PlezyVega` from Amazon's `hello-world` template if needed.
2. Bundles the TV web client into the package at `assets/index.html`.
3. Installs the official Vega WebView dependency.
4. Adds the WebView media/input/audio services to `manifest.toml`.
5. Validates the manifest with VPT.
6. Builds a Release VPKG for the physical Fire TV `armv7` target.
7. Checks the VPKG metadata and copies it to `dist/vega-os/` with a SHA-256 file.

For each submitted update, increase both the application version and build number:

```bash
PLEZY_VEGA_VERSION=2.10.2 PLEZY_VEGA_BUILD_NUMBER=3 ./vega-os/build.sh
```

## Build and run with Vega Studio in VS Code

Run `./vega-os/build.sh` once to generate and prepare the project. Open `vega-os/generated/PlezyVega` in VS Code, select the Vega Studio icon, choose **Release**, select the connected Fire TV, and use **Build and run Vega project**. Re-run `node ../../tools/prepare-project.mjs .` from the generated project whenever the shared web client changes.

## Install on a developer-mode Fire TV

Connect the Vega Fire TV over USB, enable and register Developer Mode as described in `TV_INSTALL.md`, then run:

```bash
./vega-os/install.sh dist/vega-os/plezy-vega-os-2.10.1-release.vpkg
```

When more than one Vega device is connected, add its Device Serial Number:

```bash
./vega-os/install.sh dist/vega-os/plezy-vega-os-2.10.1-release.vpkg DEVICE_SERIAL_NUMBER
```

The package ID is `com.edde746.plezy.vega`; the launch component is `com.edde746.plezy.vega.main`. The non-Amazon prefix is intentional because Vega Developer Mode rejects sideload packages whose IDs begin with `com.amazon`.

## Windows-only validation and source handoff

```powershell
.\scripts\validate_vega_os.ps1
.\scripts\package_vega_os_source.ps1
```

The second command creates a portable source archive in `dist/vega-os/`. Copy that archive to a native Mac or Ubuntu computer, extract it, install the Vega SDK, and run `./vega-os/build.sh`.

## Security and server connectivity

Plezy loads its UI from package-local files and permits HTTP media/server requests so it can reach typical Plex and Jellyfin installations on a trusted home LAN. Prefer HTTPS with a valid certificate whenever your server supports it. Do not expose an unauthenticated media server to the public internet.

## Validation boundary

The Windows validator checks source structure, dependency pins, package identity, manifest services, armv7/release flags, the local WebView entry point, and the exit bridge. Only Amazon's Vega SDK can validate and compile the generated project, and only a physical Vega Fire TV can confirm codec, HDR, audio, remote, network, and playback behavior. Complete that device test before Appstore distribution.
