"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Api = require("../js/api.js");

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function plexFixtures(protectedUser) {
  return {
    profile: { id: "profile", name: "Viewer" },
    account: { id: "account", provider: "plex", token: "parent-token" },
    binding: {
      id: "binding",
      profileId: "profile",
      accountId: "account",
      provider: "plex",
      name: "Plex Server",
      identityToken: "expired-home-token",
      protected: Boolean(protectedUser),
      homeUser: { uuid: "home-user", title: "Kid", protected: Boolean(protectedUser) },
      serverId: "server-1",
      session: {
        provider: "plex",
        token: "expired-server-token",
        identityToken: "expired-home-token",
        baseUrl: "https://old-server.example",
        server: { id: "server-1", name: "Plex Server" }
      }
    }
  };
}

test("Plex Home discovery normalizes users and uses only the linked account credential", async function () {
  var originalFetch = global.fetch;
  var seenToken = "";
  global.fetch = async function (url, options) {
    assert.equal(String(url), "https://plex.tv/api/home/users");
    seenToken = options.headers["X-Plex-Token"];
    return json({ MediaContainer: { User: [
      { uuid: "owner", title: "Owner", protected: false, admin: true },
      { uuid: "kid", title: "Kid", protected: "1" }
    ] } });
  };
  try {
    var users = await new Api.PlexClient({ accountToken: "parent", identityToken: "child" }).getHomeUsers();
    assert.equal(seenToken, "parent");
    assert.deepEqual(users.map(function (user) { return [user.uuid, user.protected]; }), [["owner", false], ["kid", true]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Plex Home XML payloads remain compatible with the legacy endpoint", function () {
  var users = Api.normalizeHomeUsers('<MediaContainer><User uuid="one" title="One" protected="0"/><User uuid="two" title="Two" protected="1"/></MediaContainer>');
  assert.deepEqual(users.map(function (user) { return user.title; }), ["One", "Two"]);
  assert.equal(users[1].protected, true);
});

test("Plex Home switching posts the provider PIN and exposes incorrect-PIN errors", async function () {
  var originalFetch = global.fetch;
  var calls = 0;
  global.fetch = async function (url, options) {
    calls += 1;
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-Plex-Token"], "parent-token");
    assert.match(String(url), /home\/users\/kid\/switch\?pin=1234/);
    if (calls === 1) return json({ error: "bad pin" }, 401);
    return json({ authToken: "derived-token" });
  };
  try {
    var client = new Api.PlexClient({ accountToken: "parent-token" });
    await assert.rejects(client.switchHomeUser("kid", "1234"), function (error) {
      return error.code === "PLEX_PIN_INVALID" && error.isPinError === true;
    });
    var switched = await client.switchHomeUser("kid", "1234");
    assert.equal(switched.token, "derived-token");
    assert.equal(client.identityToken, "derived-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("derived Home identity discovers servers while media browsing uses the server token, never the parent token", async function () {
  var originalFetch = global.fetch;
  var requests = [];
  global.fetch = async function (url, options) {
    requests.push({ url: String(url), token: options.headers["X-Plex-Token"] });
    if (String(url).includes("/resources?")) {
      return json([{
        clientIdentifier: "server-1",
        name: "Server",
        provides: "server",
        accessToken: "server-token",
        connections: [{ uri: "https://server.example", protocol: "https", local: true }]
      }]);
    }
    return json({ MediaContainer: { Directory: [] } });
  };
  try {
    var client = new Api.PlexClient({ accountToken: "parent-token", identityToken: "home-token" });
    var servers = await client.getServers();
    client.connect(servers[0]);
    await client.getLibraries();
    assert.equal(requests[0].token, "home-token");
    assert.equal(requests[1].token, "server-token");
    assert.equal(requests.some(function (request) {
      return request.url.includes("server.example") && request.token === "parent-token";
    }), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("an expired unprotected Plex binding silently mints a fresh token and retries discovery once", async function () {
  var originalFetch = global.fetch;
  var switchCalls = 0;
  var discoveryCalls = 0;
  var requests = [];
  global.fetch = async function (url, options) {
    var value = String(url);
    var token = options.headers["X-Plex-Token"];
    requests.push({ url: value, token: token });
    if (value.includes("old-server.example/library/sections")) return json({ error: "expired" }, 401);
    if (value.includes("/home/users/home-user/switch")) {
      switchCalls += 1;
      return json({ authToken: switchCalls === 1 ? "home-token-1" : "home-token-2" });
    }
    if (value.includes("/resources?")) {
      discoveryCalls += 1;
      if (discoveryCalls === 1) return json({ error: "retry" }, 401);
      return json([{
        clientIdentifier: "server-1",
        name: "Plex Server",
        provides: "server",
        accessToken: "fresh-server-token",
        connections: [{ uri: "https://fresh-server.example", protocol: "https", local: true }]
      }]);
    }
    if (value.includes("fresh-server.example/library/sections")) return json({ MediaContainer: { Directory: [] } });
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixtures = plexFixtures(false);
    var result = await Api.activateConnection(fixtures.profile, fixtures.binding, fixtures.account);
    assert.equal(result.ok, true);
    assert.equal(switchCalls, 2);
    assert.equal(discoveryCalls, 2);
    assert.equal(result.binding.identityToken, "home-token-2");
    assert.equal(result.client.token, "fresh-server-token");
    assert.equal(result.session.accountToken, undefined);
    assert.ok(requests.some(function (request) { return request.url.includes("/resources?") && request.token === "home-token-2"; }));
  } finally {
    global.fetch = originalFetch;
  }
});

test("a valid unprotected Plex binding reuses its cached derived and server tokens", async function () {
  var originalFetch = global.fetch;
  var calls = [];
  global.fetch = async function (url, options) {
    calls.push({ url: String(url), token: options.headers["X-Plex-Token"] });
    return json({ MediaContainer: { Directory: [] } });
  };
  try {
    var fixtures = plexFixtures(false);
    var result = await Api.activateConnection(fixtures.profile, fixtures.binding, fixtures.account);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /old-server\.example\/library\/sections/);
    assert.equal(calls[0].token, "expired-server-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("protected activation prompts again after an incorrect PIN and succeeds with a fresh derived token", async function () {
  var originalFetch = global.fetch;
  var prompts = [];
  var cachedTokenRequests = 0;
  global.fetch = async function (url, options) {
    var value = String(url);
    if (value.includes("old-server.example/library/sections")) {
      cachedTokenRequests += 1;
      return json({ error: "expired" }, 401);
    }
    if (value.includes("/switch?pin=1111")) return json({ error: "bad pin" }, 401);
    if (value.includes("/switch?pin=2222")) return json({ authToken: "protected-home-token" });
    if (value.includes("/resources?")) {
      assert.equal(options.headers["X-Plex-Token"], "protected-home-token");
      return json([{
        clientIdentifier: "server-1",
        name: "Plex Server",
        provides: "server",
        accessToken: "protected-server-token",
        connections: [{ uri: "https://protected.example", protocol: "https", local: true }]
      }]);
    }
    if (value.includes("protected.example/library/sections")) return json({ MediaContainer: { Directory: [] } });
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixtures = plexFixtures(true);
    var result = await Api.activateConnection(fixtures.profile, fixtures.binding, fixtures.account, {
      requestPin: function (_, error) {
        prompts.push(error && error.code || "initial");
        return prompts.length === 1 ? "1111" : "2222";
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(prompts, ["initial", "PLEX_PIN_INVALID"]);
    assert.equal(cachedTokenRequests, 0);
    assert.equal(result.binding.identityToken, "protected-home-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("cancelling a protected Plex activation leaves the binding unchanged", async function () {
  var originalFetch = global.fetch;
  global.fetch = async function (url) {
    if (String(url).includes("library/sections")) return json({ error: "expired" }, 401);
    throw new Error("Switch should not run after cancellation");
  };
  try {
    var fixtures = plexFixtures(true);
    var originalBinding = JSON.parse(JSON.stringify(fixtures.binding));
    var result = await Api.activateConnection(fixtures.profile, fixtures.binding, fixtures.account, {
      requestPin: function () { return null; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.cancelled, true);
    assert.deepEqual(fixtures.binding, originalBinding);
  } finally {
    global.fetch = originalFetch;
  }
});

test("independent Jellyfin activations and watch-state writes retain their own users and tokens", async function () {
  var originalFetch = global.fetch;
  var requests = [];
  global.fetch = async function (url, options) {
    requests.push({ url: String(url), authorization: options.headers.Authorization, body: options.body || "" });
    if (String(url).includes("/Views")) return json({ Items: [] });
    return new Response("", { status: 204 });
  };
  try {
    function fixture(id) {
      return {
        profile: { id: "profile-" + id, name: id },
        account: { id: "account-" + id, provider: "jellyfin", token: "token-" + id, baseUrl: "https://jf.example", userId: "user-" + id },
        binding: {
          id: "binding-" + id,
          profileId: "profile-" + id,
          accountId: "account-" + id,
          provider: "jellyfin",
          session: { provider: "jellyfin", token: "token-" + id, baseUrl: "https://jf.example", userId: "user-" + id, server: { name: id } }
        }
      };
    }
    var one = fixture("one");
    var two = fixture("two");
    var first = await Api.activateConnection(one.profile, one.binding, one.account);
    var second = await Api.activateConnection(two.profile, two.binding, two.account);
    await first.client.reportProgress({ item: { id: "item-one" }, sessionId: "s1", mediaSourceId: "m1" }, 1000, "playing");
    await second.client.reportProgress({ item: { id: "item-two" }, sessionId: "s2", mediaSourceId: "m2" }, 2000, "playing");
    assert.ok(requests.some(function (request) { return request.url.includes("/Users/user-one/Views") && request.authorization.includes('Token="token-one"'); }));
    assert.ok(requests.some(function (request) { return request.url.includes("/Users/user-two/Views") && request.authorization.includes('Token="token-two"'); }));
    assert.ok(requests.some(function (request) { return request.body.includes("item-one") && request.authorization.includes('Token="token-one"'); }));
    assert.ok(requests.some(function (request) { return request.body.includes("item-two") && request.authorization.includes('Token="token-two"'); }));
  } finally {
    global.fetch = originalFetch;
  }
});
