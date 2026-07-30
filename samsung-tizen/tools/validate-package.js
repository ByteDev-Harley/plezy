"use strict";

var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var failures = [];

function read(relativePath) {
  var fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push("Missing required file: " + relativePath);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

var config = read("config.xml");
var index = read("index.html");
var css = read("css/app.css");
var api = read("js/api.js");
var profiles = read("js/profile-store.js");
var navigation = read("js/navigation.js");
var app = read("js/app.js");
var projectYaml = read("tizen_web_project.yaml");
var packageJson = read("package.json");

[
  'required_version="6.0"',
  '<tizen:profile name="tv-samsung"/>',
  "http://tizen.org/privilege/internet",
  "http://tizen.org/privilege/tv.inputdevice",
  '<access origin="*" subdomains="true"/>',
  "<tizen:content-security-policy>",
  "object-src 'self'"
].forEach(function (required) {
  if (config.indexOf(required) === -1) failures.push("config.xml is missing: " + required);
});

var localReferences = [];
var referencePattern = /(?:src|href)="([^"]+)"/g;
var match;
while ((match = referencePattern.exec(index))) {
  var reference = match[1];
  if (/^(?:https?:|data:|blob:|\$)/.test(reference)) continue;
  localReferences.push(reference);
}
localReferences.forEach(function (reference) {
  if (!fs.existsSync(path.join(root, reference))) failures.push("index.html references a missing file: " + reference);
});

if (!fs.existsSync(path.join(root, "icon.png"))) failures.push("Missing Samsung application icon: icon.png");
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(index)) failures.push("Inline scripts violate the package CSP.");
if (/\son[a-z]+\s*=/i.test(index)) failures.push("Inline event handlers violate the package CSP.");
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(api + profiles + navigation + app)) failures.push("Dynamic code execution is not allowed.");
if (index.indexOf('content="width=1920,user-scalable=no"') === -1) failures.push("The Samsung viewport must use the 1920px TV canvas.");
if (index.indexOf('src="js/navigation.js"') === -1 || index.indexOf('src="js/navigation.js"') > index.indexOf('src="js/app.js"')) failures.push("The navigation runtime must load before app.js.");
if (index.indexOf('src="js/profile-store.js"') === -1 || index.indexOf('src="js/profile-store.js"') > index.indexOf('src="js/app.js"')) failures.push("The profile store must load before app.js.");
if (/\binset\s*:/.test(css)) failures.push("CSS inset shorthand is not supported by the Tizen 6 Chromium engine.");
if (css.indexOf("width: 1920px") === -1 || css.indexOf("height: 1080px") === -1) failures.push("The stylesheet must define a 1920x1080 TV canvas.");
if (api.indexOf('optional("/library/onDeck")') === -1 || api.indexOf('optional("/library/recentlyAdded")') === -1) failures.push("Plex home fallbacks are missing.");
if (api.indexOf('directPlay: 0') === -1 || api.indexOf('"X-Plex-Client-Profile-Extra"') === -1) failures.push("The Samsung Plex transcode profile is missing.");
if (app.indexOf('PLAYER_DISPLAY_MODE_LETTER_BOX') === -1) failures.push("Samsung AVPlay must use TV-safe letterboxing.");
if (config.indexOf('version="2.10.5"') === -1 || api.indexOf('2.10.5-samsung.7') === -1 || packageJson.indexOf('"version": "2.10.5-samsung.7"') === -1) failures.push("Samsung package versions are not synchronized.");
if (index.indexOf('id="detail-more"') !== -1 || app.indexOf('Browse episodes') !== -1) failures.push("The obsolete Browse episodes flow must not be packaged.");
if (api.indexOf("getShowUpNext") === -1 || api.indexOf("chooseUpNext") === -1) failures.push("Show play-next selection is missing.");
if (app.indexOf('data-direct-play="true"') === -1 || app.indexOf("loadChildren(detail)") === -1) failures.push("Direct playback or automatic child loading is missing.");
if (app.indexOf("client.getShowUpNext(item.id)") === -1) failures.push("Direct home-screen show playback is missing.");
if (app.indexOf("function handleHardwareBack") === -1 || app.indexOf("lastBackAt") === -1 || app.indexOf("suppressExitUntil") === -1) failures.push("Samsung duplicate Back-event protection is missing.");
if (navigation.indexOf("preventScroll: true") === -1 || navigation.indexOf("scrollIntoView") !== -1 || css.indexOf("scroll-behavior: auto") === -1) failures.push("Samsung focus scrolling must remain immediate and conditional.");
if (css.indexOf(".media-art::after") === -1 || css.indexOf("border: 4px solid transparent") === -1 || css.indexOf("scale(1.035)") === -1) failures.push("Samsung thumbnail focus styling is missing.");
if (app.indexOf("timelineOffsetMs") === -1 || app.indexOf("resumeSeekPending") === -1) failures.push("Samsung resumed-playback timeline correction is missing.");
if (app.indexOf("plexServerGroupHtml") === -1 || app.indexOf("data-server-switch") === -1 || api.indexOf("accountToken") === -1 || api.indexOf("orderPlexServers") === -1) failures.push("Plex multi-server library switching is missing.");
if (profiles.indexOf('plezy-tv-profiles-v2') === -1 || profiles.indexOf('plezy-tv-session-v1') === -1 || profiles.indexOf("migrateLegacy") === -1) failures.push("The versioned profile store or legacy migration is missing.");
if (api.indexOf("getHomeUsers") === -1 || api.indexOf("switchHomeUser") === -1 || api.indexOf("identityToken") === -1) failures.push("Plex Home identity switching is missing.");
if (app.indexOf('showScreen("profile-picker")') === -1 || index.indexOf('id="profile-picker-screen"') === -1) failures.push("The launch profile picker is missing.");
if (app.indexOf("PlayerController.prototype.teardown") === -1 || app.indexOf("activationRevision") === -1) failures.push("Profile switching must tear down playback and suppress stale work.");
if (app.indexOf("libraryVisibleCount") === -1 || app.indexOf("limit: 12") === -1) failures.push("Samsung DOM rendering limits are missing.");
if (app.indexOf("lastNavigationAt") !== -1 || app.indexOf("event.repeat") === -1 || navigation.indexOf("RepeatGate") === -1) failures.push("Samsung held-key repeat handling is missing.");
if (app.indexOf("data-artwork-src") === -1 || navigation.indexOf("artworkLookAhead") === -1) failures.push("Samsung artwork look-ahead loading is missing.");
if (app.indexOf("keydown-to-focus") === -1 || app.indexOf("keydown-to-next-paint") === -1 || app.indexOf("performanceDiagnosticsEnabled") === -1) failures.push("Opt-in Samsung navigation diagnostics are missing.");
if (projectYaml.indexOf("profile: tv-samsung") === -1 || projectYaml.indexOf('api_version: "6.0"') === -1) failures.push("VS Code Tizen TV project metadata is invalid.");
if (projectYaml.indexOf("  - js/navigation.js") === -1) failures.push("The navigation runtime must be included in the Tizen project.");
if (projectYaml.indexOf("  - js/profile-store.js") === -1) failures.push("The profile store must be included in the Tizen project.");
if (projectYaml.indexOf("  - tests/*") === -1 || projectYaml.indexOf("  - tools/*") === -1 || projectYaml.indexOf("  - tizen_web_project.yaml") === -1) failures.push("Development-only files must be excluded from the WGT.");

var packageMatch = config.match(/<tizen:application\s+id="([^"]+)"\s+package="([^"]+)"/);
if (!packageMatch) {
  failures.push("config.xml has no Tizen application/package ID.");
} else {
  var applicationId = packageMatch[1];
  var packageId = packageMatch[2];
  if (!/^[A-Za-z0-9]{10}$/.test(packageId)) failures.push("Tizen package ID must be exactly 10 alphanumeric characters.");
  if (applicationId.indexOf(packageId + ".") !== 0) failures.push("Tizen application ID must begin with the package ID.");
}

var declaredIds = {};
var idPattern = /\bid=["']([^"']+)["']/g;
var combinedMarkup = index + "\n" + app;
while ((match = idPattern.exec(combinedMarkup))) declaredIds[match[1]] = true;
var referencedIds = {};
var byIdPattern = /byId\("([^"]+)"\)/g;
while ((match = byIdPattern.exec(app))) referencedIds[match[1]] = true;
Object.keys(referencedIds).forEach(function (id) {
  if (!declaredIds[id]) failures.push("app.js references an undeclared element ID: " + id);
});

if (failures.length) {
  failures.forEach(function (failure) { console.error("ERROR: " + failure); });
  process.exit(1);
}

console.log("Samsung Tizen package validation passed (" + localReferences.length + " local references checked).");
