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
var profiles = fs.readFileSync(path.join(root, "js", "profile-store.js"), "utf8");
var preview = fs.readFileSync(path.join(root, "tests", "tv-preview.html"), "utf8");

test("resumed transcodes retain their absolute timeline position", function () {
  assert.match(app, /timelineOffsetMs \+ \(Number\(time\) \|\| 0\)/);
  assert.match(app, /timelineOffsetMs \+ self\.html\.currentTime \* 1000/);
  assert.match(app, /mediaTarget = Math\.max\(0, target - this\.timelineOffsetMs\)/);
});

test("leaving playback suppresses duplicate app-exit events", function () {
  assert.match(app, /suppressExitUntil = Date\.now\(\) \+ 2500/);
  assert.match(app, /Date\.now\(\) < state\.suppressExitUntil/);
});

test("Back retains playback, detail-stack, route, authentication, and exit behavior", function () {
  var goBack = app.slice(app.indexOf("function goBack()"), app.indexOf("function handleHardwareBack()"));
  assert.match(goBack, /state\.player\.stop\(false\)/);
  assert.match(goBack, /state\.detailStack\.pop\(\)/);
  assert.match(goBack, /showScreen\("browse"\)/);
  assert.match(goBack, /routeHome\(\)/);
  assert.match(goBack, /showScreen\("welcome"\)/);
  assert.match(goBack, /exitApplication\(\)/);
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

test("thumbnail focus ring renders above artwork and navigation does not queue smooth scrolling", function () {
  assert.match(css, /\.media-art::after/);
  assert.match(css, /z-index: 4/);
  assert.match(css, /border: 4px solid transparent/);
  assert.match(css, /scroll-behavior: auto/);
  assert.doesNotMatch(app + navigation, /scrollIntoView/);
  assert.match(navigation, /preventScroll: true/);
  assert.match(navigation, /scrollLeft = Math\.max/);
  assert.match(navigation, /scrollTop = Math\.max/);
});

test("ordinary D-pad handling uses the cached index without selectors or geometry", function () {
  var handleKey = app.slice(app.indexOf("function handleKey(event)"), app.indexOf("function handleKeyUp(event)"));
  var moveFocus = app.slice(app.indexOf("function moveFocus(direction)"), app.indexOf("function exitApplication()"));
  var cachedMove = navigation.slice(
    navigation.indexOf("NavigationIndex.prototype.move ="),
    navigation.indexOf("return {", navigation.indexOf("NavigationIndex.prototype.move ="))
  );
  assert.doesNotMatch(handleKey + moveFocus + cachedMove, /querySelector(?:All)?\s*\(/);
  assert.doesNotMatch(handleKey + moveFocus + cachedMove, /getBoundingClientRect\s*\(/);
  assert.match(moveFocus, /state\.navigation\.move\(direction\)/);
});

test("focus refresh is cancellable, frame-batched, and timer-free", function () {
  var scheduler = app.slice(
    app.indexOf("function scheduleNavigationRefresh"),
    app.indexOf("function showScreen")
  );
  assert.match(scheduler, /cancelFrame\(state\.navigationFrame\)/);
  assert.match(scheduler, /requestFrame\(function/);
  assert.match(scheduler, /state\.navigation\.refresh\(screen\)/);
  assert.doesNotMatch(scheduler, /setTimeout/);
  assert.doesNotMatch(app, /}, 3[05]\);/);
});

test("only held repeats are rate-limited and diagnostics remain opt-in", function () {
  assert.doesNotMatch(app, /lastNavigationAt|< 45/);
  assert.match(app, /state\.repeatGate\.accept\(code, event\.repeat\)/);
  assert.match(app, /state\.repeatGate\.release\(event\.keyCode\)/);
  assert.match(app, /window\.__PLEZY_TV_PERFORMANCE__ === true/);
  assert.match(app, /keydown-to-focus/);
  assert.match(app, /keydown-to-next-paint/);
});

test("artwork is activated by the navigation look-ahead instead of native lazy loading", function () {
  assert.match(app, /data-artwork-src/);
  assert.doesNotMatch(app, /loading="lazy"/);
  assert.match(navigation, /_loadInitialArtwork/);
  assert.match(navigation, /_loadArtworkAround/);
});

test("library and search Load More restore the first newly rendered card", function () {
  assert.match(app, /state\.libraryVisibleCount \+= 60/);
  assert.match(app, /state\.searchVisibleCount \+= 60/);
  assert.match(app, /renderLibraryItems\(nextItem \? itemKey\(nextItem\) : ""\)/);
  assert.match(app, /renderSearchItems\(nextSearchItem \? itemKey\(nextSearchItem\) : ""\)/);
  assert.match(app, /attributes: \{ "data-page-anchor": "true" \}/);
});

test("stale route responses cannot replace a newer screen", function () {
  assert.match(app, /contentRevision/);
  assert.match(app, /revision !== state\.contentRevision/);
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

test("Libraries contains owned and shared Plex server groups", function () {
  assert.match(app, /plexServerGroupHtml\("Your Server", true\)/);
  assert.match(app, /plexServerGroupHtml\("Shared With You", false\)/);
  assert.match(app, /data-server-switch/);
});

test("launch migration always resolves to the D-pad profile picker", function () {
  var restore = app.slice(app.indexOf("function restoreProfiles"), app.indexOf("function formatTime"));
  assert.match(restore, /profileStore\.migrateLegacy\(\)/);
  assert.match(restore, /renderProfilePicker\(\)/);
  assert.doesNotMatch(restore, /activateStoredConnection|openBrowse/);
  assert.match(index, /id="profile-picker-screen"/);
  assert.match(index, /data-action="new-profile"/);
  assert.match(css, /\.profile-grid/);
  assert.match(css, /\.profile-avatar/);
});

test("profile and connection activation tears down playback, clears state, and suppresses stale work", function () {
  var leave = app.slice(app.indexOf("function leaveActiveContext"), app.indexOf("function renderProfilePicker"));
  var activate = app.slice(app.indexOf("function activateStoredConnection"), app.indexOf("function selectProfile"));
  assert.match(leave, /state\.player\.teardown\(\)/);
  assert.match(leave, /clearMediaNavigationState\(\)/);
  assert.match(leave, /state\.client = null/);
  assert.match(activate, /revision !== state\.activationRevision/);
  assert.match(activate, /previous && previous\.client/);
  assert.match(activate, /routeSettings\(\)/);
});

test("playback progress stays bound to the client that created the playback", function () {
  var player = app.slice(app.indexOf("function PlayerController"), app.indexOf("function moveFocus"));
  assert.match(player, /this\.client = null/);
  assert.match(player, /self\.client\.reportProgress/);
  assert.match(player, /this\.client\.reportProgress/);
  assert.doesNotMatch(player, /state\.client\.reportProgress/);
  assert.match(player, /PlayerController\.prototype\.teardown/);
});

test("Settings exposes profile, connection switch, add, and remove management", function () {
  var settings = app.slice(app.indexOf("function routeSettings"), app.indexOf("function navigate"));
  assert.match(settings, /data-action="switch-profile"/);
  assert.match(settings, /data-connection-switch/);
  assert.match(settings, /data-connection-remove/);
  assert.match(settings, /data-action="add-connection"/);
});

test("the maintained package loads the profile store before app startup", function () {
  assert.match(index, /src="js\/profile-store\.js"/);
  assert.ok(index.indexOf('src="js/profile-store.js"') < index.indexOf('src="js/app.js"'));
  assert.match(profiles, /plezy-tv-profiles-v2/);
});

test("the 1920x1080 preview opens on the profile picker", function () {
  assert.match(preview, /html, body, iframe \{ width: 1920px; height: 1080px/);
  assert.match(preview, /profile-picker-screen/);
  assert.match(preview, /!\/\(\?:home\|libraries\|show\|season\)\//);
});
