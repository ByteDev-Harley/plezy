"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
var navigation = fs.readFileSync(path.join(root, "js", "navigation.js"), "utf8");
var css = fs.readFileSync(path.join(root, "css", "app.css"), "utf8");
var index = fs.readFileSync(path.join(root, "index.html"), "utf8");
var identities = fs.readFileSync(path.join(root, "js", "identity-store.js"), "utf8");
var subtitles = fs.readFileSync(path.join(root, "js", "subtitle-runtime.js"), "utf8");
var preview = fs.readFileSync(path.join(root, "tests", "tv-preview.html"), "utf8");
var projectYaml = fs.readFileSync(path.join(root, "tizen_web_project.yaml"), "utf8");
var validator = fs.readFileSync(path.join(root, "tools", "validate-package.js"), "utf8");
var packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
var buildScript = fs.readFileSync(path.join(root, "..", "scripts", "build_samsung_tizen.ps1"), "utf8");

test("resumed transcodes retain their absolute timeline position", function () {
  assert.match(app, /timelineOffsetMs \+ \(Number\(time\) \|\| 0\)/);
  assert.match(app, /timelineOffsetMs \+ self\.html\.currentTime \* 1000/);
  assert.match(app, /mediaTarget = Math\.max\(0, target - this\.timelineOffsetMs\)/);
});

test("Back retains playback, detail-stack, route, provider-management, and exit behavior", function () {
  var goBack = app.slice(app.indexOf("function goBack()"), app.indexOf("function handleHardwareBack()"));
  assert.match(goBack, /state\.player\.stop\(false\)/);
  assert.match(goBack, /state\.player\.closeSubtitlePanel\(\)/);
  assert.match(goBack, /state\.detailStack\.pop\(\)/);
  assert.match(goBack, /renderProviderManagement\(\)/);
  assert.match(goBack, /renderIdentityPicker\(\)/);
  assert.match(goBack, /routeHome\(\)/);
  assert.match(goBack, /exitApplication\(\)/);
  assert.match(goBack, /cancelPlexServer\(\)/);
  assert.match(app, /suppressExitUntil = Date\.now\(\) \+ 2500/);
});

test("playback return restores a cached item or action in the post-render pass", function () {
  var restore = app.slice(
    app.indexOf("PlayerController.prototype.restoreScreen"),
    app.indexOf("PlayerController.prototype._open")
  );
  assert.match(restore, /"data-item": this\.returnFocusItem/);
  assert.match(restore, /"data-action": this\.returnFocusAction/);
  assert.match(restore, /scheduleNavigationRefresh/);
  assert.doesNotMatch(restore, /querySelector|setTimeout/);
});

test("thumbnail focus and navigation remain frame-batched and geometry-free during ordinary moves", function () {
  var scheduler = app.slice(app.indexOf("function scheduleNavigationRefresh"), app.indexOf("function showScreen"));
  var handleKey = app.slice(app.indexOf("function handleKey(event)"), app.indexOf("function handleKeyUp(event)"));
  var moveFocus = app.slice(app.indexOf("function moveFocus(direction)"), app.indexOf("function exitApplication()"));
  assert.match(css, /\.media-art::after/);
  assert.match(css, /z-index: 4/);
  assert.match(css, /scroll-behavior: auto/);
  assert.match(navigation, /preventScroll: true/);
  assert.doesNotMatch(app + navigation, /scrollIntoView/);
  assert.match(scheduler, /cancelFrame\(state\.navigationFrame\)/);
  assert.match(scheduler, /requestFrame\(function/);
  assert.doesNotMatch(scheduler, /setTimeout/);
  assert.doesNotMatch(handleKey + moveFocus, /querySelector(?:All)?\s*\(|getBoundingClientRect\s*\(/);
  assert.match(moveFocus, /state\.navigation\.move\(direction\)/);
});

test("held-key handling, diagnostics, artwork look-ahead, and paged rendering remain bounded", function () {
  assert.match(app, /state\.repeatGate\.accept\(code, event\.repeat\)/);
  assert.match(app, /window\.__PLEZY_TV_PERFORMANCE__ === true/);
  assert.match(app, /keydown-to-focus/);
  assert.match(app, /data-artwork-src/);
  assert.match(navigation, /_loadArtworkAround/);
  assert.match(app, /state\.libraryVisibleCount \+= 60/);
  assert.match(app, /state\.searchVisibleCount \+= 60/);
  assert.match(app, /limit: 12/);
});

test("route and identity revisions reject stale asynchronous work", function () {
  assert.match(app, /revision !== state\.contentRevision/);
  assert.match(app, /contextRevision !== state\.activationRevision/);
  assert.match(app, /client !== state\.client/);
  assert.match(app, /state\.route !== "home"/);
  assert.match(app, /state\.route !== "libraries"/);
  assert.match(app, /state\.route !== "search"/);
});

test("Samsung logical canvas and AVPlay coordinates stay at 1920x1080", function () {
  assert.match(css, /width: 1920px/);
  assert.match(css, /height: 1080px/);
  assert.match(app, /setDisplayRect\(0, 0, 1920, 1080\)/);
  assert.doesNotMatch(app + css, /3840|2160/);
});

test("launch renders cached identities before refreshing every linked Plex account", function () {
  var restore = app.slice(app.indexOf("function restoreIdentities"), app.indexOf("function formatTime"));
  assert.match(restore, /identityStore\.migrate\(\)/);
  assert.ok(restore.indexOf("applyGlobalBranding()") < restore.indexOf("renderIdentityPicker()"));
  assert.ok(restore.indexOf("renderIdentityPicker()") < restore.indexOf("refreshPlexIdentities()"));
  assert.doesNotMatch(restore, /activateStoredIdentity|openBrowse/);
  assert.match(app, /state\.identityStore\.getPlexAccounts\(\)/);
  assert.match(app, /Promise\.all\(accounts\.map/);
  assert.match(app, /syncPlexHomeUsers\(account\.id, users, \{ prune: true \}\)/);
});

test("identity picker supports empty, Plex, Jellyfin, and mixed cached states without local profiles", function () {
  var picker = app.slice(app.indexOf("function renderIdentityPicker"), app.indexOf("function refreshPlexIdentities"));
  assert.match(index, /id="identity-picker-screen"/);
  assert.match(index, /id="identity-picker-empty"/);
  assert.match(index, /data-action="connect-plex"/);
  assert.match(index, /data-action="connect-jellyfin"/);
  assert.match(index, /data-action="manage-providers"/);
  assert.match(picker, /identity\.provider === "plex"/);
  assert.match(picker, /providerBadge\(identity\.provider\)/);
  assert.match(css, /\.identity-grid/);
  assert.match(navigation, /identity-grid/);
  assert.doesNotMatch(index + css + navigation + app, /profile-picker|profile-name|profile-manage|PlezyTVProfiles/);
});

test("identity activation tears down playback, offers PIN and server pickers, and suppresses stale results", function () {
  var leave = app.slice(app.indexOf("function leaveActiveContext"), app.indexOf("function renderIdentityPicker"));
  var activate = app.slice(app.indexOf("function activateStoredIdentity"), app.indexOf("function selectIdentity"));
  assert.match(leave, /state\.player\.teardown\(\)/);
  assert.match(leave, /clearMediaNavigationState\(\)/);
  assert.match(leave, /state\.client = null/);
  assert.match(leave, /state\.activeIdentity = null/);
  assert.match(activate, /Api\.activateIdentity/);
  assert.match(activate, /requestPin: function/);
  assert.match(activate, /chooseServer: requestPlexServer/);
  assert.match(activate, /revision !== state\.activationRevision/);
  assert.match(activate, /previous && previous\.client/);
});

test("Plex server switching retains identity-owned server sessions", function () {
  var switching = app.slice(app.indexOf("function switchPlexServer"), app.indexOf("function openLibrary"));
  assert.match(app, /plexServerGroupHtml\("Your Server", true\)/);
  assert.match(app, /plexServerGroupHtml\("Shared With You", false\)/);
  assert.match(switching, /identityStore\.upsertConnection\(state\.activeIdentity\.id/);
  assert.match(switching, /identityStore\.setDefaultConnection/);
  assert.match(switching, /identityStore\.touchIdentity/);
});

test("Settings exposes identity/provider management and a global Nick Mode switch", function () {
  var settings = app.slice(app.indexOf("function routeSettings"), app.indexOf("function navigate"));
  var toggle = app.slice(app.indexOf("function toggleNickMode"), app.indexOf("function navigate"));
  assert.match(settings, /data-action="switch-identity"/);
  assert.match(settings, /data-action="manage-providers"/);
  assert.match(settings, /data-connection-switch/);
  assert.match(settings, /role="switch"/);
  assert.match(settings, /state\.identityStore\.getNickMode\(\)/);
  assert.match(toggle, /state\.identityStore\.setNickMode\(enabled\)/);
  assert.match(toggle, /applyBranding\(enabled\)/);
  assert.match(toggle, /routeSettings\(true\)/);
});

test("provider management unlinks Plex parents and removes saved Jellyfin logins", function () {
  var management = app.slice(app.indexOf("function renderProviderManagement"), app.indexOf("function providerName"));
  assert.match(index, /id="provider-manage-screen"/);
  assert.match(management, /data-plex-unlink/);
  assert.match(management, /data-jellyfin-remove/);
  assert.match(management, /identityStore\.unlinkPlexAccount/);
  assert.match(management, /identityStore\.removeJellyfinIdentity/);
});

test("playback progress remains bound to the client that created the playback", function () {
  var player = app.slice(app.indexOf("function PlayerController"), app.indexOf("function moveFocus"));
  assert.match(player, /this\.client = null/);
  assert.match(player, /self\.client\.reportProgress/);
  assert.match(player, /this\.client\.reportProgress/);
  assert.doesNotMatch(player, /state\.client\.reportProgress/);
  assert.match(player, /PlayerController\.prototype\.teardown/);
});

test("subtitle panel keeps playback active and implements player focus modes", function () {
  var player = app.slice(app.indexOf("function PlayerController"), app.indexOf("function moveFocus"));
  assert.match(index, /id="player-action-row"/);
  assert.match(index, /data-player-action="play"/);
  assert.match(index, /data-player-action="subtitles"/);
  assert.match(index, /id="subtitle-panel"/);
  assert.match(index, /id="subtitle-overlay"/);
  assert.match(player, /focusMode = "transport"/);
  assert.match(player, /focusMode = "row"/);
  assert.match(player, /focusMode = "panel"/);
  assert.match(player, /playerFocusTransition/);
  assert.match(player, /setSelectTrack\("TEXT"/);
  assert.match(player, /createPlayback\(itemOverride \|\| oldPlayback\.item/);
  assert.match(player, /startMs: position/);
  assert.match(player, /var wasPaused = this\.paused/);
  assert.match(player, /if \(self\.paused\) player\.pause\(\)/);
  assert.match(player, /if \(this\.focusMode === "row" \|\| this\.focusMode === "panel"\) return/);
});

test("custom subtitle rendering uses text nodes, AVPlay callbacks, and burned-format gating", function () {
  var player = app.slice(app.indexOf("function PlayerController"), app.indexOf("function moveFocus"));
  assert.match(player, /onsubtitlechange/);
  assert.match(player, /setSilentSubtitle/);
  assert.match(player, /setSubtitlePosition/);
  assert.match(player, /document\.createTextNode\(run\.text\)/);
  assert.match(player, /window\.fetch\(url\)/);
  assert.match(player, /Subtitles\.parseSubtitleCues/);
  assert.match(player, /externalCueLoadingUrl !== url/);
  assert.doesNotMatch(player.slice(player.indexOf("PlayerController.prototype._renderCue"), player.indexOf("PlayerController.prototype.applySubtitleStyle")), /innerHTML/);
  assert.match(player, /subtitleDelivery === "burned"/);
  assert.match(player, /SUBTITLE_DOWNLOAD_TIMEOUT|10 seconds/);
  assert.match(css, /\.subtitle-overlay/);
  assert.match(css, /\.subtitle-panel/);
  assert.match(subtitles, /plezy-tv-subtitles-v1/);
});

test("Nick Mode is global, changes only general branding, and honors reduced motion", function () {
  var branding = app.slice(app.indexOf("function applyBranding"), app.indexOf("function show(element)"));
  assert.equal((index.match(/\bmain-logo\b/g) || []).length, 3);
  ["splash-logo", "identity-logo", "sidebar-logo"].forEach(function (surface) {
    assert.match(index, new RegExp('class="[^"]*' + surface + '[^"]*main-logo'));
  });
  assert.match(branding, /all\("\.main-logo"\)/);
  assert.match(branding, /WHO’S NICKING\?/);
  assert.match(css, /#app\.nick-mode\s*\{[^}]*--accent: #d9959a;[^}]*--focus: #ffd0d4;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.button--plex\s*\{[^}]*background: var\(--plex\)/s);
  assert.match(css, /\.button--jellyfin\s*\{[^}]*background: var\(--jellyfin\)/s);
});

test("identity store, package metadata, source revision, and Nick asset are synchronized", function () {
  assert.match(index, /src="js\/identity-store\.js"/);
  assert.ok(index.indexOf('src="js/identity-store.js"') < index.indexOf('src="js/app.js"'));
  assert.match(index, /src="js\/subtitle-runtime\.js"/);
  assert.ok(index.indexOf('src="js/subtitle-runtime.js"') < index.indexOf('src="js/app.js"'));
  assert.match(identities, /plezy-tv-identities-v3/);
  assert.match(identities, /plezy-tv-profiles-v2/);
  assert.match(projectYaml, /^\s+- js\/identity-store\.js$/m);
  assert.match(projectYaml, /^\s+- js\/subtitle-runtime\.js$/m);
  assert.match(buildScript, /node --check js\/identity-store\.js/);
  assert.match(buildScript, /node --check js\/subtitle-runtime\.js/);
  assert.match(packageJson, /2\.10\.5-samsung\.9/);
  assert.equal(fs.existsSync(path.join(root, "nick-mode.png")), true);
  assert.match(projectYaml, /^\s+- nick-mode\.png$/m);
  assert.match(validator, /Missing Nick Mode branding asset/);
  assert.match(buildScript, /Join-Path \$project "nick-mode\.png"/);
  assert.match(buildScript, /Join-Path \$project "icon\.png"/);
});

test("the maintained 1920x1080 preview opens on the identity picker", function () {
  assert.match(preview, /html, body, iframe \{ width: 1920px; height: 1080px/);
  assert.match(preview, /identity-picker-screen/);
  assert.doesNotMatch(preview, /profile-picker-screen|New profile|Manage profiles/);
});
