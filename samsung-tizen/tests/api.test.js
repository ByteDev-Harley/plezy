"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Api = require("../js/api.js");

test("URL helpers normalize slashes and encode query values", function () {
  assert.equal(Api.joinUrl("https://server.example/", "/library/sections"), "https://server.example/library/sections");
  assert.equal(
    Api.withQuery("https://server.example/search", { query: "Alien & Aliens", limit: 20 }),
    "https://server.example/search?query=Alien%20%26%20Aliens&limit=20"
  );
});

test("Plex connection selection prefers local HTTPS, then local HTTP", function () {
  var selected = Api.choosePlexConnection([
    { uri: "https://relay.example", protocol: "https", local: false, relay: true },
    { uri: "http://192.168.1.10:32400", protocol: "http", local: true, relay: false },
    { uri: "https://plex.direct:32400", protocol: "https", local: true, relay: false }
  ]);
  assert.equal(selected.uri, "https://plex.direct:32400");
});

test("Plex server discovery lists owned servers before shared servers and preserves the account token", async function () {
  var originalFetch = global.fetch;
  var authorization = "";
  global.fetch = async function (_, options) {
    authorization = options.headers["X-Plex-Token"];
    return new Response(JSON.stringify([
      {
        clientIdentifier: "shared-1",
        name: "Shared Library",
        owned: false,
        provides: "server",
        accessToken: "shared-token",
        connections: [{ uri: "https://shared.example", protocol: "https", local: false }]
      },
      {
        clientIdentifier: "owned-1",
        name: "My Server",
        owned: true,
        provides: "server",
        accessToken: "owned-token",
        connections: [{ uri: "https://owned.example", protocol: "https", local: true }]
      }
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    var client = new Api.PlexClient({ token: "server-token", accountToken: "account-token" });
    var servers = await client.getServers();
    assert.deepEqual(servers.map(function (server) { return server.name; }), ["My Server", "Shared Library"]);
    assert.equal(authorization, "account-token");
    client.connect(servers[1]);
    assert.equal(client.toSession().accountToken, "account-token");
    assert.deepEqual(client.toSession().servers.map(function (server) { return server.id; }), ["owned-1", "shared-1"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Plex TV linking requests and returns a four-character code", async function () {
  var originalFetch = global.fetch;
  var requestUrl = "";
  global.fetch = async function (url) {
    requestUrl = String(url);
    return new Response(JSON.stringify({ id: 12345, code: "a1b2" }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    var pin = await new Api.PlexClient().createPin();
    assert.equal(requestUrl, "https://plex.tv/api/v2/pins");
    assert.equal(pin.id, 12345);
    assert.equal(pin.code, "A1B2");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Plex TV linking rejects a strong-flow long code", async function () {
  var originalFetch = global.fetch;
  global.fetch = async function () {
    return new Response(JSON.stringify({ id: 12345, code: "8lzjqnq8lye02n52jq3fqxf8e" }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    await assert.rejects(
      new Api.PlexClient().createPin(),
      /four-character TV link code/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Plex metadata is normalized for ten-foot UI cards", function () {
  var client = new Api.PlexClient({ baseUrl: "https://plex.example", token: "secret" });
  var item = client._item({
    ratingKey: "42",
    type: "episode",
    title: "The Test",
    grandparentTitle: "Example Show",
    parentTitle: "Season 1",
    index: 3,
    duration: 1800000,
    viewOffset: 450000,
    thumb: "/library/metadata/42/thumb/1"
  });
  assert.equal(item.id, "42");
  assert.equal(item.playable, true);
  assert.equal(item.progress, 0.25);
  assert.match(item.subtitle, /Example Show/);
  assert.match(item.thumb, /X-Plex-Token=secret/);
});

test("show play-next prefers a resumable episode, then the first unplayed episode", function () {
  var client = new Api.PlexClient({ baseUrl: "https://plex.example", token: "secret" });
  var watched = client._item({ ratingKey: "1", type: "episode", title: "Pilot", duration: 1800000, viewCount: 1 });
  var unplayed = client._item({ ratingKey: "2", type: "episode", title: "Second", duration: 1800000 });
  var partial = client._item({ ratingKey: "3", type: "episode", title: "Third", duration: 1800000, viewOffset: 420000 });
  assert.equal(Api.chooseUpNext([watched, unplayed, partial]).id, "3");
  assert.equal(Api.chooseUpNext([watched, unplayed]).id, "2");
});

test("Plex show play-next uses allLeaves and returns the first unwatched episode", async function () {
  var originalFetch = global.fetch;
  var requestUrl = "";
  global.fetch = async function (url) {
    requestUrl = String(url);
    return new Response(JSON.stringify({ MediaContainer: { Metadata: [
      { ratingKey: "21", type: "episode", title: "Pilot", parentIndex: 1, index: 1, viewCount: 1 },
      { ratingKey: "22", type: "episode", title: "Next", parentIndex: 1, index: 2 }
    ] } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    var client = new Api.PlexClient({ baseUrl: "https://plex.example", token: "secret" });
    var next = await client.getShowUpNext("show-7");
    assert.match(requestUrl, /library\/metadata\/show-7\/allLeaves/);
    assert.equal(next.id, "22");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Plex playback produces Samsung-compatible authenticated HLS and direct-play fallbacks", async function () {
  var client = new Api.PlexClient({ baseUrl: "https://plex.example", token: "token value" });
  var item = client._item({
    ratingKey: "7",
    type: "movie",
    title: "Example",
    duration: 7200000,
    viewOffset: 120000,
    Media: [{ Part: [{ key: "/library/parts/77/file.mkv" }] }]
  });
  var playback = await client.createPlayback(item);
  assert.match(playback.url, /start\.m3u8/);
  assert.match(playback.url, /offset=120/);
  assert.match(playback.url, /directPlay=0/);
  assert.match(playback.url, /videoResolution=1920x1080/);
  assert.match(playback.url, /subtitles=burn/);
  assert.match(playback.url, /X-Plex-Client-Profile-Extra=/);
  assert.match(decodeURIComponent(playback.url), /container=mpegts/);
  assert.match(playback.url, /X-Plex-Token=token%20value/);
  assert.match(playback.directUrl, /library\/parts\/77\/file\.mkv/);
});

test("Plex home falls back when the server does not implement the hubs endpoints", async function () {
  var originalFetch = global.fetch;
  var urls = [];
  global.fetch = async function (url) {
    urls.push(String(url));
    if (String(url).includes("/hubs/home") || String(url).includes("/hubs?")) {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (String(url).includes("/library/onDeck")) {
      return new Response(JSON.stringify({
        MediaContainer: { Metadata: [{ ratingKey: "11", type: "movie", title: "Continue Me" }] }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      MediaContainer: { Metadata: [{ ratingKey: "12", type: "movie", title: "New Movie" }] }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    var client = new Api.PlexClient({ baseUrl: "https://plex.example", token: "secret" });
    var shelves = await client.getHome();
    assert.deepEqual(shelves.map(function (shelf) { return shelf.title; }), ["Continue Watching", "Recently Added"]);
    assert.equal(shelves[0].items[0].title, "Continue Me");
    assert.equal(shelves[1].items[0].title, "New Movie");
    assert.ok(urls.some(function (url) { return url.includes("/library/onDeck"); }));
    assert.ok(urls.some(function (url) { return url.includes("/library/recentlyAdded"); }));
  } finally {
    global.fetch = originalFetch;
  }
});

test("Jellyfin metadata and playback URLs use ticks and access token", async function () {
  var client = new Api.JellyfinClient({
    baseUrl: "https://jellyfin.example/",
    token: "jf-token",
    userId: "user-1"
  });
  var item = client._item({
    Id: "movie-9",
    Name: "Movie Nine",
    Type: "Movie",
    RunTimeTicks: 600000000,
    UserData: { PlaybackPositionTicks: 300000000 },
    MediaSources: [{ Id: "source-1" }]
  });
  assert.equal(item.durationMs, 60000);
  assert.equal(item.resumeMs, 30000);
  assert.equal(item.progress, 0.5);
  var playback = await client.createPlayback(item);
  assert.match(playback.url, /master\.m3u8/);
  assert.match(playback.url, /api_key=jf-token/);
  assert.match(playback.url, /StartTimeTicks=300000000/);
  assert.match(playback.directUrl, /static=true/);
});

test("Jellyfin show play-next returns the first unplayed episode in series order", async function () {
  var originalFetch = global.fetch;
  var requestUrl = "";
  global.fetch = async function (url) {
    requestUrl = String(url);
    return new Response(JSON.stringify({ Items: [
      { Id: "jf-1", Name: "Pilot", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 1, UserData: { Played: true } },
      { Id: "jf-2", Name: "Next", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 2, UserData: { Played: false } }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    var client = new Api.JellyfinClient({ baseUrl: "https://jf.example", token: "token", userId: "user" });
    var next = await client.getShowUpNext("series-1");
    assert.match(requestUrl, /Shows\/series-1\/Episodes/);
    assert.match(requestUrl, /SortBy=ParentIndexNumber%2CIndexNumber/);
    assert.equal(next.id, "jf-2");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Jellyfin rejects malformed server addresses as a promise", async function () {
  await assert.rejects(
    Api.JellyfinClient.authenticate("media.example.com", "user", "password"),
    /must start with http:\/\//
  );
});

test("Jellyfin reports playback start before progress and stop", async function () {
  var originalFetch = global.fetch;
  var urls = [];
  global.fetch = async function (url) {
    urls.push(String(url));
    return new Response("", { status: 204 });
  };
  try {
    var client = new Api.JellyfinClient({ baseUrl: "https://jf.example", token: "token", userId: "user" });
    var playback = { item: { id: "item" }, sessionId: "session", mediaSourceId: "source" };
    await client.reportProgress(playback, 30000, "playing");
    await client.reportProgress(playback, 40000, "playing");
    await client.reportProgress(playback, 50000, "stopped");
    assert.match(urls[0], /\/Sessions\/Playing$/);
    assert.match(urls[1], /\/Sessions\/Playing\/Progress$/);
    assert.match(urls[2], /\/Sessions\/Playing\/Stopped$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("session factories reconstruct the correct provider", function () {
  assert.equal(Api.clientFromSession({ provider: "plex" }).provider, "plex");
  assert.equal(Api.clientFromSession({ provider: "jellyfin" }).provider, "jellyfin");
  assert.equal(Api.clientFromSession({ provider: "unknown" }), null);
});
