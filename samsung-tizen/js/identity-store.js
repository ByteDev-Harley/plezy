(function (root, factory) {
  var moduleValue = factory();
  if (typeof module === "object" && module.exports) module.exports = moduleValue;
  root.PlezyTVIdentities = moduleValue;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 3;
  var STORAGE_KEY = "plezy-tv-identities-v3";
  var V2_KEY = "plezy-tv-profiles-v2";
  var LEGACY_KEY = "plezy-tv-session-v1";

  function copy(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function timestamp(value) {
    var parsed = Number(value);
    return isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function flag(value) {
    return value === true || value === 1 || value === "1" ||
      (typeof value === "string" && value.toLowerCase() === "true");
  }

  function provider(value) {
    value = text(value).toLowerCase();
    return value === "plex" || value === "jellyfin" ? value : "";
  }

  function canonicalUrl(value) {
    return text(value).replace(/\/+$/, "").toLowerCase();
  }

  function plexIdentityKey(accountId, homeUserUuid) {
    return "plex:" + text(accountId) + ":" + text(homeUserUuid);
  }

  function jellyfinIdentityKey(baseUrl, userId) {
    return "jellyfin:" + canonicalUrl(baseUrl) + ":" + text(userId);
  }

  function defaultDocument() {
    return {
      version: VERSION,
      plexAccounts: [],
      identities: [],
      connections: [],
      lastIdentityId: "",
      nickMode: false,
      updatedAt: 0
    };
  }

  function normalizeHomeUser(value) {
    value = value && typeof value === "object" ? value : {};
    var uuid = text(value.uuid || value.userUuid || value.id);
    if (!uuid) return null;
    return {
      id: text(value.id),
      uuid: uuid,
      title: text(value.title || value.name || value.username) || "Plex user",
      username: text(value.username || value.email),
      thumb: text(value.thumb || value.avatar),
      protected: flag(value.protected),
      admin: flag(value.admin) || flag(value.owner),
      legacy: value.legacy === true
    };
  }

  function normalizePlexAccount(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id);
    var token = text(row.token || row.accountToken);
    if (!id || !token) return null;
    return {
      id: id,
      provider: "plex",
      accountId: text(row.accountId || row.uuid || row.userId),
      name: text(row.name) || "Plex account",
      username: text(row.username || row.email),
      thumb: text(row.thumb),
      token: token,
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
  }

  function normalizeIdentity(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id);
    var kind = provider(row.provider);
    if (!id || !kind) return null;
    var result = {
      id: id,
      provider: kind,
      key: "",
      name: text(row.name),
      thumb: text(row.thumb),
      defaultConnectionId: text(row.defaultConnectionId || row.lastServerConnectionId),
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
    if (kind === "plex") {
      result.plexAccountId = text(row.plexAccountId || row.accountId);
      result.homeUser = normalizeHomeUser(row.homeUser || row.user);
      if (!result.plexAccountId || !result.homeUser) return null;
      result.key = plexIdentityKey(result.plexAccountId, result.homeUser.uuid);
      result.name = result.homeUser.title;
      result.thumb = result.homeUser.thumb || result.thumb;
      result.identityToken = text(row.identityToken || row.token);
      result.protected = row.protected === true || result.homeUser.protected;
    } else {
      result.baseUrl = text(row.baseUrl || (row.session && row.session.baseUrl)).replace(/\/+$/, "");
      result.userId = text(row.userId || (row.session && row.session.userId));
      result.token = text(row.token || (row.session && row.session.token));
      result.username = text(row.username || (row.server && row.server.username) ||
        (row.session && row.session.server && row.session.server.username));
      result.server = copy(row.server || (row.session && row.session.server)) || null;
      result.session = copy(row.session) || {
        provider: "jellyfin",
        token: result.token,
        baseUrl: result.baseUrl,
        userId: result.userId,
        server: result.server
      };
      if (!result.baseUrl || !result.userId || !result.token) return null;
      result.session.provider = "jellyfin";
      result.session.token = result.token;
      result.session.baseUrl = result.baseUrl;
      result.session.userId = result.userId;
      result.key = jellyfinIdentityKey(result.baseUrl, result.userId);
      result.name = result.name || result.username || "Jellyfin user";
    }
    return result;
  }

  function normalizeConnection(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id || row.connectionId);
    var identityId = text(row.identityId);
    var kind = provider(row.provider);
    var session = copy(row.session);
    if (!id || !identityId || !kind || !session || typeof session !== "object") return null;
    if (provider(session.provider) && provider(session.provider) !== kind) return null;
    session.provider = kind;
    /* Parent Plex credentials are never valid media-session data. */
    delete session.accountToken;
    var server = session.server && typeof session.server === "object" ? session.server : null;
    var result = {
      id: id,
      identityId: identityId,
      provider: kind,
      name: text(row.name) || (server && text(server.name)) || (kind === "plex" ? "Plex" : "Jellyfin"),
      serverId: text(row.serverId || (server && server.id)),
      session: session,
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
    if (kind === "plex") {
      result.identityToken = text(row.identityToken || session.identityToken || session.discoveryToken);
      if (result.identityToken) result.session.identityToken = result.identityToken;
    }
    return result;
  }

  function normalizeDocument(value) {
    var result = defaultDocument();
    if (!value || typeof value !== "object" || Number(value.version) !== VERSION) return result;
    var accountIds = {};
    var identityIds = {};
    var identityKeys = {};
    var connectionIds = {};

    (Array.isArray(value.plexAccounts) ? value.plexAccounts : []).forEach(function (row) {
      var account = normalizePlexAccount(row);
      if (!account || accountIds[account.id]) return;
      accountIds[account.id] = true;
      result.plexAccounts.push(account);
    });
    (Array.isArray(value.identities) ? value.identities : []).forEach(function (row) {
      var identity = normalizeIdentity(row);
      if (!identity || identityIds[identity.id] || identityKeys[identity.key]) return;
      if (identity.provider === "plex" && !accountIds[identity.plexAccountId]) return;
      identityIds[identity.id] = true;
      identityKeys[identity.key] = true;
      result.identities.push(identity);
    });
    (Array.isArray(value.connections) ? value.connections : []).forEach(function (row) {
      var connection = normalizeConnection(row);
      if (!connection || connectionIds[connection.id] || !identityIds[connection.identityId]) return;
      var identity = null;
      result.identities.some(function (candidate) {
        if (candidate.id !== connection.identityId) return false;
        identity = candidate;
        return true;
      });
      if (!identity || identity.provider !== connection.provider) return;
      connectionIds[connection.id] = true;
      result.connections.push(connection);
    });
    result.identities.forEach(function (identity) {
      var validDefault = result.connections.some(function (connection) {
        return connection.id === identity.defaultConnectionId && connection.identityId === identity.id;
      });
      if (!validDefault) identity.defaultConnectionId = "";
    });
    result.lastIdentityId = identityIds[text(value.lastIdentityId)] ? text(value.lastIdentityId) : "";
    result.nickMode = value.nickMode === true || Boolean(value.settings && value.settings.nickMode === true);
    result.updatedAt = timestamp(value.updatedAt);
    return result;
  }

  function resolveOptions(storageOrOptions, maybeOptions) {
    var options = maybeOptions || {};
    var storage = storageOrOptions;
    if (storageOrOptions && typeof storageOrOptions === "object" &&
        typeof storageOrOptions.getItem !== "function" &&
        (storageOrOptions.storage || storageOrOptions.now || storageOrOptions.uuid)) {
      options = storageOrOptions;
      storage = options.storage;
    }
    if (storage === undefined) {
      try { storage = localStorage; } catch (_) { storage = null; }
    }
    return { storage: storage || null, options: options };
  }

  function IdentityStore(storageOrOptions, maybeOptions) {
    var resolved = resolveOptions(storageOrOptions, maybeOptions);
    this.storage = resolved.storage;
    this.storageKey = resolved.options.storageKey || STORAGE_KEY;
    this.v2Key = resolved.options.v2Key || V2_KEY;
    this.legacyKey = resolved.options.legacyKey || LEGACY_KEY;
    this._now = typeof resolved.options.now === "function" ? resolved.options.now : function () { return Date.now(); };
    this._uuid = typeof resolved.options.uuid === "function" ? resolved.options.uuid : function () {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
        var random = Math.random() * 16 | 0;
        var value = char === "x" ? random : (random & 3 | 8);
        return value.toString(16);
      });
    };
    this.document = defaultDocument();
    this.available = Boolean(this.storage);
    this.lastError = null;
  }

  IdentityStore.prototype._get = function (key) {
    if (!this.storage || typeof this.storage.getItem !== "function") return null;
    try { return this.storage.getItem(key); } catch (error) {
      this.available = false;
      this.lastError = error;
      return null;
    }
  };

  IdentityStore.prototype._set = function (key, value) {
    if (!this.storage || typeof this.storage.setItem !== "function") return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error;
      return false;
    }
  };

  IdentityStore.prototype._remove = function (key) {
    if (!this.storage || typeof this.storage.removeItem !== "function") return false;
    try {
      this.storage.removeItem(key);
      return true;
    } catch (error) {
      this.available = false;
      this.lastError = error;
      return false;
    }
  };

  IdentityStore.prototype.load = function () {
    var raw = this._get(this.storageKey);
    if (!raw) {
      this.document = defaultDocument();
      return copy(this.document);
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || Number(parsed.version) !== VERSION) throw new Error("Unsupported identity-store version.");
      this.document = normalizeDocument(parsed);
    } catch (error) {
      /* A damaged value remains untouched so it can be recovered manually. */
      this.lastError = error;
      this.document = defaultDocument();
    }
    return copy(this.document);
  };

  IdentityStore.prototype._persist = function () {
    this.document.version = VERSION;
    this.document.updatedAt = this._now();
    return this._set(this.storageKey, JSON.stringify(this.document));
  };

  IdentityStore.prototype.save = function () {
    this._persist();
    return copy(this.document);
  };

  function findById(rows, id) {
    var found = null;
    rows.some(function (row) {
      if (row.id !== id) return false;
      found = row;
      return true;
    });
    return found;
  }

  function migrationConnectionKey(connection) {
    var session = connection.session || {};
    return text(connection.serverId || (session.server && session.server.id)) || canonicalUrl(session.baseUrl);
  }

  function freshnessCompare(left, right) {
    var lastUsedDifference = timestamp(left && left.lastUsedAt) - timestamp(right && right.lastUsedAt);
    if (lastUsedDifference) return lastUsedDifference;
    return timestamp(left && left.updatedAt) - timestamp(right && right.updatedAt);
  }

  function earliest(left, right) {
    left = timestamp(left);
    right = timestamp(right);
    if (!left) return right;
    if (!right) return left;
    return Math.min(left, right);
  }

  /* Move one representation of the same provider identity into another
     without dropping any saved server. This is used when old sessions did
     not know their Plex Home UUID and when duplicate parent-account rows are
     reconciled. */
  function mergeIdentityRecords(document, target, source) {
    if (!target || !source || target.id === source.id || target.provider !== source.provider) return target;
    var sourceWasLast = document.lastIdentityId === source.id;
    var sourceIsNewer = freshnessCompare(source, target) > 0;
    var sourceDefaultId = source.defaultConnectionId;
    var promotedDefaultId = "";

    if (target.provider === "plex" && source.identityToken && (!target.identityToken || sourceIsNewer)) {
      target.identityToken = source.identityToken;
    }
    target.createdAt = earliest(target.createdAt, source.createdAt);
    target.updatedAt = Math.max(timestamp(target.updatedAt), timestamp(source.updatedAt));
    target.lastUsedAt = Math.max(timestamp(target.lastUsedAt), timestamp(source.lastUsedAt));

    var removeConnections = {};
    document.connections.filter(function (connection) {
      return connection.identityId === source.id;
    }).forEach(function (connection) {
      var key = migrationConnectionKey(connection);
      var existing = null;
      if (key) {
        document.connections.some(function (candidate) {
          if (candidate.identityId !== target.id || migrationConnectionKey(candidate) !== key) return false;
          existing = candidate;
          return true;
        });
      }
      if (!existing) {
        connection.identityId = target.id;
        if (connection.id === sourceDefaultId) promotedDefaultId = connection.id;
        return;
      }
      if (freshnessCompare(connection, existing) > 0) {
        existing.name = connection.name;
        existing.serverId = connection.serverId || existing.serverId;
        existing.session = connection.session;
        existing.identityToken = connection.identityToken || existing.identityToken;
      }
      existing.createdAt = earliest(existing.createdAt, connection.createdAt);
      existing.updatedAt = Math.max(timestamp(existing.updatedAt), timestamp(connection.updatedAt));
      existing.lastUsedAt = Math.max(timestamp(existing.lastUsedAt), timestamp(connection.lastUsedAt));
      if (connection.id === sourceDefaultId) promotedDefaultId = existing.id;
      removeConnections[connection.id] = true;
    });
    document.connections = document.connections.filter(function (connection) {
      return !removeConnections[connection.id];
    });
    if (promotedDefaultId && (!target.defaultConnectionId || sourceIsNewer || sourceWasLast)) {
      target.defaultConnectionId = promotedDefaultId;
    }
    if (sourceWasLast) document.lastIdentityId = target.id;
    document.identities = document.identities.filter(function (identity) { return identity.id !== source.id; });
    return target;
  }

  IdentityStore.prototype._migrateV2 = function (source) {
    var now = this._now();
    var self = this;
    var candidate = defaultDocument();
    var profiles = Array.isArray(source.profiles) ? source.profiles : [];
    var accounts = Array.isArray(source.accounts) ? source.accounts : [];
    var bindings = Array.isArray(source.bindings) ? source.bindings : [];
    var profileById = {};
    var sourceAccountById = {};
    var plexAccountBySourceId = {};
    var identityByKey = {};
    var jellyfinIdentityByAccount = {};
    var bindingResolution = {};

    profiles.forEach(function (row) {
      if (row && text(row.id)) profileById[text(row.id)] = row;
    });
    accounts.forEach(function (row) {
      if (row && text(row.id)) sourceAccountById[text(row.id)] = row;
    });

    function addPlexAccount(sourceAccount, fallbackToken) {
      sourceAccount = sourceAccount || {};
      var sourceId = text(sourceAccount.id);
      if (sourceId && plexAccountBySourceId[sourceId]) return plexAccountBySourceId[sourceId];
      var normalized = normalizePlexAccount({
        id: sourceId || self._uuid(),
        accountId: sourceAccount.accountId || sourceAccount.uuid || sourceAccount.userId,
        name: sourceAccount.name,
        username: sourceAccount.username || sourceAccount.email,
        thumb: sourceAccount.thumb,
        token: sourceAccount.token || fallbackToken,
        createdAt: sourceAccount.createdAt || now,
        updatedAt: sourceAccount.updatedAt || now,
        lastUsedAt: sourceAccount.lastUsedAt
      });
      if (!normalized) return null;
      var duplicate = null;
      candidate.plexAccounts.some(function (account) {
        if ((normalized.accountId && account.accountId === normalized.accountId) ||
            (!normalized.accountId && normalized.token && account.token === normalized.token)) {
          duplicate = account;
          return true;
        }
        return false;
      });
      if (duplicate) {
        var replaceToken = freshnessCompare(normalized, duplicate) > 0;
        duplicate.accountId = duplicate.accountId || normalized.accountId;
        duplicate.name = duplicate.name || normalized.name;
        duplicate.username = duplicate.username || normalized.username;
        duplicate.thumb = duplicate.thumb || normalized.thumb;
        duplicate.createdAt = earliest(duplicate.createdAt, normalized.createdAt);
        duplicate.updatedAt = Math.max(duplicate.updatedAt, normalized.updatedAt);
        duplicate.lastUsedAt = Math.max(duplicate.lastUsedAt, normalized.lastUsedAt);
        if (replaceToken) duplicate.token = normalized.token;
        if (sourceId) plexAccountBySourceId[sourceId] = duplicate;
        return duplicate;
      }
      if (findById(candidate.plexAccounts, normalized.id)) normalized.id = self._uuid();
      candidate.plexAccounts.push(normalized);
      if (sourceId) plexAccountBySourceId[sourceId] = normalized;
      return normalized;
    }

    accounts.forEach(function (account) {
      if (provider(account && account.provider) === "plex") addPlexAccount(account, "");
    });

    function addIdentity(value) {
      var normalized = normalizeIdentity(value);
      if (!normalized) return null;
      var existing = identityByKey[normalized.key];
      if (existing) {
        if (freshnessCompare(normalized, existing) >= 0) {
          existing.name = normalized.name || existing.name;
          existing.thumb = normalized.thumb || existing.thumb;
          if (existing.provider === "plex") {
            existing.homeUser = normalized.homeUser;
            existing.protected = normalized.protected;
            existing.identityToken = normalized.identityToken || existing.identityToken;
          } else {
            existing.token = normalized.token || existing.token;
            existing.session = normalized.session || existing.session;
            existing.server = normalized.server || existing.server;
          }
        }
        existing.updatedAt = Math.max(existing.updatedAt, normalized.updatedAt);
        existing.lastUsedAt = Math.max(existing.lastUsedAt, normalized.lastUsedAt);
        return existing;
      }
      identityByKey[normalized.key] = normalized;
      candidate.identities.push(normalized);
      return normalized;
    }

    function addConnection(identity, row) {
      if (!identity) return null;
      var normalized = normalizeConnection(row);
      if (!normalized) return null;
      normalized.identityId = identity.id;
      var key = migrationConnectionKey(normalized);
      var existing = null;
      candidate.connections.some(function (connection) {
        if (connection.identityId !== identity.id || !key || migrationConnectionKey(connection) !== key) return false;
        existing = connection;
        return true;
      });
      if (!existing) {
        if (findById(candidate.connections, normalized.id)) normalized.id = self._uuid();
        candidate.connections.push(normalized);
        return normalized;
      }
      existing.createdAt = Math.min(existing.createdAt || normalized.createdAt, normalized.createdAt || existing.createdAt);
      if (normalized.lastUsedAt >= existing.lastUsedAt) {
        existing.name = normalized.name;
        existing.serverId = normalized.serverId || existing.serverId;
        existing.session = normalized.session;
        existing.identityToken = normalized.identityToken || existing.identityToken;
      }
      existing.updatedAt = Math.max(existing.updatedAt, normalized.updatedAt);
      existing.lastUsedAt = Math.max(existing.lastUsedAt, normalized.lastUsedAt);
      return existing;
    }

    /* A saved Jellyfin login is already an identity, even if its old local
       profile was removed before the migration ran. */
    accounts.forEach(function (account) {
      if (provider(account && account.provider) !== "jellyfin") return;
      var session = {
        provider: "jellyfin",
        token: text(account.token),
        baseUrl: text(account.baseUrl),
        userId: text(account.userId),
        server: copy(account.server) || null
      };
      var identity = addIdentity({
        id: self._uuid(),
        provider: "jellyfin",
        name: account.name,
        username: account.username,
        token: session.token,
        baseUrl: session.baseUrl,
        userId: session.userId,
        server: session.server,
        session: session,
        createdAt: account.createdAt || now,
        updatedAt: account.updatedAt || now,
        lastUsedAt: account.lastUsedAt
      });
      if (!identity) return;
      jellyfinIdentityByAccount[text(account.id)] = identity;
      var connection = addConnection(identity, {
        id: self._uuid(),
        identityId: identity.id,
        provider: "jellyfin",
        name: session.server && session.server.name || "Jellyfin",
        serverId: session.server && session.server.id,
        session: session,
        createdAt: account.createdAt || now,
        updatedAt: account.updatedAt || now,
        lastUsedAt: account.lastUsedAt
      });
      if (connection && !identity.defaultConnectionId) identity.defaultConnectionId = connection.id;
    });

    bindings.forEach(function (binding) {
      if (!binding || !text(binding.id)) return;
      var kind = provider(binding.provider || (binding.session && binding.session.provider));
      var sourceAccount = sourceAccountById[text(binding.accountId)] || {};
      var identity = null;
      var session = copy(binding.session) || {};
      if (kind === "plex") {
        var parent = addPlexAccount(sourceAccount, session.accountToken || binding.accountToken);
        if (!parent) return;
        var homeUser = copy(binding.homeUser) || {};
        if (!text(homeUser.uuid || homeUser.id)) {
          homeUser.uuid = "legacy-" + text(binding.id);
          homeUser.legacy = true;
        }
        homeUser.title = text(homeUser.title) ||
          text(profileById[text(binding.profileId)] && profileById[text(binding.profileId)].name) || "Plex user";
        identity = addIdentity({
          id: self._uuid(),
          provider: "plex",
          plexAccountId: parent.id,
          homeUser: homeUser,
          identityToken: binding.identityToken || session.identityToken || session.discoveryToken,
          protected: binding.protected,
          createdAt: binding.createdAt || now,
          updatedAt: binding.updatedAt || now,
          lastUsedAt: binding.lastUsedAt
        });
      } else if (kind === "jellyfin") {
        identity = jellyfinIdentityByAccount[text(binding.accountId)] || addIdentity({
          id: self._uuid(),
          provider: "jellyfin",
          name: sourceAccount.name || (session.server && session.server.username),
          token: sourceAccount.token || session.token,
          baseUrl: sourceAccount.baseUrl || session.baseUrl,
          userId: sourceAccount.userId || session.userId,
          server: sourceAccount.server || session.server,
          session: session,
          createdAt: binding.createdAt || now,
          updatedAt: binding.updatedAt || now,
          lastUsedAt: binding.lastUsedAt
        });
      }
      if (!identity) return;
      delete session.accountToken;
      var connection = addConnection(identity, {
        id: text(binding.id),
        identityId: identity.id,
        provider: kind,
        name: binding.name,
        serverId: binding.serverId || (session.server && session.server.id),
        identityToken: binding.identityToken || session.identityToken,
        session: session,
        createdAt: binding.createdAt || now,
        updatedAt: binding.updatedAt || now,
        lastUsedAt: binding.lastUsedAt
      });
      if (!connection) return;
      bindingResolution[text(binding.id)] = { identityId: identity.id, connectionId: connection.id };
      if (!identity.defaultConnectionId) identity.defaultConnectionId = connection.id;
      var profile = profileById[text(binding.profileId)];
      if (profile && text(profile.defaultConnectionId || profile.defaultBindingId) === text(binding.id)) {
        var currentDefault = findById(candidate.connections, identity.defaultConnectionId);
        if (!currentDefault || timestamp(profile.lastUsedAt) >= currentDefault.lastUsedAt) {
          identity.defaultConnectionId = connection.id;
        }
      }
    });

    var lastProfile = profileById[text(source.lastProfileId)];
    if (lastProfile) {
      candidate.nickMode = lastProfile.nickMode === true;
      var defaultBindingId = text(lastProfile.defaultConnectionId || lastProfile.defaultBindingId);
      var selected = bindingResolution[defaultBindingId];
      if (!selected) {
        var profileBindings = bindings.filter(function (binding) {
          return binding && text(binding.profileId) === text(lastProfile.id) && bindingResolution[text(binding.id)];
        }).sort(function (a, b) { return timestamp(b.lastUsedAt) - timestamp(a.lastUsedAt); });
        selected = profileBindings.length ? bindingResolution[text(profileBindings[0].id)] : null;
      }
      if (selected) {
        candidate.lastIdentityId = selected.identityId;
        var lastIdentity = findById(candidate.identities, selected.identityId);
        if (lastIdentity) lastIdentity.defaultConnectionId = selected.connectionId;
      }
    }
    candidate.updatedAt = now;
    return normalizeDocument(candidate);
  };

  IdentityStore.prototype._migrateV1 = function (session) {
    var kind = provider(session && session.provider);
    if (!kind) return null;
    if (kind === "plex" && !text(session.accountToken || session.identityToken || session.token)) return null;
    if (kind === "jellyfin" && (!text(session.token) || !text(session.baseUrl) || !text(session.userId))) return null;
    var now = this._now();
    var profileId = this._uuid();
    var accountId = this._uuid();
    var bindingId = this._uuid();
    var account = {
      id: accountId,
      provider: kind,
      name: kind === "plex" ? "Plex account" :
        ((session.server && session.server.username) || "Jellyfin user"),
      token: kind === "plex" ? text(session.accountToken || session.identityToken || session.token) : text(session.token),
      baseUrl: session.baseUrl,
      userId: session.userId,
      server: session.server,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    };
    return this._migrateV2({
      version: 2,
      profiles: [{ id: profileId, name: "Default", defaultConnectionId: bindingId, lastUsedAt: now }],
      accounts: [account],
      bindings: [{
        id: bindingId,
        profileId: profileId,
        accountId: accountId,
        provider: kind,
        name: session.server && session.server.name,
        homeUser: kind === "plex" ? (session.homeUser || { uuid: "legacy-" + bindingId, title: "Plex user", legacy: true }) : undefined,
        identityToken: session.identityToken || session.accountToken || session.token,
        serverId: session.server && session.server.id,
        session: session,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now
      }],
      lastProfileId: profileId
    });
  };

  IdentityStore.prototype._commitMigration = function (candidate) {
    if (!candidate) return this.load();
    var serialized = JSON.stringify(candidate);
    if (!this._set(this.storageKey, serialized)) {
      this.document = candidate;
      return copy(this.document);
    }
    var verifiedRaw = this._get(this.storageKey);
    var verified = null;
    try {
      var parsed = JSON.parse(verifiedRaw);
      if (parsed && Number(parsed.version) === VERSION) verified = normalizeDocument(parsed);
    } catch (_) { verified = null; }
    if (verifiedRaw !== serialized || !verified || JSON.stringify(verified) !== serialized) {
      this.document = candidate;
      return copy(this.document);
    }
    this.document = verified;
    this._remove(this.v2Key);
    this._remove(this.legacyKey);
    return copy(this.document);
  };

  IdentityStore.prototype.migrate = function () {
    var existingRaw = this._get(this.storageKey);
    if (existingRaw) {
      var existing = this.load();
      /* Only a canonical read-back proves that this v3 document safely
         supersedes a legacy credential. Partially malformed-but-parseable
         documents remain non-destructive. */
      if (!this.lastError && existingRaw === JSON.stringify(existing)) {
        this._remove(this.v2Key);
        this._remove(this.legacyKey);
      }
      return existing;
    }
    var v2Raw = this._get(this.v2Key);
    if (v2Raw) {
      try {
        var v2 = JSON.parse(v2Raw);
        if (!v2 || Number(v2.version) !== 2 || !Array.isArray(v2.profiles) ||
            !Array.isArray(v2.accounts) || !Array.isArray(v2.bindings)) {
          throw new Error("Unsupported or malformed profile-store document.");
        }
        return this._commitMigration(this._migrateV2(v2));
      } catch (error) {
        this.lastError = error;
        this.document = defaultDocument();
        return copy(this.document);
      }
    }
    var legacyRaw = this._get(this.legacyKey);
    if (!legacyRaw) return this.load();
    try {
      return this._commitMigration(this._migrateV1(JSON.parse(legacyRaw)));
    } catch (error) {
      this.lastError = error;
      return this.load();
    }
  };

  IdentityStore.prototype._identity = function (identityId) {
    return findById(this.document.identities, identityId);
  };

  IdentityStore.prototype.getIdentity = function (identityId) {
    return copy(this._identity(identityId));
  };

  IdentityStore.prototype.getIdentities = function (kind) {
    kind = provider(kind);
    return copy(this.document.identities.filter(function (identity) {
      return !kind || identity.provider === kind;
    }).sort(function (a, b) {
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name);
    }));
  };

  IdentityStore.prototype.getPlexAccount = function (accountId) {
    return copy(findById(this.document.plexAccounts, accountId));
  };

  IdentityStore.prototype.getPlexAccounts = function () {
    return copy(this.document.plexAccounts.slice().sort(function (a, b) {
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name);
    }));
  };

  IdentityStore.prototype.getConnection = function (connectionId) {
    return copy(findById(this.document.connections, connectionId));
  };

  IdentityStore.prototype.getConnections = function (identityId) {
    return copy(this.document.connections.filter(function (connection) {
      return !identityId || connection.identityId === identityId;
    }).sort(function (a, b) {
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name);
    }));
  };

  IdentityStore.prototype.getAccountForIdentity = function (identityId) {
    var identity = this._identity(identityId);
    if (!identity) return null;
    return identity.provider === "plex" ? this.getPlexAccount(identity.plexAccountId) : copy(identity);
  };

  IdentityStore.prototype.resolveIdentity = function (identityId, connectionId) {
    var identity = this.getIdentity(identityId);
    if (!identity) return null;
    var connection = connectionId ? this.getConnection(connectionId) : this.chooseDefaultConnection(identityId);
    if (connection && connection.identityId !== identityId) connection = null;
    return {
      identity: identity,
      account: this.getAccountForIdentity(identityId),
      connection: connection
    };
  };

  IdentityStore.prototype.upsertPlexAccount = function (value) {
    value = copy(value) || {};
    var wantedId = text(value.id);
    var wantedAccountId = text(value.accountId);
    var wantedToken = text(value.token);
    var matches = this.document.plexAccounts.filter(function (account) {
      return Boolean((wantedId && account.id === wantedId) ||
        (wantedAccountId && account.accountId === wantedAccountId) ||
        (wantedToken && account.token === wantedToken));
    });
    var current = null;
    if (wantedAccountId) {
      current = matches.filter(function (account) { return account.accountId === wantedAccountId; })[0] || null;
    }
    if (!current && wantedId) current = matches.filter(function (account) { return account.id === wantedId; })[0] || null;
    if (!current) current = matches[0] || null;
    var now = this._now();
    value.id = current ? current.id : (text(value.id) || this._uuid());
    value.createdAt = matches.reduce(function (createdAt, account) {
      return earliest(createdAt, account.createdAt);
    }, current ? current.createdAt : (value.createdAt || now));
    value.updatedAt = now;
    value.lastUsedAt = value.lastUsedAt || (current && current.lastUsedAt);
    var account = normalizePlexAccount(Object.assign({}, current || {}, value));
    if (!account) throw new Error("Linked Plex account is invalid.");
    var duplicateAccountIds = {};
    matches.forEach(function (row) {
      if (row.id !== account.id) duplicateAccountIds[row.id] = true;
    });
    var self = this;
    this.document.identities.filter(function (identity) {
      return identity.provider === "plex" && duplicateAccountIds[identity.plexAccountId];
    }).slice().forEach(function (identity) {
      var target = null;
      self.document.identities.some(function (candidate) {
        if (candidate.id === identity.id || candidate.provider !== "plex" ||
            candidate.plexAccountId !== account.id || candidate.homeUser.uuid !== identity.homeUser.uuid) return false;
        target = candidate;
        return true;
      });
      if (target) mergeIdentityRecords(self.document, target, identity);
      else {
        identity.plexAccountId = account.id;
        identity.key = plexIdentityKey(account.id, identity.homeUser.uuid);
      }
    });
    this.document.plexAccounts = this.document.plexAccounts.filter(function (row) {
      return row.id !== account.id && !duplicateAccountIds[row.id];
    });
    this.document.plexAccounts.push(account);
    this._persist();
    return copy(account);
  };

  IdentityStore.prototype.upsertPlexIdentity = function (accountId, homeUser, extra) {
    var account = findById(this.document.plexAccounts, accountId);
    homeUser = normalizeHomeUser(homeUser);
    extra = copy(extra) || {};
    if (!account) throw new Error("Linked Plex account was not found.");
    if (!homeUser) throw new Error("Plex Home user is invalid.");
    var key = plexIdentityKey(accountId, homeUser.uuid);
    var current = null;
    this.document.identities.some(function (identity) {
      if (identity.key !== key) return false;
      current = identity;
      return true;
    });
    var now = this._now();
    var identity = normalizeIdentity({
      id: current ? current.id : this._uuid(),
      provider: "plex",
      plexAccountId: accountId,
      homeUser: homeUser,
      identityToken: extra.identityToken || (current && current.identityToken),
      protected: homeUser.protected,
      defaultConnectionId: current && current.defaultConnectionId,
      createdAt: current ? current.createdAt : now,
      updatedAt: now,
      lastUsedAt: current && current.lastUsedAt
    });
    this.document.identities = this.document.identities.filter(function (row) { return row.id !== identity.id; });
    this.document.identities.push(identity);
    this._persist();
    return copy(identity);
  };

  IdentityStore.prototype.syncPlexHomeUsers = function (accountId, users, options) {
    options = options || {};
    var self = this;
    var seen = {};
    var normalizedUsers = [];
    (Array.isArray(users) ? users : []).forEach(function (user) {
      var normalized = normalizeHomeUser(user);
      if (!normalized) return;
      seen[normalized.uuid] = true;
      normalizedUsers.push(normalized);
      self.upsertPlexIdentity(accountId, normalized);
    });
    var preferred = normalizedUsers.filter(function (user) { return user.admin; })[0] || normalizedUsers[0];
    if (preferred) {
      var target = null;
      var targetKey = plexIdentityKey(accountId, preferred.uuid);
      self.document.identities.some(function (identity) {
        if (identity.key !== targetKey) return false;
        target = identity;
        return true;
      });
      self.document.identities.filter(function (identity) {
        return identity.provider === "plex" && identity.plexAccountId === accountId &&
          identity.id !== (target && target.id) && identity.homeUser &&
          (identity.homeUser.legacy === true || /^legacy-/.test(identity.homeUser.uuid));
      }).slice().forEach(function (legacyIdentity) {
        mergeIdentityRecords(self.document, target, legacyIdentity);
      });
    }
    if (options.prune === true) {
      var removedIdentityIds = {};
      self.document.identities = self.document.identities.filter(function (identity) {
        if (identity.provider !== "plex" || identity.plexAccountId !== accountId || seen[identity.homeUser.uuid]) return true;
        removedIdentityIds[identity.id] = true;
        return false;
      });
      self.document.connections = self.document.connections.filter(function (connection) {
        return !removedIdentityIds[connection.identityId];
      });
      if (removedIdentityIds[self.document.lastIdentityId]) self.document.lastIdentityId = "";
    }
    self._persist();
    return self.getIdentities("plex").filter(function (identity) { return identity.plexAccountId === accountId; });
  };

  IdentityStore.prototype.updatePlexIdentity = function (identityId, value) {
    var identity = this._identity(identityId);
    value = copy(value) || {};
    if (!identity || identity.provider !== "plex") throw new Error("Plex identity was not found.");
    if (value.homeUser) {
      var homeUser = normalizeHomeUser(value.homeUser);
      if (!homeUser || homeUser.uuid !== identity.homeUser.uuid) throw new Error("Plex Home user does not match this identity.");
      identity.homeUser = homeUser;
      identity.name = homeUser.title;
      identity.thumb = homeUser.thumb;
      identity.protected = homeUser.protected;
    }
    if (value.identityToken !== undefined || value.token !== undefined) {
      identity.identityToken = text(value.identityToken || value.token);
    }
    identity.updatedAt = this._now();
    this._persist();
    return copy(identity);
  };

  IdentityStore.prototype.upsertJellyfinIdentity = function (value) {
    value = copy(value) || {};
    var session = copy(value.session || value) || {};
    session.provider = "jellyfin";
    var key = jellyfinIdentityKey(value.baseUrl || session.baseUrl, value.userId || session.userId);
    var current = null;
    this.document.identities.some(function (identity) {
      if (identity.key !== key) return false;
      current = identity;
      return true;
    });
    var now = this._now();
    var identity = normalizeIdentity({
      id: current ? current.id : (text(value.id) || this._uuid()),
      provider: "jellyfin",
      name: value.name || value.username || (session.server && session.server.username) || (current && current.name),
      username: value.username || (session.server && session.server.username) || (current && current.username),
      token: value.token || session.token,
      baseUrl: value.baseUrl || session.baseUrl,
      userId: value.userId || session.userId,
      server: value.server || session.server,
      session: session,
      defaultConnectionId: current && current.defaultConnectionId,
      createdAt: current ? current.createdAt : now,
      updatedAt: now,
      lastUsedAt: current && current.lastUsedAt
    });
    if (!identity) throw new Error("Saved Jellyfin login is invalid.");
    this.document.identities = this.document.identities.filter(function (row) { return row.id !== identity.id; });
    this.document.identities.push(identity);
    var connection = this._upsertConnection(identity.id, {
      id: current && current.defaultConnectionId || value.connectionId,
      provider: "jellyfin",
      name: session.server && session.server.name || "Jellyfin",
      serverId: session.server && session.server.id,
      session: session
    });
    identity = this._identity(identity.id);
    if (!identity.defaultConnectionId) identity.defaultConnectionId = connection.id;
    this._persist();
    return copy(identity);
  };

  IdentityStore.prototype._upsertConnection = function (identityId, value) {
    var identity = this._identity(identityId);
    value = copy(value) || {};
    if (!identity) throw new Error("Identity was not found.");
    var session = copy(value.session) || {};
    var serverId = text(value.serverId || (session.server && session.server.id));
    var baseUrl = canonicalUrl(session.baseUrl);
    var current = null;
    this.document.connections.some(function (connection) {
      if (value.id && connection.id === value.id) { current = connection; return true; }
      if (connection.identityId !== identityId) return false;
      if (serverId && connection.serverId === serverId) { current = connection; return true; }
      if (!serverId && baseUrl && canonicalUrl(connection.session && connection.session.baseUrl) === baseUrl) { current = connection; return true; }
      return false;
    });
    var now = this._now();
    var connection = normalizeConnection({
      id: current ? current.id : (text(value.id) || this._uuid()),
      identityId: identityId,
      provider: identity.provider,
      name: value.name || (current && current.name),
      serverId: serverId || (current && current.serverId),
      identityToken: value.identityToken || (current && current.identityToken) || identity.identityToken,
      session: session,
      createdAt: current ? current.createdAt : (value.createdAt || now),
      updatedAt: now,
      lastUsedAt: value.lastUsedAt || (current && current.lastUsedAt)
    });
    if (!connection) throw new Error("Server connection is invalid.");
    this.document.connections = this.document.connections.filter(function (row) { return row.id !== connection.id; });
    this.document.connections.push(connection);
    if (!identity.defaultConnectionId) identity.defaultConnectionId = connection.id;
    identity.updatedAt = now;
    return connection;
  };

  IdentityStore.prototype.upsertConnection = function (identityId, value) {
    var connection = this._upsertConnection(identityId, value);
    this._persist();
    return copy(connection);
  };

  IdentityStore.prototype.updateConnectionSession = function (connectionId, session, extra) {
    var current = findById(this.document.connections, connectionId);
    if (!current) throw new Error("Server connection was not found.");
    extra = copy(extra) || {};
    return this.upsertConnection(current.identityId, {
      id: current.id,
      name: extra.name || current.name,
      serverId: extra.serverId || (session && session.server && session.server.id) || current.serverId,
      identityToken: extra.identityToken || (session && session.identityToken) || current.identityToken,
      session: session,
      createdAt: current.createdAt,
      lastUsedAt: current.lastUsedAt
    });
  };

  IdentityStore.prototype.setDefaultConnection = function (identityId, connectionId) {
    var identity = this._identity(identityId);
    var connection = findById(this.document.connections, connectionId);
    if (!identity) throw new Error("Identity was not found.");
    if (!connection || connection.identityId !== identityId) throw new Error("Server was not found for this identity.");
    identity.defaultConnectionId = connection.id;
    identity.updatedAt = this._now();
    this._persist();
    return copy(identity);
  };

  IdentityStore.prototype.setDefaultServer = IdentityStore.prototype.setDefaultConnection;

  IdentityStore.prototype.chooseDefaultConnection = function (identityId) {
    var identity = this._identity(identityId);
    if (!identity) return null;
    var connections = this.getConnections(identityId);
    if (!connections.length) return null;
    return connections.filter(function (connection) {
      return connection.id === identity.defaultConnectionId;
    })[0] || connections[0];
  };

  IdentityStore.prototype.getDefaultConnection = IdentityStore.prototype.chooseDefaultConnection;

  IdentityStore.prototype.touchIdentity = function (identityId, connectionId) {
    var identity = this._identity(identityId);
    if (!identity) return null;
    var now = this._now();
    var connection = connectionId ? findById(this.document.connections, connectionId) : null;
    if (connectionId && (!connection || connection.identityId !== identityId)) return null;
    identity.lastUsedAt = now;
    identity.updatedAt = now;
    if (connection) {
      connection.lastUsedAt = now;
      connection.updatedAt = now;
      identity.defaultConnectionId = connection.id;
    }
    if (identity.provider === "plex") {
      var account = findById(this.document.plexAccounts, identity.plexAccountId);
      if (account) {
        account.lastUsedAt = now;
        account.updatedAt = now;
      }
    }
    this.document.lastIdentityId = identityId;
    this._persist();
    return copy(identity);
  };

  IdentityStore.prototype.removeConnection = function (identityId, connectionId) {
    var identity = this._identity(identityId);
    if (!identity) throw new Error("Identity was not found.");
    var removed = findById(this.document.connections, connectionId);
    if (!removed || removed.identityId !== identityId) return null;
    this.document.connections = this.document.connections.filter(function (connection) { return connection.id !== connectionId; });
    if (identity.defaultConnectionId === connectionId) {
      var replacement = this.getConnections(identityId)[0];
      identity.defaultConnectionId = replacement ? replacement.id : "";
    }
    identity.updatedAt = this._now();
    this._persist();
    return copy(removed);
  };

  IdentityStore.prototype.unlinkPlexAccount = function (accountId) {
    var account = findById(this.document.plexAccounts, accountId);
    if (!account) return null;
    var identityIds = {};
    var identities = [];
    this.document.identities = this.document.identities.filter(function (identity) {
      if (identity.provider !== "plex" || identity.plexAccountId !== accountId) return true;
      identityIds[identity.id] = true;
      identities.push(copy(identity));
      return false;
    });
    var connections = [];
    this.document.connections = this.document.connections.filter(function (connection) {
      if (!identityIds[connection.identityId]) return true;
      connections.push(copy(connection));
      return false;
    });
    this.document.plexAccounts = this.document.plexAccounts.filter(function (row) { return row.id !== accountId; });
    if (identityIds[this.document.lastIdentityId]) this.document.lastIdentityId = "";
    this._persist();
    return { account: copy(account), identities: identities, connections: connections };
  };

  IdentityStore.prototype.removeJellyfinIdentity = function (identityId) {
    var identity = this._identity(identityId);
    if (!identity || identity.provider !== "jellyfin") return null;
    var connections = this.getConnections(identityId);
    this.document.identities = this.document.identities.filter(function (row) { return row.id !== identityId; });
    this.document.connections = this.document.connections.filter(function (row) { return row.identityId !== identityId; });
    if (this.document.lastIdentityId === identityId) this.document.lastIdentityId = "";
    this._persist();
    return { identity: copy(identity), connections: connections };
  };

  IdentityStore.prototype.removeSavedJellyfinLogin = IdentityStore.prototype.removeJellyfinIdentity;

  IdentityStore.prototype.getNickMode = function () {
    return this.document.nickMode === true;
  };

  IdentityStore.prototype.setNickMode = function (enabled) {
    this.document.nickMode = enabled === true;
    this._persist();
    return this.document.nickMode;
  };

  IdentityStore.prototype.getGlobalSettings = function () {
    return { nickMode: this.getNickMode() };
  };

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    V2_KEY: V2_KEY,
    LEGACY_KEY: LEGACY_KEY,
    IdentityStore: IdentityStore,
    normalizeDocument: normalizeDocument,
    defaultDocument: defaultDocument,
    plexIdentityKey: plexIdentityKey,
    jellyfinIdentityKey: jellyfinIdentityKey
  };
}));
