"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Profiles = require("../js/profile-store.js");

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

function storeFor(storage) {
  return new Profiles.ProfileStore({ storage: storage, uuid: ids(), now: function () { return 1700000000000; } });
}

function addJellyfinConnection(store, profile, suffix) {
  var account = store.upsertAccount({
    provider: "jellyfin",
    name: "User " + suffix,
    token: "token-" + suffix,
    baseUrl: "https://jf-" + suffix + ".example",
    userId: "user-" + suffix
  });
  return store.bindConnection(profile.id, {
    accountId: account.id,
    provider: "jellyfin",
    name: "Jellyfin " + suffix,
    session: {
      provider: "jellyfin",
      baseUrl: "https://jf-" + suffix + ".example",
      token: "token-" + suffix,
      userId: "user-" + suffix,
      server: { name: "Jellyfin " + suffix }
    }
  });
}

test("legacy v1 migration creates a Default profile and removes v1 only after verified persistence", function () {
  var legacy = {
    provider: "plex",
    token: "server-token",
    accountToken: "account-token",
    baseUrl: "https://plex.example",
    server: { id: "server-1", name: "Living Room" },
    servers: []
  };
  var storage = new MemoryStorage({ "plezy-tv-session-v1": JSON.stringify(legacy) });
  var store = storeFor(storage);
  var document = store.migrateLegacy();
  assert.equal(document.version, 2);
  assert.equal(document.profiles[0].name, "Default");
  assert.equal(document.profiles[0].defaultConnectionId, document.bindings[0].id);
  assert.equal(document.accounts[0].token, "account-token");
  assert.equal(document.bindings[0].identityToken, "account-token");
  assert.equal(document.bindings[0].session.token, "server-token");
  assert.equal(document.bindings[0].session.accountToken, undefined);
  assert.equal(storage.getItem("plezy-tv-session-v1"), null);
  assert.ok(storage.getItem("plezy-tv-profiles-v2"));
});

test("failed migration read-back preserves the legacy credential", function () {
  var storage = new MemoryStorage({
    "plezy-tv-session-v1": JSON.stringify({ provider: "jellyfin", token: "jf", userId: "u", baseUrl: "https://jf" })
  });
  var originalSet = storage.setItem;
  storage.setItem = function (key, value) {
    originalSet.call(this, key, key === "plezy-tv-profiles-v2" ? "{broken" : value);
  };
  var store = storeFor(storage);
  store.migrateLegacy();
  assert.ok(storage.getItem("plezy-tv-session-v1"));
});

test("profiles, accounts, bindings, and defaults persist across a round trip", function () {
  var storage = new MemoryStorage();
  var first = storeFor(storage);
  first.load();
  var profile = first.createProfile("Taylor");
  var one = addJellyfinConnection(first, profile, "one");
  var two = addJellyfinConnection(first, profile, "two");
  first.setDefaultConnection(profile.id, two.id);
  first.touchConnection(profile.id, two.id);

  var second = storeFor(storage);
  second.load();
  assert.equal(second.getProfile(profile.id).name, "Taylor");
  assert.equal(second.getBindings(profile.id).length, 2);
  assert.equal(second.chooseDefaultConnection(profile.id).id, two.id);
  assert.notEqual(one.id, two.id);
});

test("missing and malformed Nick Mode values normalize to false", function () {
  var document = Profiles.normalizeDocument({
    version: 2,
    profiles: [
      { id: "missing", name: "Missing" },
      { id: "string", name: "String", nickMode: "true" },
      { id: "number", name: "Number", nickMode: 1 },
      { id: "enabled", name: "Enabled", nickMode: true }
    ]
  });
  assert.deepEqual(document.profiles.map(function (profile) { return profile.nickMode; }), [false, false, false, true]);
});

test("Nick Mode persists per profile and setNickMode validates its target", function () {
  var storage = new MemoryStorage();
  var first = storeFor(storage);
  first.load();
  var one = first.createProfile("One");
  var two = first.createProfile("Two");
  assert.equal(one.nickMode, false);
  assert.equal(two.nickMode, false);

  var enabled = first.setNickMode(one.id, true);
  assert.equal(enabled.nickMode, true);
  assert.equal(first.getProfile(two.id).nickMode, false);

  var second = storeFor(storage);
  second.load();
  assert.equal(second.getProfile(one.id).nickMode, true);
  assert.equal(second.getProfile(two.id).nickMode, false);
  assert.equal(second.setNickMode(one.id, false).nickMode, false);
  assert.throws(function () { second.setNickMode("missing", true); }, /Profile was not found/);
});

test("malformed JSON and malformed rows are ignored without destructive load writes", function () {
  var malformed = "{this is recoverable source data";
  var brokenStorage = new MemoryStorage({ "plezy-tv-profiles-v2": malformed });
  assert.deepEqual(storeFor(brokenStorage).load().profiles, []);
  assert.equal(brokenStorage.getItem("plezy-tv-profiles-v2"), malformed);

  var mixed = {
    version: 2,
    profiles: [{ id: "good-profile", name: "Good" }, { id: "", name: "Bad" }],
    accounts: [{ id: "good-account", provider: "jellyfin", token: "token" }, { id: "bad-account", provider: "unknown", token: "x" }],
    bindings: [
      { id: "good-binding", profileId: "good-profile", accountId: "good-account", provider: "jellyfin", session: { provider: "jellyfin" } },
      { id: "orphan", profileId: "missing", accountId: "good-account", provider: "jellyfin", session: { provider: "jellyfin" } }
    ]
  };
  var raw = JSON.stringify(mixed);
  var mixedStorage = new MemoryStorage({ "plezy-tv-profiles-v2": raw });
  var loaded = storeFor(mixedStorage).load();
  assert.deepEqual(loaded.profiles.map(function (row) { return row.id; }), ["good-profile"]);
  assert.deepEqual(loaded.bindings.map(function (row) { return row.id; }), ["good-binding"]);
  assert.equal(mixedStorage.getItem("plezy-tv-profiles-v2"), raw);
});

test("an unavailable storage implementation remains usable as an in-memory store", function () {
  var unavailable = {
    getItem: function () { throw new Error("blocked"); },
    setItem: function () { throw new Error("blocked"); },
    removeItem: function () { throw new Error("blocked"); }
  };
  var store = storeFor(unavailable);
  store.load();
  var profile = store.createProfile("Offline");
  assert.equal(store.getProfile(profile.id).name, "Offline");
  assert.equal(store.available, false);
});

test("defaults cannot cross profile boundaries and profile data stays isolated", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var first = store.createProfile("First");
  var second = store.createProfile("Second");
  var firstConnection = addJellyfinConnection(store, first, "first");
  var secondConnection = addJellyfinConnection(store, second, "second");
  assert.throws(function () { store.setDefaultConnection(first.id, secondConnection.id); }, /not found for this profile/);
  assert.deepEqual(store.getBindings(first.id).map(function (row) { return row.id; }), [firstConnection.id]);
  assert.deepEqual(store.getBindings(second.id).map(function (row) { return row.id; }), [secondConnection.id]);
});

test("shared Plex accounts survive one profile deletion and disappear after the final reference", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var one = store.createProfile("One");
  var two = store.createProfile("Two");
  var account = store.upsertAccount({ provider: "plex", name: "Family Plex", token: "parent-token" });
  [one, two].forEach(function (profile, index) {
    var binding = store.bindConnection(profile.id, {
      accountId: account.id,
      provider: "plex",
      name: "Plex " + index,
      identityToken: "home-token-" + index,
      homeUser: { uuid: "home-" + index, title: profile.name, protected: false },
      serverId: "server",
      session: { provider: "plex", token: "server-token-" + index, accountToken: "parent-token", identityToken: "home-token-" + index, baseUrl: "https://plex", server: { id: "server", name: "Plex" } }
    });
    assert.equal(binding.session.accountToken, undefined);
  });
  store.deleteProfile(one.id);
  assert.equal(store.getAccount(account.id).token, "parent-token");
  store.deleteProfile(two.id);
  assert.equal(store.getAccount(account.id), null);
});

test("deleting a profile removes its independent Jellyfin credential", function () {
  var store = storeFor(new MemoryStorage());
  store.load();
  var profile = store.createProfile("Jellyfin user");
  var binding = addJellyfinConnection(store, profile, "private");
  var accountId = binding.accountId;
  store.deleteProfile(profile.id);
  assert.equal(store.getAccount(accountId), null);
});
