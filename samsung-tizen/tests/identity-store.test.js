"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Identities = require("../js/identity-store.js");

function MemoryStorage(initial) {
  this.values = Object.assign({}, initial || {});
}
MemoryStorage.prototype.getItem = function (key) {
  return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
};
MemoryStorage.prototype.setItem = function (key, value) { this.values[key] = String(value); };
MemoryStorage.prototype.removeItem = function (key) { delete this.values[key]; };

function ids() {
  var value = 0;
  return function () { value += 1; return "id-" + value; };
}

function storeFor(storage, now) {
  return new Identities.IdentityStore({
    storage: storage,
    uuid: ids(),
    now: function () { return now === undefined ? 1700000000000 : now; }
  });
}

function plexSession(serverId, identityToken, serverToken) {
  return {
    provider: "plex",
    accountToken: "must-not-survive",
    identityToken: identityToken,
    token: serverToken,
    baseUrl: "https://" + serverId + ".example",
    server: { id: serverId, name: "Server " + serverId },
    servers: []
  };
}

function jellyfinSession(suffix) {
  return {
    provider: "jellyfin",
    token: "jf-token-" + suffix,
    baseUrl: "https://jf-" + suffix + ".example",
    userId: "jf-user-" + suffix,
    server: { id: "jf-server-" + suffix, name: "Jellyfin " + suffix, username: "Viewer " + suffix }
  };
}

test("v2 migration merges Plex Home servers, preserves Jellyfin, last identity, and global Nick Mode", function () {
  var v2 = {
    version: 2,
    profiles: [
      { id: "other", name: "Other", defaultConnectionId: "plex-one", nickMode: false, lastUsedAt: 10 },
      { id: "last", name: "Last", defaultConnectionId: "plex-duplicate", nickMode: true, lastUsedAt: 30 }
    ],
    accounts: [
      { id: "parent", provider: "plex", accountId: "42", name: "Family Plex", token: "parent-token" },
      { id: "parent-copy", provider: "plex", accountId: "42", name: "Family Plex duplicate", token: "parent-token" },
      { id: "jf-account", provider: "jellyfin", name: "Jules", token: "jf-token-one", baseUrl: "https://jf-one.example", userId: "jf-user-one", server: { id: "jf-server-one", name: "Jellyfin one" } }
    ],
    bindings: [
      { id: "plex-one", profileId: "other", accountId: "parent", provider: "plex", homeUser: { uuid: "home", title: "Kid" }, identityToken: "home-old", serverId: "one", session: plexSession("one", "home-old", "server-old"), lastUsedAt: 10 },
      { id: "plex-duplicate", profileId: "last", accountId: "parent-copy", provider: "plex", homeUser: { uuid: "home", title: "Kid", protected: true }, identityToken: "home-new", serverId: "one", session: plexSession("one", "home-new", "server-new"), lastUsedAt: 30 },
      { id: "plex-two", profileId: "last", accountId: "parent-copy", provider: "plex", homeUser: { uuid: "home", title: "Kid" }, identityToken: "home-new", serverId: "two", session: plexSession("two", "home-new", "server-two"), lastUsedAt: 20 },
      { id: "jf-binding", profileId: "other", accountId: "jf-account", provider: "jellyfin", name: "Jellyfin one", session: jellyfinSession("one"), lastUsedAt: 5 }
    ],
    lastProfileId: "last"
  };
  var storage = new MemoryStorage({
    "plezy-tv-profiles-v2": JSON.stringify(v2),
    "plezy-tv-session-v1": JSON.stringify({ provider: "plex", token: "older" })
  });
  var store = storeFor(storage);
  var document = store.migrate();

  assert.equal(document.version, 3);
  assert.equal(document.plexAccounts.length, 1);
  assert.equal(document.plexAccounts[0].token, "parent-token");
  assert.equal(document.identities.length, 2);
  assert.equal(document.nickMode, true);
  var plex = document.identities.filter(function (identity) { return identity.provider === "plex"; })[0];
  var jellyfin = document.identities.filter(function (identity) { return identity.provider === "jellyfin"; })[0];
  assert.equal(plex.key, "plex:parent:home");
  assert.equal(plex.identityToken, "home-new");
  assert.equal(plex.protected, true);
  assert.equal(document.lastIdentityId, plex.id);
  assert.equal(jellyfin.token, "jf-token-one");
  var plexConnections = document.connections.filter(function (connection) { return connection.identityId === plex.id; });
  assert.equal(plexConnections.length, 2);
  assert.equal(plexConnections.filter(function (connection) { return connection.serverId === "one"; })[0].session.token, "server-new");
  assert.equal(plexConnections.some(function (connection) { return connection.session.accountToken; }), false);
  assert.equal(plex.defaultConnectionId, plexConnections.filter(function (connection) { return connection.serverId === "one"; })[0].id);
  assert.equal(storage.getItem("plezy-tv-profiles-v2"), null);
  assert.equal(storage.getItem("plezy-tv-session-v1"), null);
  assert.ok(storage.getItem("plezy-tv-identities-v3"));
});

test("migration keeps v2 and v1 credentials when the v3 read-back cannot be verified", function () {
  var v2 = { version: 2, profiles: [], accounts: [], bindings: [] };
  var storage = new MemoryStorage({
    "plezy-tv-profiles-v2": JSON.stringify(v2),
    "plezy-tv-session-v1": JSON.stringify({ provider: "jellyfin", token: "legacy" })
  });
  var set = storage.setItem;
  storage.setItem = function (key, value) {
    set.call(this, key, key === "plezy-tv-identities-v3" ? "{broken" : value);
  };
  storeFor(storage).migrate();
  assert.ok(storage.getItem("plezy-tv-profiles-v2"));
  assert.ok(storage.getItem("plezy-tv-session-v1"));
});

test("malformed legacy storage is recoverable and is never overwritten during load", function () {
  var malformed = "{recover me";
  var v2Storage = new MemoryStorage({ "plezy-tv-profiles-v2": malformed });
  assert.deepEqual(storeFor(v2Storage).migrate().identities, []);
  assert.equal(v2Storage.getItem("plezy-tv-profiles-v2"), malformed);
  assert.equal(v2Storage.getItem("plezy-tv-identities-v3"), null);

  var v3Storage = new MemoryStorage({ "plezy-tv-identities-v3": malformed });
  assert.deepEqual(storeFor(v3Storage).migrate().identities, []);
  assert.equal(v3Storage.getItem("plezy-tv-identities-v3"), malformed);

  var recoverableV2 = JSON.stringify({ version: 2, profiles: [], accounts: [], bindings: [] });
  var partialV3 = JSON.stringify({ version: 3, plexAccounts: "damaged" });
  var mixedStorage = new MemoryStorage({
    "plezy-tv-identities-v3": partialV3,
    "plezy-tv-profiles-v2": recoverableV2
  });
  storeFor(mixedStorage).migrate();
  assert.equal(mixedStorage.getItem("plezy-tv-identities-v3"), partialV3);
  assert.equal(mixedStorage.getItem("plezy-tv-profiles-v2"), recoverableV2);
});

test("a valid v1 session migrates directly into a selectable identity", function () {
  var session = jellyfinSession("legacy");
  var storage = new MemoryStorage({ "plezy-tv-session-v1": JSON.stringify(session) });
  var store = storeFor(storage);
  var document = store.migrate();
  assert.equal(document.identities.length, 1);
  assert.equal(document.identities[0].provider, "jellyfin");
  assert.equal(document.lastIdentityId, document.identities[0].id);
  assert.equal(store.chooseDefaultConnection(document.identities[0].id).session.token, "jf-token-legacy");
  assert.equal(storage.getItem("plezy-tv-session-v1"), null);
});

test("a legacy Plex session promotes its saved server to the discovered Home owner", function () {
  var session = plexSession("legacy-server", "legacy-home-token", "legacy-server-token");
  session.accountToken = "legacy-parent-token";
  var storage = new MemoryStorage({ "plezy-tv-session-v1": JSON.stringify(session) });
  var store = storeFor(storage);
  var migrated = store.migrate();
  var account = migrated.plexAccounts[0];
  var legacyIdentity = migrated.identities[0];
  assert.equal(legacyIdentity.homeUser.legacy, true);

  store.syncPlexHomeUsers(account.id, [
    { id: "1", uuid: "owner", title: "Owner", admin: true },
    { id: "2", uuid: "kid", title: "Kid" }
  ], { prune: true });

  var identities = store.getIdentities("plex");
  var owner = identities.filter(function (identity) { return identity.homeUser.uuid === "owner"; })[0];
  assert.equal(identities.length, 2);
  assert.equal(store.getIdentity(legacyIdentity.id), null);
  assert.equal(store.document.lastIdentityId, owner.id);
  assert.equal(owner.identityToken, "legacy-home-token");
  assert.equal(store.chooseDefaultConnection(owner.id).serverId, "legacy-server");
  assert.equal(store.chooseDefaultConnection(owner.id).session.token, "legacy-server-token");
});

test("Plex Home cache updates metadata without losing tokens or deduplicated server sessions", function () {
  var storage = new MemoryStorage();
  var store = storeFor(storage);
  store.load();
  var account = store.upsertPlexAccount({ accountId: "owner", name: "Plex", token: "parent" });
  var first = store.upsertPlexIdentity(account.id, { uuid: "kid", title: "Kid", protected: false }, { identityToken: "home-token" });
  var connection = store.upsertConnection(first.id, {
    provider: "plex",
    serverId: "server",
    name: "Server",
    identityToken: "home-token",
    session: plexSession("server", "home-token", "server-token")
  });
  store.setDefaultConnection(first.id, connection.id);
  store.syncPlexHomeUsers(account.id, [
    { uuid: "kid", title: "Kid Updated", protected: true, thumb: "https://image" },
    { uuid: "guest", title: "Guest" }
  ], { prune: true });

  var updated = store.getIdentity(first.id);
  assert.equal(updated.name, "Kid Updated");
  assert.equal(updated.protected, true);
  assert.equal(updated.identityToken, "home-token");
  assert.equal(store.getConnections(first.id).length, 1);
  assert.equal(store.getIdentities("plex").length, 2);
});

test("relinking the same Plex parent merges duplicate identities and their servers", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var known = store.upsertPlexAccount({ accountId: "owner-account", name: "Known", token: "old-parent" });
  var knownIdentity = store.upsertPlexIdentity(known.id, { uuid: "kid", title: "Kid" });
  store.upsertConnection(knownIdentity.id, {
    provider: "plex",
    serverId: "one",
    session: plexSession("one", "old-home", "server-one")
  });

  var staged = store.upsertPlexAccount({ name: "Relinked", token: "new-parent" });
  var stagedIdentity = store.upsertPlexIdentity(staged.id, { uuid: "kid", title: "Kid" }, { identityToken: "new-home" });
  store.upsertConnection(stagedIdentity.id, {
    provider: "plex",
    serverId: "two",
    session: plexSession("two", "new-home", "server-two")
  });

  var merged = store.upsertPlexAccount({
    id: staged.id,
    accountId: "owner-account",
    name: "Relinked",
    token: "new-parent"
  });
  assert.equal(merged.id, known.id);
  assert.equal(merged.token, "new-parent");
  assert.equal(store.getPlexAccounts().length, 1);
  var identities = store.getIdentities("plex");
  assert.equal(identities.length, 1);
  assert.deepEqual(store.getConnections(identities[0].id).map(function (connection) {
    return connection.serverId;
  }).sort(), ["one", "two"]);
});

test("Jellyfin logins deduplicate by server and user and remain isolated", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var one = store.upsertJellyfinIdentity({ name: "One", session: jellyfinSession("one") });
  var same = jellyfinSession("one");
  same.token = "renewed";
  var renewed = store.upsertJellyfinIdentity({ name: "One renewed", session: same });
  var two = store.upsertJellyfinIdentity({ name: "Two", session: jellyfinSession("two") });
  assert.equal(renewed.id, one.id);
  assert.notEqual(two.id, one.id);
  assert.equal(store.getIdentities("jellyfin").length, 2);
  assert.equal(store.getIdentity(one.id).token, "renewed");
  assert.equal(store.chooseDefaultConnection(two.id).session.userId, "jf-user-two");
});

test("last identity, default server, and global Nick Mode survive a round trip", function () {
  var storage = new MemoryStorage();
  var first = storeFor(storage, 100);
  first.load();
  var identity = first.upsertJellyfinIdentity({ name: "Viewer", session: jellyfinSession("roundtrip") });
  var connection = first.chooseDefaultConnection(identity.id);
  first.setNickMode(true);
  first.touchIdentity(identity.id, connection.id);

  var second = storeFor(storage, 200);
  second.load();
  assert.equal(second.document.lastIdentityId, identity.id);
  assert.equal(second.getNickMode(), true);
  assert.equal(second.chooseDefaultConnection(identity.id).id, connection.id);
  assert.deepEqual(second.getGlobalSettings(), { nickMode: true });
});

test("unlinking Plex and removing Jellyfin delete only the selected provider identities", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var account = store.upsertPlexAccount({ name: "Family", token: "parent" });
  var plex = store.upsertPlexIdentity(account.id, { uuid: "owner", title: "Owner" });
  store.upsertConnection(plex.id, { provider: "plex", serverId: "server", session: plexSession("server", "home", "server") });
  var jellyfin = store.upsertJellyfinIdentity({ name: "Jelly", session: jellyfinSession("remove") });

  var unlinked = store.unlinkPlexAccount(account.id);
  assert.equal(unlinked.identities.length, 1);
  assert.equal(store.getIdentity(plex.id), null);
  assert.ok(store.getIdentity(jellyfin.id));
  store.removeJellyfinIdentity(jellyfin.id);
  assert.deepEqual(store.getIdentities(), []);
  assert.deepEqual(store.getConnections(), []);
});

test("unavailable local storage falls back to a usable in-memory identity store", function () {
  var unavailable = {
    getItem: function () { throw new Error("blocked"); },
    setItem: function () { throw new Error("blocked"); },
    removeItem: function () { throw new Error("blocked"); }
  };
  var store = storeFor(unavailable);
  store.load();
  var identity = store.upsertJellyfinIdentity({ name: "Offline", session: jellyfinSession("offline") });
  assert.equal(store.getIdentity(identity.id).name, "Offline");
  assert.equal(store.available, false);
});
