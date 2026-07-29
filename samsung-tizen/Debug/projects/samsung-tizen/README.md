# Plezy Samsung Tizen client

This is a Tizen 6.0+ television client for Plex and Jellyfin. It is a separate TV runtime, not a Flutter-to-Tizen wrapper: Samsung playback uses AVPlay and the UI is implemented as a fixed 1920x1080, 16:9 ten-foot Web application with remote/D-pad focus management. Samsung automatically scales that canvas for 1280x720 model families.

Version 2.10.2 adds Tizen 6-compatible full-screen positioning, resilient Plex home-feed fallbacks, and a Samsung-specific HLS transcode profile with direct-play fallback.

Version 2.10.3 streamlines TV navigation: home and episode cards play directly, shows automatically display seasons and offer Play First/Next/Resume Episode, seasons automatically display episodes, and episode selection starts playback without an extra detail page. D-pad navigation avoids smooth scrolling and expensive focus animation, home shelves render bounded card sets, and large libraries load 60 cards at a time.

Runtime files are `config.xml`, `index.html`, `icon.png`, `css/app.css`, `js/api.js`, and `js/app.js`. The source handoff also contains `tizen_web_project.yaml`, the Node package metadata, tests, and the package validator; the project metadata excludes those development-only files from the installed WGT.

## Local checks

```powershell
npm run check
npm test
```

No npm dependencies are installed or shipped. The test suite uses Node's built-in test runner.

## Package

From the repository root:

```powershell
.\scripts\build_samsung_tizen.ps1
.\scripts\build_samsung_tizen.ps1 -CertificateProfile "YOUR_SAMSUNG_PROFILE"
```

The first command creates a validated source archive. The second also invokes Tizen Studio's Web CLI to create an owner-signed WGT. Samsung TVs will not install an unsigned or generically signed WGT.

See [`../TV_INSTALL.md`](../TV_INSTALL.md) for full setup, signing, installation, security, compatibility, feature-scope, and troubleshooting instructions.
