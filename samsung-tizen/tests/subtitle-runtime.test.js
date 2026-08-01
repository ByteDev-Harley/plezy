"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Subtitles = require("../js/subtitle-runtime.js");

function memoryStorage(initial) {
  var values = Object.assign({}, initial || {});
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem: function (key, value) { values[key] = String(value); },
    removeItem: function (key) { delete values[key]; },
    values: values
  };
}

function context(identityId, connectionId, item) {
  return { provider: "plex", identityId: identityId, connectionId: connectionId, item: item };
}

test("Plex subtitle streams normalize into the shared catalog", function () {
  var tracks = Subtitles.normalizePlexSubtitleTracks({
    Media: [{ Part: [{ Stream: [
      { streamType: 1, id: 1, codec: "h264" },
      {
        streamType: 3,
        id: 31,
        index: 4,
        languageCode: "eng",
        language: "English",
        title: "Signs & Songs",
        codec: "srt",
        forced: 1,
        hearingImpaired: true,
        selected: "1",
        key: "/library/streams/31"
      }
    ] }] }]
  });
  assert.equal(tracks.length, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(tracks[0]).filter(function (entry) {
    return ["id", "index", "languageCode", "language", "title", "codec", "forced", "hearingImpaired", "selected", "external"].includes(entry[0]);
  })), {
    id: "31",
    index: 4,
    languageCode: "en",
    language: "English",
    title: "Signs & Songs",
    codec: "srt",
    forced: true,
    hearingImpaired: true,
    selected: true,
    external: true
  });
  assert.equal(Subtitles.subtitleDeliveryFor(tracks[0]), "external");
  assert.equal(Subtitles.subtitleTrackLabel(tracks[0]), "English · Signs & Songs · Forced · SDH/CC · External · SRT");
});

test("Jellyfin defaults, external text, and bitmap delivery normalize correctly", function () {
  var tracks = Subtitles.normalizeJellyfinSubtitleTracks({
    MediaSources: [{
      DefaultSubtitleStreamIndex: 7,
      MediaStreams: [
        { Type: "Subtitle", Index: 7, Language: "spa", DisplayLanguage: "Spanish", Codec: "subrip", IsExternal: true },
        { Type: "Subtitle", Index: 9, Language: "eng", Codec: "PGSSUB", IsForced: true }
      ]
    }]
  });
  assert.equal(tracks[0].selected, true);
  assert.equal(tracks[0].external, true);
  assert.equal(tracks[0].languageCode, "es");
  assert.equal(Subtitles.subtitleDeliveryFor(tracks[0]), "external");
  assert.equal(tracks[1].language, "English");
  assert.equal(Subtitles.subtitleDeliveryFor(tracks[1]), "burned");
});

test("preference resolution honors title, global, server, forced, then Off precedence", function () {
  var store = new Subtitles.SubtitlePreferenceStore({ storage: memoryStorage() });
  var episodeOne = { id: "ep-1", type: "episode", raw: { grandparentRatingKey: "show-1" } };
  var episodeTwo = { id: "ep-2", type: "episode", raw: { grandparentRatingKey: "show-1" } };
  var showTracks = [
    { id: "en-1", languageCode: "en", forced: true, hearingImpaired: false },
    { id: "fr-1", languageCode: "fr", forced: false, hearingImpaired: false, selected: true }
  ];
  store.rememberSelection(context("alice", "server-a", episodeOne), showTracks[0]);

  var movie = { id: "movie-2", type: "movie", raw: {} };
  store.rememberSelection(context("alice", "server-a", movie), { id: "de-1", languageCode: "de" });
  var nextEpisodeTracks = [
    { id: "en-2", languageCode: "en", forced: true, hearingImpaired: false },
    { id: "de-2", languageCode: "de", forced: false, hearingImpaired: false }
  ];
  assert.equal(store.resolveSelection(context("alice", "server-a", episodeTwo), nextEpisodeTracks).id, "en-2");
  assert.equal(store.resolveSelection(context("alice", "server-a", episodeOne), showTracks).id, "en-1");

  var otherMovie = { id: "movie-3", type: "movie", raw: {} };
  assert.equal(store.resolveSelection(context("alice", "server-a", otherMovie), nextEpisodeTracks).id, "de-2");

  var fresh = new Subtitles.SubtitlePreferenceStore({ storage: memoryStorage() });
  assert.equal(fresh.resolveSelection(context("alice", "server-a", movie), [{ id: "server", selected: true }]).id, "server");
  assert.equal(fresh.resolveSelection(context("alice", "server-a", movie), [{ id: "forced", forced: true }], Subtitles.OFF_TRACK).id, "off");
  assert.equal(fresh.resolveSelection(context("alice", "server-a", movie), [{ id: "forced", forced: true }]).id, "forced");
  assert.equal(fresh.resolveSelection(context("alice", "server-a", movie), []).id, "off");
});

test("title choices are isolated by identity and server and exact episode IDs do not leak", function () {
  var store = new Subtitles.SubtitlePreferenceStore({ storage: memoryStorage() });
  var episode = { id: "ep-1", type: "episode", raw: { grandparentRatingKey: "series" } };
  store.rememberSelection(context("alice", "server-a", episode), {
    id: "exact-11", languageCode: "en", forced: false, hearingImpaired: true
  });
  var sameItem = [
    { id: "semantic", languageCode: "en", forced: false, hearingImpaired: true },
    { id: "exact-11", languageCode: "fr", forced: false, hearingImpaired: false }
  ];
  assert.equal(store.resolveSelection(context("alice", "server-a", episode), sameItem).id, "exact-11");

  var nextEpisode = { id: "ep-2", type: "episode", raw: { grandparentRatingKey: "series" } };
  assert.equal(store.resolveSelection(context("alice", "server-a", nextEpisode), sameItem).id, "semantic");
  assert.notEqual(
    Subtitles.subtitleTitleScopeKey(context("alice", "server-a", episode)),
    Subtitles.subtitleTitleScopeKey(context("bob", "server-a", episode))
  );
  assert.notEqual(
    Subtitles.subtitleTitleScopeKey(context("alice", "server-a", episode)),
    Subtitles.subtitleTitleScopeKey(context("alice", "server-b", episode))
  );
});

test("Off, appearance, search language, and sync survive storage round trips", function () {
  var storage = memoryStorage();
  var store = new Subtitles.SubtitlePreferenceStore({ storage: storage });
  var movie = { id: "movie", type: "movie" };
  store.rememberSelection(context("alice", "server", movie), Subtitles.OFF_TRACK);
  store.setSearchLanguage("fra");
  store.setAppearance({ fontSize: 80, bold: true, backgroundOpacity: 0.333 });
  store.setSyncOffset(60149);

  var restored = new Subtitles.SubtitlePreferenceStore({ storage: storage });
  assert.equal(restored.resolveSelection(context("alice", "server", movie), [{ id: "1", selected: true }]).id, "off");
  assert.equal(restored.getSearchLanguage(), "fr");
  assert.equal(restored.getAppearance().fontSize, 80);
  assert.equal(restored.getAppearance().bold, true);
  assert.equal(restored.getAppearance().backgroundOpacity, 0.33);
  assert.equal(restored.getSyncOffset(), 60000);
  assert.equal(restored.setSyncOffset(-60051), -60000);
});

test("malformed subtitle storage recovers without touching identity storage", function () {
  var storage = memoryStorage({
    "plezy-tv-subtitles-v1": "{not-json",
    "plezy-tv-identities-v3": "identity-data"
  });
  var store = new Subtitles.SubtitlePreferenceStore({ storage: storage });
  assert.deepEqual(store.getAppearance(), Subtitles.DEFAULT_APPEARANCE);
  assert.equal(store.getSyncOffset(), 0);
  assert.equal(storage.getItem("plezy-tv-identities-v3"), "identity-data");
});

test("cue markup is converted into safe text and whitelisted formatting runs", function () {
  var value = '<b>Hello &amp; goodbye</b><br><i>safe</i><img src=x onerror="bad">' +
    '<script>alert(1)</script>{\\an8}\\N&lt;literal&gt;';
  assert.equal(Subtitles.sanitizeCueText(value), "Hello & goodbye\nsafealert(1)\n<literal>");
  var runs = Subtitles.parseCueMarkup(value);
  assert.equal(runs[0].bold, true);
  assert.equal(runs.some(function (run) { return run.italic && run.text === "safe"; }), true);
  assert.equal(runs.some(function (run) { return /onerror|<script|<img/.test(run.text); }), false);
});

test("SRT, WebVTT, and ASS cue files parse into millisecond timing", function () {
  var srt = "1\r\n00:00:01,250 --> 00:00:03,500\r\n<b>Hello</b>\r\n\r\n" +
    "2\r\n00:04.000 --> 00:05.100 position:50%\r\nWorld\r\n";
  assert.deepEqual(Subtitles.parseSubtitleCues(srt, "srt"), [
    { startMs: 1250, endMs: 3500, text: "<b>Hello</b>" },
    { startMs: 4000, endMs: 5100, text: "World" }
  ]);
  var vtt = "WEBVTT\n\ncue-one\n00:00:06.000 --> 00:00:07.250 align:center\nVTT cue\n";
  assert.deepEqual(Subtitles.parseCues(vtt, "webvtt"), [
    { startMs: 6000, endMs: 7250, text: "VTT cue" }
  ]);
  var ass = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
    "Dialogue: 0,0:00:08.10,0:00:09.25,Default,,0,0,0,,{\\i1}ASS, cue{\\i0}";
  assert.deepEqual(Subtitles.parseSubtitleCues(ass, "ass"), [
    { startMs: 8100, endMs: 9250, text: "{\\i1}ASS, cue{\\i0}" }
  ]);
});

test("cue timing clamps offsets and detects synchronized cue windows", function () {
  assert.deepEqual(Subtitles.cueTiming(1000, 2500, 550), { startMs: 1600, endMs: 3100 });
  assert.deepEqual(Subtitles.cueTiming(1000, 2500, -999999), { startMs: 0, endMs: 0 });
  assert.equal(Subtitles.cueIsActive({ startMs: 1000, endMs: 2000 }, 6500, 5500), true);
  assert.equal(Subtitles.cueIsActive({ startMs: 1000, endMs: 2000 }, 6499, 5500), false);
});

test("cue scheduler rejects stale hide callbacks", function () {
  var callbacks = [];
  var visible = "";
  var scheduler = new Subtitles.CueScheduler({
    setTimeout: function (callback) { callbacks.push(callback); return callbacks.length - 1; },
    clearTimeout: function () { /* Keep callbacks so the revision guard is exercised. */ }
  });
  scheduler.showFor(1000, function () { visible = "first"; }, function () { visible = ""; });
  scheduler.showFor(1000, function () { visible = "second"; }, function () { visible = ""; });
  callbacks[0]();
  assert.equal(visible, "second");
  callbacks[1]();
  assert.equal(visible, "");
});

test("player focus transitions retain transport seeking and expose the action row", function () {
  assert.deepEqual(Subtitles.playerFocusTransition("transport", "left", 0), {
    mode: "transport", rowIndex: 0, action: "seek-back"
  });
  assert.deepEqual(Subtitles.playerFocusTransition("transport", "down", 0), {
    mode: "row", rowIndex: 0, action: "focus-row"
  });
  assert.equal(Subtitles.playerFocusTransition("row", "right", 0).rowIndex, 1);
  assert.equal(Subtitles.playerFocusTransition("row", "up", 1).mode, "transport");
  assert.equal(Subtitles.playerFocusTransition("panel", "down", 1).action, "move-panel");
});
