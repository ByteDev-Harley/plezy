# Plezy Samsung Tizen client

This is a Tizen 6.0+ television client for Plex and Jellyfin. It is a separate TV runtime, not a Flutter-to-Tizen wrapper: Samsung playback uses AVPlay and the UI is implemented as a fixed 1920x1080, 16:9 ten-foot Web application with remote/D-pad focus management. Samsung automatically scales that canvas for 1280x720 model families.

Version 2.10.2 adds Tizen 6-compatible full-screen positioning, resilient Plex home-feed fallbacks, and a Samsung-specific HLS transcode profile with direct-play fallback.

Version 2.10.3 streamlines TV navigation: home and episode cards play directly, shows automatically display seasons and offer Play First/Next/Resume Episode, seasons automatically display episodes, and episode selection starts playback without an extra detail page. D-pad navigation avoids smooth scrolling and expensive focus animation, home shelves render bounded card sets, and large libraries load 60 cards at a time.

Samsung revision `2.10.5-samsung.9` adds full remote-friendly subtitle selection, Plex subtitle search/download, synchronization, custom text rendering, and remembered appearance and language preferences. It retains the provider-identity, Plex Home, multi-server, and global Nick Mode behavior introduced in the previous revision.

The navigation runtime builds its focus graph after each render, keeps geometry work out of D-pad key events, and explicitly loads artwork for the visible cards plus a small look-ahead window. The application and Samsung AVPlay display rectangle intentionally remain on the 1920×1080 logical TV canvas.

The provider identity picker is shown on every launch. Cached Plex Home users and saved Jellyfin logins appear immediately while linked Plex accounts refresh their Home users in the background. Selecting an identity reconnects its last available server or opens the server picker, keeping provider feeds, recommendations, progress, and watch-state calls isolated during switches.

Plex parent-account tokens are used only to discover and switch Home users. Minted Home-user and server tokens are used for discovery and media requests. Settings can switch identities, manage servers, unlink a Plex parent account and its Home identities, or remove a saved Jellyfin login.

Nick Mode is global to the Samsung app and remains enabled when switching between Plex and Jellyfin identities. The preference changes only in-app branding, copy, and theme colors; the Samsung launcher icon and provider-specific colors remain unchanged.

Identity state is stored in `plezy-tv-identities-v3`. On first launch after an upgrade, the app transactionally migrates every Plex binding, Jellyfin account, saved server, last-used identity, and Nick Mode preference from `plezy-tv-profiles-v2` or `plezy-tv-session-v1`. Legacy storage is removed only after the v3 document is written and read back successfully. Provider access tokens remain only in Tizen local storage.

Runtime files are `config.xml`, `index.html`, `icon.png`, `nick-mode.png`, `css/app.css`, `js/identity-store.js`, `js/subtitle-runtime.js`, `js/api.js`, `js/navigation.js`, and `js/app.js`. The source handoff also contains `tizen_web_project.yaml`, the Node package metadata, tests, and the package validator; the project metadata excludes those development-only files from the installed WGT.

## Player and subtitle controls

Playback continues while the subtitle panel is open. In normal transport mode, Left and Right seek by 30 seconds and Play/Pause toggles playback. Press Down to focus the player action row, use Left/Right to choose Play/Pause or Subtitles, press Select to activate it, and press Up to return to transport mode. Back closes the subtitle panel first; a subsequent Back exits playback.

The Tracks tab includes Off and every subtitle stream reported by Plex or Jellyfin. Labels identify language, title, forced tracks, SDH/CC, external files, and codecs. Plex playback also includes a Search tab with language and optional title filters; a downloaded result is polled for up to 10 seconds and selected as soon as Plex adds it to the item. Jellyfin does not expose this Plex subtitle-provider endpoint, so its panel intentionally omits Search.

Text subtitles use a safe Plezy overlay and can be customized for font size, text and outline colors, outline thickness, background color and opacity, bold, italic, and vertical position. Synchronization ranges from −60 to +60 seconds in 100 ms steps. The app stores these settings, global language/Off preference, and identity/server-scoped movie or series choices in `plezy-tv-subtitles-v1` without modifying provider account preferences.

PGS, VobSub/DVD, DVB, and other bitmap subtitle formats cannot be represented as text. Plex or Jellyfin must burn those subtitles into the video, so appearance and synchronization controls are disabled for them. Actual delivery and codec support still depend on the server's HLS transcoder and the TV model's AVPlay firmware; direct-play fallback cannot preserve server burn-in.

## Local checks

```powershell
npm run check
npm test
```

No npm dependencies are installed or shipped. The test suite uses Node's built-in test runner.

Open `tests/tv-preview.html` at a 1920×1080 viewport to preview the launch identity picker with Plex Home and Jellyfin identities. Add `?home`, `?libraries`, `?show`, or `?season` to preview the maintained content layouts. Use `?nick` for the Nick Mode picker or `?settings&nick` for the enabled Settings switch; the latter can be clicked to compare both modes while retaining focus. Emulate `prefers-reduced-motion: reduce` in browser developer tools to verify the logo animation is disabled.

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
