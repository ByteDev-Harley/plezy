(function (root, factory) {
  var moduleValue = factory();
  if (typeof module === "object" && module.exports) module.exports = moduleValue;
  root.PlezyTVProfiles = moduleValue;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 2;
  var STORAGE_KEY = "plezy-tv-profiles-v2";
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

  function provider(value) {
    value = text(value).toLowerCase();
    return value === "plex" || value === "jellyfin" ? value : "";
  }

  function defaultDocument() {
    return {
      version: VERSION,
      profiles: [],
      accounts: [],
      bindings: [],
      lastProfileId: "",
      updatedAt: 0
    };
  }

  function normalizeProfile(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id);
    var name = text(row.name);
    if (!id || !name) return null;
    return {
      id: id,
      name: name.slice(0, 40),
      nickMode: row.nickMode === true,
      defaultConnectionId: text(row.defaultConnectionId || row.defaultBindingId),
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
  }

  function normalizeAccount(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id);
    var kind = provider(row.provider);
    if (!id || !kind || !text(row.token)) return null;
    var result = {
      id: id,
      provider: kind,
      name: text(row.name) || (kind === "plex" ? "Plex account" : "Jellyfin account"),
      token: text(row.token),
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
    if (kind === "plex") {
      result.accountId = text(row.accountId || row.uuid || row.userId);
      result.username = text(row.username || row.email);
      result.thumb = text(row.thumb);
    } else {
      result.baseUrl = text(row.baseUrl);
      result.userId = text(row.userId);
      result.server = copy(row.server) || null;
    }
    return result;
  }

  function normalizeBinding(row) {
    if (!row || typeof row !== "object") return null;
    var id = text(row.id || row.connectionId);
    var profileId = text(row.profileId);
    var accountId = text(row.accountId);
    var kind = provider(row.provider);
    var session = copy(row.session);
    if (!id || !profileId || !accountId || !kind || !session || typeof session !== "object") return null;
    if (provider(session.provider) && provider(session.provider) !== kind) return null;
    session.provider = kind;
    var result = {
      id: id,
      profileId: profileId,
      accountId: accountId,
      provider: kind,
      name: text(row.name) || (session.server && text(session.server.name)) || (kind === "plex" ? "Plex" : "Jellyfin"),
      session: session,
      createdAt: timestamp(row.createdAt),
      updatedAt: timestamp(row.updatedAt),
      lastUsedAt: timestamp(row.lastUsedAt)
    };
    if (kind === "plex") {
      result.identityToken = text(row.identityToken || session.identityToken || session.discoveryToken);
      result.homeUser = copy(row.homeUser) || null;
      result.serverId = text(row.serverId || (session.server && session.server.id));
      result.protected = row.protected === true || Boolean(result.homeUser && result.homeUser.protected === true);
      /* A Plex account credential lives only in accounts. A binding owns the
         selected Home identity and server credentials used for browsing. */
      delete result.session.accountToken;
      if (result.identityToken) result.session.identityToken = result.identityToken;
    }
    return result;
  }

  function normalizeDocument(value) {
    var result = defaultDocument();
    if (!value || typeof value !== "object" || Number(value.version) !== VERSION) return result;
    var profileIds = {};
    var accountIds = {};
    var bindingIds = {};

    (Array.isArray(value.profiles) ? value.profiles : []).forEach(function (row) {
      var profile = normalizeProfile(row);
      if (!profile || profileIds[profile.id]) return;
      profileIds[profile.id] = true;
      result.profiles.push(profile);
    });
    (Array.isArray(value.accounts) ? value.accounts : []).forEach(function (row) {
      var account = normalizeAccount(row);
      if (!account || accountIds[account.id]) return;
      accountIds[account.id] = true;
      result.accounts.push(account);
    });
    (Array.isArray(value.bindings) ? value.bindings : []).forEach(function (row) {
      var binding = normalizeBinding(row);
      if (!binding || bindingIds[binding.id] || !profileIds[binding.profileId] || !accountIds[binding.accountId]) return;
      var account = null;
      result.accounts.some(function (candidate) {
        if (candidate.id !== binding.accountId) return false;
        account = candidate;
        return true;
      });
      if (!account || account.provider !== binding.provider) return;
      bindingIds[binding.id] = true;
      result.bindings.push(binding);
    });
    result.profiles.forEach(function (profile) {
      var validDefault = false;
      result.bindings.some(function (binding) {
        if (binding.id !== profile.defaultConnectionId || binding.profileId !== profile.id) return false;
        validDefault = true;
        return true;
      });
      if (!validDefault) profile.defaultConnectionId = "";
    });
    result.lastProfileId = profileIds[text(value.lastProfileId)] ? text(value.lastProfileId) : "";
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

  function ProfileStore(storageOrOptions, maybeOptions) {
    var resolved = resolveOptions(storageOrOptions, maybeOptions);
    this.storage = resolved.storage;
    this.storageKey = resolved.options.storageKey || STORAGE_KEY;
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

  ProfileStore.prototype._get = function (key) {
    if (!this.storage || typeof this.storage.getItem !== "function") return null;
    try { return this.storage.getItem(key); } catch (error) {
      this.available = false;
      this.lastError = error;
      return null;
    }
  };

  ProfileStore.prototype._set = function (key, value) {
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

  ProfileStore.prototype._remove = function (key) {
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

  ProfileStore.prototype.load = function () {
    var raw = this._get(this.storageKey);
    if (!raw) {
      this.document = defaultDocument();
      return copy(this.document);
    }
    try {
      this.document = normalizeDocument(JSON.parse(raw));
    } catch (error) {
      /* Loading is deliberately non-destructive. Bad persisted rows and JSON
         remain available for recovery until the user performs a real edit. */
      this.lastError = error;
      this.document = defaultDocument();
    }
    return copy(this.document);
  };

  ProfileStore.prototype._persist = function () {
    this.document.version = VERSION;
    this.document.updatedAt = this._now();
    return this._set(this.storageKey, JSON.stringify(this.document));
  };

  ProfileStore.prototype.save = function () {
    this._persist();
    return copy(this.document);
  };

  ProfileStore.prototype.migrateLegacy = function () {
    var existingRaw = this._get(this.storageKey);
    if (existingRaw) {
      this.load();
      return copy(this.document);
    }
    var legacyRaw = this._get(this.legacyKey);
    if (!legacyRaw) return this.load();
    var session;
    try { session = JSON.parse(legacyRaw); } catch (_) { return this.load(); }
    var kind = session && provider(session.provider);
    if (!kind) return this.load();

    var now = this._now();
    var profileId = this._uuid();
    var accountId = this._uuid();
    var bindingId = this._uuid();
    var account = {
      id: accountId,
      provider: kind,
      name: kind === "plex" ? "Plex account" : ((session.server && session.server.username) || "Jellyfin account"),
      token: kind === "plex"
        ? text(session.accountToken || session.identityToken || session.token)
        : text(session.token),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    };
    if (kind === "jellyfin") {
      account.baseUrl = text(session.baseUrl);
      account.userId = text(session.userId);
      account.server = copy(session.server) || null;
    }
    var migratedSession = copy(session) || {};
    if (kind === "plex") {
      migratedSession.identityToken = text(session.identityToken || session.accountToken || session.token);
      delete migratedSession.accountToken;
    }
    var binding = {
      id: bindingId,
      profileId: profileId,
      accountId: accountId,
      provider: kind,
      name: (session.server && text(session.server.name)) || (kind === "plex" ? "Plex" : "Jellyfin"),
      session: migratedSession,
      identityToken: kind === "plex" ? migratedSession.identityToken : undefined,
      serverId: kind === "plex" && session.server ? text(session.server.id) : undefined,
      homeUser: kind === "plex" ? { uuid: "", title: "Plex user", protected: false, legacy: true } : undefined,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    };
    var candidate = normalizeDocument({
      version: VERSION,
      profiles: [{
        id: profileId,
        name: "Default",
        defaultConnectionId: bindingId,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now
      }],
      accounts: [account],
      bindings: [binding],
      lastProfileId: profileId,
      updatedAt: now
    });
    if (candidate.profiles.length !== 1 || candidate.accounts.length !== 1 || candidate.bindings.length !== 1) {
      this.document = defaultDocument();
      return copy(this.document);
    }
    var serialized = JSON.stringify(candidate);
    if (!this._set(this.storageKey, serialized)) return this.load();

    /* localStorage can fail silently in some TV privacy modes. Read back and
       validate before removing the only copy of the legacy credential. */
    var verifiedRaw = this._get(this.storageKey);
    var verified = null;
    try { verified = normalizeDocument(JSON.parse(verifiedRaw)); } catch (_) { verified = null; }
    if (verifiedRaw !== serialized || !verified || verified.profiles.length !== 1 || verified.bindings.length !== 1 ||
        verified.profiles[0].id !== profileId || verified.bindings[0].id !== bindingId) {
      this.document = candidate;
      return copy(this.document);
    }
    this.document = verified;
    this._remove(this.legacyKey);
    return copy(this.document);
  };

  ProfileStore.prototype._profile = function (profileId) {
    var found = null;
    this.document.profiles.some(function (profile) {
      if (profile.id !== profileId) return false;
      found = profile;
      return true;
    });
    return found;
  };

  ProfileStore.prototype.getProfile = function (profileId) {
    return copy(this._profile(profileId));
  };

  ProfileStore.prototype.getProfiles = function () {
    return copy(this.document.profiles.slice().sort(function (a, b) {
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name);
    }));
  };

  ProfileStore.prototype.getAccount = function (accountId) {
    var found = null;
    this.document.accounts.some(function (account) {
      if (account.id !== accountId) return false;
      found = account;
      return true;
    });
    return copy(found);
  };

  ProfileStore.prototype.getAccounts = function (kind) {
    kind = provider(kind);
    return copy(this.document.accounts.filter(function (account) {
      return !kind || account.provider === kind;
    }));
  };

  ProfileStore.prototype.getBindings = function (profileId) {
    return copy(this.document.bindings.filter(function (binding) {
      return !profileId || binding.profileId === profileId;
    }).sort(function (a, b) {
      return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name);
    }));
  };

  ProfileStore.prototype.getBinding = function (bindingId) {
    var found = null;
    this.document.bindings.some(function (binding) {
      if (binding.id !== bindingId) return false;
      found = binding;
      return true;
    });
    return copy(found);
  };

  ProfileStore.prototype.createProfile = function (name) {
    name = text(name);
    if (!name) throw new Error("Profile name is required.");
    var now = this._now();
    var profile = {
      id: this._uuid(),
      name: name.slice(0, 40),
      nickMode: false,
      defaultConnectionId: "",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: 0
    };
    this.document.profiles.push(profile);
    this._persist();
    return copy(profile);
  };

  ProfileStore.prototype.renameProfile = function (profileId, name) {
    var profile = this._profile(profileId);
    name = text(name);
    if (!profile) throw new Error("Profile was not found.");
    if (!name) throw new Error("Profile name is required.");
    profile.name = name.slice(0, 40);
    profile.updatedAt = this._now();
    this._persist();
    return copy(profile);
  };

  ProfileStore.prototype.setNickMode = function (profileId, enabled) {
    var profile = this._profile(profileId);
    if (!profile) throw new Error("Profile was not found.");
    profile.nickMode = enabled === true;
    profile.updatedAt = this._now();
    this._persist();
    return copy(profile);
  };

  ProfileStore.prototype.upsertAccount = function (value) {
    value = copy(value) || {};
    if (!value.id) value.id = this._uuid();
    var now = this._now();
    if (!value.createdAt) value.createdAt = now;
    value.updatedAt = now;
    var account = normalizeAccount(value);
    if (!account) throw new Error("Provider account is invalid.");
    var replaced = false;
    this.document.accounts = this.document.accounts.map(function (current) {
      if (current.id !== account.id) return current;
      replaced = true;
      account.createdAt = current.createdAt || account.createdAt;
      return account;
    });
    if (!replaced) this.document.accounts.push(account);
    this._persist();
    return copy(account);
  };

  ProfileStore.prototype.addAccount = ProfileStore.prototype.upsertAccount;
  ProfileStore.prototype.upsertProviderAccount = ProfileStore.prototype.upsertAccount;

  ProfileStore.prototype.bindConnection = function (profileId, value) {
    var profile = this._profile(profileId);
    if (!profile) throw new Error("Profile was not found.");
    value = copy(value) || {};
    value.id = value.id || value.connectionId || this._uuid();
    value.profileId = profileId;
    var now = this._now();
    if (!value.createdAt) value.createdAt = now;
    value.updatedAt = now;
    var binding = normalizeBinding(value);
    if (!binding) throw new Error("Connection binding is invalid.");
    var account = this.getAccount(binding.accountId);
    if (!account || account.provider !== binding.provider) throw new Error("Connection account is invalid.");
    var replaced = false;
    this.document.bindings = this.document.bindings.map(function (current) {
      if (current.id !== binding.id) return current;
      if (current.profileId !== profileId) throw new Error("A connection cannot move between profiles.");
      replaced = true;
      binding.createdAt = current.createdAt || binding.createdAt;
      return binding;
    });
    if (!replaced) this.document.bindings.push(binding);
    if (!profile.defaultConnectionId) profile.defaultConnectionId = binding.id;
    profile.updatedAt = now;
    this._persist();
    return copy(binding);
  };

  ProfileStore.prototype.bind = ProfileStore.prototype.bindConnection;

  ProfileStore.prototype.setDefaultConnection = function (profileId, bindingId) {
    var profile = this._profile(profileId);
    var binding = this.getBinding(bindingId);
    if (!profile) throw new Error("Profile was not found.");
    if (!binding || binding.profileId !== profileId) throw new Error("Connection was not found for this profile.");
    profile.defaultConnectionId = bindingId;
    profile.updatedAt = this._now();
    this._persist();
    return copy(profile);
  };

  ProfileStore.prototype.setDefaultBinding = ProfileStore.prototype.setDefaultConnection;

  ProfileStore.prototype.chooseDefaultConnection = function (profileId) {
    var profile = this._profile(profileId);
    if (!profile) return null;
    var connections = this.getBindings(profileId);
    if (!connections.length) return null;
    var selected = null;
    connections.some(function (binding) {
      if (binding.id !== profile.defaultConnectionId) return false;
      selected = binding;
      return true;
    });
    return selected || connections[0];
  };

  ProfileStore.prototype.getDefaultConnection = ProfileStore.prototype.chooseDefaultConnection;
  ProfileStore.prototype.chooseDefaultBinding = ProfileStore.prototype.chooseDefaultConnection;

  ProfileStore.prototype.touchConnection = function (profileId, bindingId) {
    var profile = this._profile(profileId);
    var now = this._now();
    if (!profile) return null;
    var validBinding = false;
    this.document.bindings.forEach(function (binding) {
      if (binding.id === bindingId && binding.profileId === profileId) {
        validBinding = true;
        binding.lastUsedAt = now;
        binding.updatedAt = now;
      }
    });
    if (!validBinding) return null;
    var activeBinding = null;
    this.document.bindings.some(function (binding) {
      if (binding.id !== bindingId) return false;
      activeBinding = binding;
      return true;
    });
    this.document.accounts.forEach(function (account) {
      if (activeBinding && account.id === activeBinding.accountId) {
        account.lastUsedAt = now;
        account.updatedAt = now;
      }
    });
    profile.lastUsedAt = now;
    profile.updatedAt = now;
    profile.defaultConnectionId = bindingId || profile.defaultConnectionId;
    this.document.lastProfileId = profileId;
    this._persist();
    return copy(profile);
  };

  ProfileStore.prototype.updateBindingSession = function (bindingId, session, extra) {
    var binding = null;
    var now = this._now();
    this.document.bindings.some(function (candidate) {
      if (candidate.id !== bindingId) return false;
      binding = candidate;
      return true;
    });
    if (!binding) throw new Error("Connection was not found.");
    binding.session = copy(session) || {};
    binding.session.provider = binding.provider;
    if (binding.session.server && text(binding.session.server.name)) binding.name = text(binding.session.server.name);
    if (binding.provider === "plex") {
      delete binding.session.accountToken;
      binding.identityToken = text(extra && extra.identityToken || binding.session.identityToken || binding.identityToken);
      if (binding.identityToken) binding.session.identityToken = binding.identityToken;
      if (extra && extra.homeUser) binding.homeUser = copy(extra.homeUser);
      binding.serverId = text(extra && extra.serverId || (binding.session.server && binding.session.server.id) || binding.serverId);
    }
    binding.updatedAt = now;
    var normalized = normalizeBinding(binding);
    if (!normalized) throw new Error("Connection session is invalid.");
    this.document.bindings = this.document.bindings.map(function (candidate) {
      return candidate.id === bindingId ? normalized : candidate;
    });
    this._persist();
    return copy(normalized);
  };

  ProfileStore.prototype.removeUnreferencedCredentials = function (deferPersist) {
    var referenced = {};
    this.document.bindings.forEach(function (binding) { referenced[binding.accountId] = true; });
    var removed = [];
    this.document.accounts = this.document.accounts.filter(function (account) {
      if (referenced[account.id]) return true;
      removed.push(copy(account));
      return false;
    });
    if (removed.length && !deferPersist) this._persist();
    return removed;
  };

  ProfileStore.prototype.unbindConnection = function (profileId, bindingId) {
    var profile = this._profile(profileId);
    if (!profile) throw new Error("Profile was not found.");
    var removed = null;
    this.document.bindings = this.document.bindings.filter(function (binding) {
      if (binding.id !== bindingId || binding.profileId !== profileId) return true;
      removed = binding;
      return false;
    });
    if (!removed) return null;
    if (profile.defaultConnectionId === bindingId) {
      var remaining = this.document.bindings.filter(function (binding) { return binding.profileId === profileId; });
      remaining.sort(function (a, b) { return b.lastUsedAt - a.lastUsedAt; });
      profile.defaultConnectionId = remaining.length ? remaining[0].id : "";
    }
    profile.updatedAt = this._now();
    this.removeUnreferencedCredentials(true);
    this._persist();
    return copy(removed);
  };

  ProfileStore.prototype.unbind = ProfileStore.prototype.unbindConnection;

  ProfileStore.prototype.deleteProfile = function (profileId) {
    var profile = this._profile(profileId);
    if (!profile) return null;
    var removedBindings = [];
    this.document.profiles = this.document.profiles.filter(function (candidate) { return candidate.id !== profileId; });
    this.document.bindings = this.document.bindings.filter(function (binding) {
      if (binding.profileId !== profileId) return true;
      removedBindings.push(copy(binding));
      return false;
    });
    var removedAccounts = this.removeUnreferencedCredentials(true);
    if (this.document.lastProfileId === profileId) this.document.lastProfileId = "";
    this._persist();
    return { profile: copy(profile), bindings: removedBindings, accounts: removedAccounts };
  };

  ProfileStore.prototype.removeAccount = function (accountId) {
    var referenced = this.document.bindings.some(function (binding) { return binding.accountId === accountId; });
    if (referenced) return false;
    var before = this.document.accounts.length;
    this.document.accounts = this.document.accounts.filter(function (account) { return account.id !== accountId; });
    if (this.document.accounts.length !== before) this._persist();
    return this.document.accounts.length !== before;
  };

  ProfileStore.prototype.create = ProfileStore.prototype.createProfile;
  ProfileStore.prototype.rename = ProfileStore.prototype.renameProfile;
  ProfileStore.prototype.removeProfile = ProfileStore.prototype.deleteProfile;
  ProfileStore.prototype.setDefault = ProfileStore.prototype.setDefaultConnection;
  ProfileStore.prototype.chooseDefault = ProfileStore.prototype.chooseDefaultConnection;
  ProfileStore.prototype.removeUnreferencedAccounts = ProfileStore.prototype.removeUnreferencedCredentials;

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    LEGACY_KEY: LEGACY_KEY,
    ProfileStore: ProfileStore,
    normalizeDocument: normalizeDocument,
    defaultDocument: defaultDocument
  };
}));
