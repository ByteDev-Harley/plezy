"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Api = require("../js/api.js");

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status === undefined ? 200 : status,
    headers: { "Content-Type": "application/json" }
  });
}

function plexFixture(protectedUser, serverId) {
  serverId = serverId === undefined ? "server-1" : serverId;
  return {
    account: { id: "account", provider: "plex", token: "parent-token" },
    identity: {
      id: "identity",
      provider: "plex",
      plexAccountId: "account",
      name: "Kid",
      identityToken: "cached-home-token",
      protected: Boolean(protectedUser),
      homeUser: { uuid: "home-user", title: "Kid", protected: Boolean(protectedUser) }
    },
    connection: serverId ? {
      id: "connection",
      identityId: "identity",
      provider: "plex",
      name: "Plex Server",
      serverId: serverId,
      session: {
        provider: "plex",
        token: "cached-server-token",
        identityToken: "cached-home-token",
        baseUrl: "https://cached-server.example",
        server: { id: serverId, name: "Plex Server" }
      }
    } : null
  };
}

function plexResource(id, token, baseUrl) {
  return {
    clientIdentifier: id,
    name: "Server " + id,
    provides: "server",
    owned: true,
    accessToken: token,
    connections: [{ uri: baseUrl, protocol: "https", local: true }]
  };
}

test("Plex Home discovery uses the clients v2 endpoint, parent token, stable Samsung metadata, and JSON users", async function () {
  var originalFetch = global.fetch;
  var requests = [];
  global.fetch = async function (url, options) {
    requests.push({ url: String(url), headers: options.headers });
    return json({ data: { users: [
      { id: 10, uuid: "owner", title: "Owner", protected: false, admin: true },
      { id: 11, uuid: "kid", title: "Kid", protected: "1" }
    ] } });
  };
  try {
    var client = new Api.PlexClient({ accountToken: "parent", identityToken: "child" });
    var first = await client.getHomeUsers();
    var second = await client.getHomeUsers();
    assert.deepEqual(first.map(function (user) { return [user.id, user.uuid, user.protected]; }), [["10", "owner", false], ["11", "kid", true]]);
    assert.equal(second.length, 2);
    requests.forEach(function (request) {
      assert.equal(request.url, "https://clients.plex.tv/api/v2/home/users");
      assert.equal(request.headers["X-Plex-Token"], "parent");
      assert.equal(request.headers["X-Plex-Product"], "Plezy TV");
      assert.equal(request.headers["X-Plex-Platform"], "Tizen");
      assert.equal(request.headers["X-Plex-Version"], "2.10.5-samsung.9");
    });
    assert.ok(requests[0].headers["X-Plex-Client-Identifier"]);
    assert.equal(requests[0].headers["X-Plex-Client-Identifier"], requests[1].headers["X-Plex-Client-Identifier"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Home switching accepts a 201 JSON response and sends PIN plus all include parameters", async function () {
  var originalFetch = global.fetch;
  var seen;
  global.fetch = async function (url, options) {
    seen = { url: new URL(String(url)), options: options };
    return json({ data: { user: { authToken: "derived-token" } } }, 201);
  };
  try {
    var client = new Api.PlexClient({ accountToken: "parent-token" });
    var switched = await client.switchHomeUser("kid uuid", "1234");
    assert.equal(seen.url.origin + seen.url.pathname, "https://clients.plex.tv/api/v2/home/users/kid%20uuid/switch");
    assert.equal(seen.options.method, "POST");
    assert.equal(seen.options.headers["X-Plex-Token"], "parent-token");
    assert.equal(seen.options.headers["X-Plex-Product"], "Plezy TV");
    assert.equal(seen.options.headers["X-Plex-Platform"], "Tizen");
    assert.equal(seen.options.headers["X-Plex-Version"], "2.10.5-samsung.9");
    assert.ok(seen.options.headers["X-Plex-Client-Identifier"]);
    assert.equal(seen.url.searchParams.get("pin"), "1234");
    ["includeSubscriptions", "includeProviders", "includeSettings", "includeSharedSettings"].forEach(function (name) {
      assert.equal(seen.url.searchParams.get(name), "1");
    });
    assert.equal(switched.token, "derived-token");
    assert.equal(client.identityToken, "derived-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("switching preserves PIN-specific 401/403 errors but reports 404 and missing-token responses normally", async function () {
  var originalFetch = global.fetch;
  var responses = [json({ error: "bad pin" }, 401), json({ error: "gone" }, 404), json({ user: {} }, 201)];
  global.fetch = async function () { return responses.shift(); };
  try {
    var client = new Api.PlexClient({ accountToken: "parent" });
    await assert.rejects(client.switchHomeUser("kid", "1111"), function (error) {
      return error.status === 401 && error.code === "PLEX_PIN_INVALID" && error.isPinError === true;
    });
    await assert.rejects(client.switchHomeUser("kid", "1111"), function (error) {
      return error.status === 404 && !error.isPinError && error.message === "gone";
    });
    await assert.rejects(client.switchHomeUser("kid", "1111"), /did not return a Home-user token/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("selecting an unprotected Plex identity always refreshes its token and reconnects the last server", async function () {
  var originalFetch = global.fetch;
  var requests = [];
  global.fetch = async function (url, options) {
    var value = String(url);
    requests.push({ url: value, token: options.headers["X-Plex-Token"] });
    if (value.includes("/switch?")) return json({ authToken: "fresh-home-token" }, 201);
    if (value.includes("/resources?")) return json([plexResource("server-1", "fresh-server-token", "https://fresh.example")]);
    if (value.includes("fresh.example/library/sections")) return json({ MediaContainer: { Directory: [] } });
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixture = plexFixture(false);
    var result = await Api.activateIdentity(fixture.identity, fixture.connection, fixture.account);
    assert.equal(result.ok, true);
    assert.equal(result.identity.identityToken, "fresh-home-token");
    assert.equal(result.connection.serverId, "server-1");
    assert.equal(result.client.token, "fresh-server-token");
    assert.equal(result.session.accountToken, undefined);
    assert.equal(requests.some(function (request) { return request.url.includes("cached-server.example"); }), false);
    assert.equal(requests[0].token, "parent-token");
    assert.equal(requests[1].token, "fresh-home-token");
    assert.equal(requests[2].token, "fresh-server-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a protected identity retries an invalid PIN and keeps the input identity unchanged", async function () {
  var originalFetch = global.fetch;
  var prompts = [];
  global.fetch = async function (url) {
    var value = String(url);
    var parsed = new URL(value);
    if (value.includes("/switch?")) {
      if (parsed.searchParams.get("pin") === "1111") return json({ error: "bad pin" }, 403);
      return json({ user: { authenticationToken: "protected-home" } }, 201);
    }
    if (value.includes("/resources?")) return json([plexResource("server-1", "protected-server", "https://protected.example")]);
    if (value.includes("protected.example/library/sections")) return json({ MediaContainer: { Directory: [] } });
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixture = plexFixture(true);
    var originalIdentity = JSON.parse(JSON.stringify(fixture.identity));
    var result = await Api.activateIdentity(fixture.identity, fixture.connection, fixture.account, {
      requestPin: function (_, error) {
        prompts.push(error && error.code || "initial");
        return prompts.length === 1 ? "1111" : "2222";
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(prompts, ["initial", "PLEX_PIN_INVALID"]);
    assert.equal(result.identity.identityToken, "protected-home");
    assert.deepEqual(fixture.identity, originalIdentity);
  } finally {
    global.fetch = originalFetch;
  }
});

test("missing and unavailable last servers are delegated to the server picker", async function () {
  var originalFetch = global.fetch;
  var reasons = [];
  var switchCount = 0;
  global.fetch = async function (url) {
    var value = String(url);
    if (value.includes("/switch?")) { switchCount += 1; return json({ authToken: "home-" + switchCount }, 201); }
    if (value.includes("/resources?")) return json([plexResource("available", "server-token", "https://available.example")]);
    if (value.includes("available.example/library/sections")) return json({ MediaContainer: { Directory: [] } });
    throw new Error("Unexpected URL " + value);
  };
  try {
    var missing = plexFixture(false, "");
    var missingResult = await Api.activateIdentity(missing.identity, null, missing.account, {
      chooseServer: function (servers, _, reason) { reasons.push(reason); return servers[0]; }
    });
    assert.equal(missingResult.ok, true);

    var unavailable = plexFixture(false, "gone");
    var unavailableResult = await Api.activateIdentity(unavailable.identity, unavailable.connection, unavailable.account, {
      chooseServer: function (_, __, reason) { reasons.push(reason); return "available"; }
    });
    assert.equal(unavailableResult.ok, true);
    assert.equal(unavailableResult.connection.id, undefined);
    assert.equal(unavailableResult.connection.serverId, "available");
    assert.deepEqual(reasons, ["required", "unavailable"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("activation reports a recoverable server requirement when no picker is supplied", async function () {
  var originalFetch = global.fetch;
  global.fetch = async function (url) {
    if (String(url).includes("/switch?")) return json({ authToken: "home" }, 201);
    return json([plexResource("server", "token", "https://server.example")]);
  };
  try {
    var fixture = plexFixture(false, "");
    var result = await Api.activateIdentity(fixture.identity, null, fixture.account);
    assert.equal(result.ok, false);
    assert.equal(result.recoverable, true);
    assert.equal(result.error.code, "PLEX_SERVER_REQUIRED");
  } finally {
    global.fetch = originalFetch;
  }
});

test("an expired freshly discovered server token renews the Home identity once", async function () {
  var originalFetch = global.fetch;
  var switchCalls = 0;
  var resourceCalls = 0;
  global.fetch = async function (url) {
    var value = String(url);
    if (value.includes("/switch?")) {
      switchCalls += 1;
      return json({ authToken: "home-" + switchCalls }, 201);
    }
    if (value.includes("/resources?")) {
      resourceCalls += 1;
      return json([plexResource("server-1", "server-" + resourceCalls, "https://renew.example")]);
    }
    if (value.includes("renew.example/library/sections")) {
      return resourceCalls === 1 ? json({ error: "expired" }, 401) : json({ MediaContainer: { Directory: [] } });
    }
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixture = plexFixture(false);
    var result = await Api.activateIdentity(fixture.identity, fixture.connection, fixture.account);
    assert.equal(result.ok, true);
    assert.equal(switchCalls, 2);
    assert.equal(resourceCalls, 2);
    assert.equal(result.identity.identityToken, "home-2");
    assert.equal(result.client.token, "server-2");
  } finally {
    global.fetch = originalFetch;
  }
});

test("an authorization failure during server discovery re-mints the Home identity once", async function () {
  var originalFetch = global.fetch;
  var switchCalls = 0;
  var resourceCalls = 0;
  global.fetch = async function (url) {
    var value = String(url);
    if (value.includes("/switch?")) {
      switchCalls += 1;
      return json({ authToken: "home-" + switchCalls }, 201);
    }
    if (value.includes("/resources?")) {
      resourceCalls += 1;
      if (resourceCalls === 1) return json({ error: "expired home token" }, 401);
      return json([plexResource("server-1", "server-token", "https://discovery-renew.example")]);
    }
    if (value.includes("discovery-renew.example/library/sections")) {
      return json({ MediaContainer: { Directory: [] } });
    }
    throw new Error("Unexpected URL " + value);
  };
  try {
    var fixture = plexFixture(false);
    var result = await Api.activateIdentity(fixture.identity, fixture.connection, fixture.account);
    assert.equal(result.ok, true);
    assert.equal(switchCalls, 2);
    assert.equal(resourceCalls, 2);
    assert.equal(result.identity.identityToken, "home-2");
  } finally {
    global.fetch = originalFetch;
  }
});

test("cancelling protected activation does not switch or mutate the saved context", async function () {
  var originalFetch = global.fetch;
  var requests = 0;
  global.fetch = async function () { requests += 1; return json({}); };
  try {
    var fixture = plexFixture(true);
    var originalIdentity = JSON.parse(JSON.stringify(fixture.identity));
    var originalConnection = JSON.parse(JSON.stringify(fixture.connection));
    var result = await Api.activateIdentity(fixture.identity, fixture.connection, fixture.account, {
      requestPin: function () { return null; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.cancelled, true);
    assert.equal(requests, 0);
    assert.deepEqual(fixture.identity, originalIdentity);
    assert.deepEqual(fixture.connection, originalConnection);
  } finally {
    global.fetch = originalFetch;
  }
});

test("independent Jellyfin identities keep validation and watch-state tokens isolated", async function () {
  var originalFetch = global.fetch;
  var requests = [];
  global.fetch = async function (url, options) {
    requests.push({ url: String(url), authorization: options.headers.Authorization, body: options.body || "" });
    if (String(url).includes("/Views")) return json({ Items: [] });
    return new Response("", { status: 204 });
  };
  try {
    function fixture(id) {
      var session = { provider: "jellyfin", token: "token-" + id, baseUrl: "https://jf.example", userId: "user-" + id, server: { name: id } };
      return {
        identity: { id: "identity-" + id, provider: "jellyfin", name: id, token: session.token, baseUrl: session.baseUrl, userId: session.userId, session: session },
        connection: { id: "connection-" + id, identityId: "identity-" + id, provider: "jellyfin", session: session }
      };
    }
    var one = fixture("one");
    var two = fixture("two");
    var first = await Api.activateIdentity(one.identity, one.connection, one.identity);
    var second = await Api.activateIdentity(two.identity, two.connection, two.identity);
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
