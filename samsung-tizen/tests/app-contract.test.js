"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");
var app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
var css = fs.readFileSync(path.join(root, "css", "app.css"), "utf8");

test("resumed transcodes retain their absolute timeline position", function () {
  assert.match(app, /timelineOffsetMs \+ \(Number\(time\) \|\| 0\)/);
  assert.match(app, /timelineOffsetMs \+ self\.html\.currentTime \* 1000/);
  assert.match(app, /mediaTarget = Math\.max\(0, target - this\.timelineOffsetMs\)/);
});

test("leaving playback suppresses duplicate app-exit events", function () {
  assert.match(app, /suppressExitUntil = Date\.now\(\) \+ 2500/);
  assert.match(app, /Date\.now\(\) < state\.suppressExitUntil/);
});

test("thumbnail focus ring renders above artwork and navigation does not queue smooth scrolling", function () {
  assert.match(css, /\.media-art::after/);
  assert.match(css, /z-index: 4/);
  assert.match(css, /border: 4px solid transparent/);
  assert.match(css, /scroll-behavior: auto/);
  assert.match(app, /behavior: "auto"/);
});

test("Libraries contains owned and shared Plex server groups", function () {
  assert.match(app, /plexServerGroupHtml\("Your Server", true\)/);
  assert.match(app, /plexServerGroupHtml\("Shared With You", false\)/);
  assert.match(app, /data-server-switch/);
});
