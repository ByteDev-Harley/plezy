# Plezy for Roku

This directory contains a native Roku SceneGraph/BrightScript client for Plex and Jellyfin. It is separate from Plezy's Flutter/Android target because Roku OS cannot install Android APKs or Samsung Tizen WGT packages.

## Included functionality

- Roku remote/D-pad navigation
- Plex link-code authorization and multi-server selection
- Jellyfin server, username, and password authorization
- Saved private Roku session with in-app sign out
- Home recommendations, libraries, search, details, seasons, and episodes
- Resume-aware HLS playback through Roku's native `Video` node
- Plex timeline and Jellyfin session progress reporting
- Direct-stream retry if the server's HLS transcode cannot start
- HD and FHD home-screen/splash artwork

The Roku port covers the essential living-room flow. It does not yet include the mature Flutter client's downloads, Live TV/DVR guide, Watch Together, advanced subtitle/audio selection, external players, shader controls, or store publishing metadata.

## Build and validate

Prerequisites:

1. Windows PowerShell 5.1 or newer.
2. Node.js 20 or newer.
3. npm.

From the repository root:

```powershell
cd .\roku
npm ci
npm run check
cd ..
.\scripts\build_roku.ps1
```

The result is:

```text
dist/roku/
  plezy-roku-2.10.0-roku.2.zip
  SHA256SUMS.txt
  PROVENANCE.txt
```

The build script rechecks the manifest, images, SceneGraph XML, BrightScript syntax, TLS guardrails, and ZIP root layout. The `manifest`, `source/`, `components/`, and `images/` entries are placed directly at the ZIP root, as required by Roku.

## Install on a Roku TV or Roku player

You need a physical Roku TV, Roku streaming player, or Roku stick. The device and computer must be on the same local network.

### 1. Enable Developer Mode

1. Create/sign in to a Roku account and enroll in the Roku developer program.
2. On the Roku remote, press this exact sequence without long pauses:
   - **Home** three times
   - **Up** two times
   - **Right, Left, Right, Left, Right**
3. The Developer Settings screen opens. Write down the device URL/IP shown on screen.
4. Choose **Enable installer and restart**.
5. Read and accept Roku's Developer Tools License Agreement.
6. Set a developer web-server password. It is case-sensitive; save it securely.
7. Let the Roku reboot.

If the Developer Settings screen does not appear, return to the Roku home screen and repeat the sequence at a steady pace.

### 2. Upload the Plezy ZIP

1. Build the ZIP or use the prepared file under `dist/roku/`.
2. On a computer on the same network, open the Roku URL from the Developer Settings screen, normally `http://ROKU_IP_ADDRESS`.
3. If the browser warns that the page is not private, confirm you entered the local Roku IP and continue only on your trusted LAN.
4. Sign in to the Development Application Installer:
   - User name: `rokudev`
   - Password: the case-sensitive password set above
5. In **Development Application Installer**, click **Upload**.
6. Select `dist/roku/plezy-roku-2.10.0-roku.2.zip`.
7. Choose ZIP or SquashFS compression when offered, then click **Install**.
8. Plezy launches automatically. It also appears in the bottom row of the Roku home screen.

Roku permits only one developer-sideloaded app at a time. Installing another development ZIP replaces Plezy. This does not affect normal Streaming Store apps.

### 3. Sign in

For Plex:

1. Select **Connect Plex**.
2. On a phone or computer, open `https://plex.tv/link`.
3. Enter the code displayed on the TV.
4. If the account exposes multiple servers, choose the one to use.

For Jellyfin:

1. Select **Connect Jellyfin**.
2. Enter the full server URL, including `http://` or `https://` and any non-default port.
3. Enter the Jellyfin username and password.

Use a trusted HTTPS certificate for internet-facing servers. For a trusted private LAN, plain HTTP can be used when the server is not exposed outside that LAN. Plezy intentionally does not disable certificate or host verification, so a self-signed HTTPS certificate may be rejected until it is replaced by a certificate Roku trusts.

## Update or remove

To update, build a new ZIP and upload it through the same Development Application Installer. Roku may reject an identical package; increment `build_version` in `manifest` for a new build.

To remove the sideloaded app, highlight Plezy on the Roku home screen, press the remote's **Options** (`*`) button, and choose **Remove app**. Removing or replacing a sideloaded package can clear its private registry session, especially if the package developer ID changes.

## Developer package versus Streaming Store package

The ZIP produced here is complete for developer-mode sideloading. It is not a public Streaming Store package.

Roku's encrypted `.pkg` is created and signed by cryptographic hardware in a linked physical Roku:

1. Sideload the ZIP.
2. Generate or restore the app's signing key on the Roku.
3. Open the Roku Development Application Installer's **Packager** page.
4. Package the currently sideloaded app with that key.
5. Submit the resulting `.pkg` and required listing/certification material through Roku's Developer Dashboard.

Keep the developer ID, signing password, and rekey package backed up. Using a different developer ID for an update can make Roku treat it as a different app and can remove saved registry data.

## Playback notes

Plezy requests an HLS stream from Plex or Jellyfin using H.264 video and AAC audio targets where the server supports transcoding. Actual direct-play, HDR, surround audio, caption, and codec behavior depends on the Roku model, Roku OS version, server media analysis, and transcoder configuration.

If a title fails:

- Confirm the Plex/Jellyfin server can transcode that title.
- Confirm the server URL is reachable from the Roku, not `localhost`.
- For remote servers, confirm router/firewall rules and HTTPS certificates.
- Try another title to separate a codec-specific failure from authentication/network failure.
- Rebuild and sideload after `npm run check` passes.

Official references:

- [Activating developer mode and sideloading](https://developer.roku.com/dev/docs/developer-setup)
- [Roku manifest requirements](https://developer.roku.com/dev/docs/channel-manifest)
- [Playing videos with SceneGraph](https://developer.roku.com/dev/docs/playing-videos)
- [Packaging Roku apps for publication](https://developer.roku.com/dev/docs/packaging-channels)
