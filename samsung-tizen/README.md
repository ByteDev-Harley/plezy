# Plezy Samsung Tizen client

This is a Tizen 6.0+ television client for Plex and Jellyfin. It is a separate TV runtime, not a Flutter-to-Tizen wrapper: Samsung playback uses AVPlay and the UI is implemented as a fixed 1920x1080, 16:9 ten-foot Web application with remote/D-pad focus management. Samsung automatically scales that canvas for 1280x720 model families.

Version 2.10.2 adds Tizen 6-compatible full-screen positioning, resilient Plex home-feed fallbacks, and a Samsung-specific HLS transcode profile with direct-play fallback.

Version 2.10.3 streamlines TV navigation: home and episode cards play directly, shows automatically display seasons and offer Play First/Next/Resume Episode, seasons automatically display episodes, and episode selection starts playback without an extra detail page. D-pad navigation avoids smooth scrolling and expensive focus animation, home shelves render bounded card sets, and large libraries load 60 cards at a time.

Samsung revision `2.10.5-samsung.7` adds launch profiles, reusable Plex Home accounts, profile-specific Jellyfin credentials, and validated profile/connection switching.

The navigation runtime builds its focus graph after each render, keeps geometry work out of D-pad key events, and explicitly loads artwork for the visible cards plus a small look-ahead window. The application and Samsung AVPlay display rectangle intentionally remain on the 1920×1080 logical TV canvas.

The Samsung client has its own local Plezy profile layer. The profile picker is shown on every launch. A profile can hold multiple Plex or Jellyfin connections but opens one server at a time, keeping provider feeds, recommendations, progress, and watch-state calls isolated. Linked Plex accounts can be reused while each profile binding stores its selected Plex Home identity token; Jellyfin credentials remain independent. Profiles are convenience identities on the TV and are not a parental-security boundary.

Each profile can independently enable Nick Mode from Settings. The preference changes only in-app branding, copy, and theme colors; the Samsung launcher icon and provider-specific colors remain unchanged.

Profile state is stored in `plezy-tv-profiles-v2`. On first launch after an upgrade, a valid `plezy-tv-session-v1` session is migrated to a `Default` profile; the old value is removed only after the new document is successfully read back. Provider access tokens still remain only in Tizen local storage.

Runtime files are `config.xml`, `index.html`, `icon.png`, `nick-mode.png`, `css/app.css`, `js/profile-store.js`, `js/api.js`, `js/navigation.js`, and `js/app.js`. The source handoff also contains `tizen_web_project.yaml`, the Node package metadata, tests, and the package validator; the project metadata excludes those development-only files from the installed WGT.

## Local checks

```powershell
npm run check
npm test
```

No npm dependencies are installed or shipped. The test suite uses Node's built-in test runner.

Open `tests/tv-preview.html` at a 1920×1080 viewport to preview the launch picker. Add `?home`, `?libraries`, `?show`, or `?season` to preview the maintained content layouts. Use `?nick` for the Nick Mode picker or `?settings&nick` for the enabled Settings switch; the latter can be clicked to compare both modes while retaining focus. Emulate `prefers-reduced-motion: reduce` in browser developer tools to verify the logo animation is disabled.

## Navigation performance diagnostics

Diagnostics are off by default. To enable them for a Web Inspector session, run the following in the console and reload the app:

```javascript
localStorage.setItem("plezy.tv.performanceDiagnostics", "1");
location.reload();
```

The console then reports the runtime viewport/display dimensions and, for each accepted D-pad key, keydown-to-focus and keydown-to-next-paint timing. Disable the diagnostic after testing with:

```javascript
localStorage.removeItem("plezy.tv.performanceDiagnostics");
location.reload();
```

## Package

From the repository root:

```powershell
.\scripts\build_samsung_tizen.ps1
.\scripts\build_samsung_tizen.ps1 -CertificateProfile "YOUR_SAMSUNG_PROFILE"
```

The first command creates a validated source archive. The second also invokes Tizen Studio's Web CLI to create an owner-signed WGT. Samsung TVs will not install an unsigned or generically signed WGT.

See [`../TV_INSTALL.md`](../TV_INSTALL.md) for full setup, signing, installation, security, compatibility, feature-scope, and troubleshooting instructions.
