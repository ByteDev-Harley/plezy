(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PlezyTVApi = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PRODUCT = "Plezy TV";
  var VERSION = "2.10.5-samsung.9";
  var STORAGE_KEY = "plezy-tv-session-v1";
  var DEVICE_KEY = "plezy-tv-device-id";
  var cachedDeviceId = "";
  var PLEX_TIZEN_PROFILE = [
    "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,ac3,eac3,mp3&replace=true)",
    "add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51)",
    "add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.width&value=1920)",
    "add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.height&value=1080)",
    "add-limitation(scope=videoAudioCodec&scopeName=aac&type=upperBound&name=audio.channels&value=6)",
    "add-transcode-target(type=subtitleProfile&context=streaming&protocol=hls&container=webvtt&subtitleCodec=webvtt)"
  ].join("+");
  var Subtitles = typeof globalThis !== "undefined" ? globalThis.PlezyTVSubtitles : null;
  if (!Subtitles && typeof require === "function") {
    try { Subtitles = require("./subtitle-runtime.js"); } catch (_) { Subtitles = null; }
  }

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      var value = char === "x" ? random : (random & 3 | 8);
      return value.toString(16);
    });
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* Storage can be unavailable in preview tools. */ }
  }

  function deviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    var existing = storageGet(DEVICE_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return cachedDeviceId;
    }
    var created = uuid();
    storageSet(DEVICE_KEY, created);
    cachedDeviceId = created;
    return cachedDeviceId;
  }

  function loadSession() {
    var raw = storageGet(STORAGE_KEY);
    if (!raw) return null;
    try {
      var value = JSON.parse(raw);
      return value && value.provider ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(value) {
    storageSet(STORAGE_KEY, JSON.stringify(value));
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* no-op */ }
  }

  function trimSlash(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function joinUrl(base, path) {
    return trimSlash(base) + "/" + String(path || "").replace(/^\/+/, "");
  }

  function queryString(values) {
    var parts = [];
    Object.keys(values || {}).forEach(function (key) {
      var value = values[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    });
    return parts.join("&");
  }

  function withQuery(url, values) {
    var query = queryString(values);
    if (!query) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + query;
  }

  function array(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function truthy(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  }

  function number(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback || 0);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isOffSubtitle(selection) {
    if (Subtitles && Subtitles.isOffSelection) return Subtitles.isOffSelection(selection);
    return selection === null || selection === false || selection === -1 || selection === "-1" ||
      selection === "off" || Boolean(selection && (selection.off || selection.id === "off"));
  }

  function subtitleBySelection(tracks, selection, explicit) {
    tracks = array(tracks);
    if (explicit && isOffSubtitle(selection)) return null;
    if (selection !== undefined && selection !== null && !isOffSubtitle(selection)) {
      var selectedId = typeof selection === "object" ? (selection.id === undefined ? selection.exactTrackId : selection.id) : selection;
      var match = null;
      tracks.some(function (track) {
        if (selectedId === undefined || selectedId === null || String(track.id) !== String(selectedId)) return false;
        match = track;
        return true;
      });
      if (!match && Subtitles && Subtitles.matchSubtitleTrack && typeof selection === "object") {
        match = Subtitles.matchSubtitleTrack(tracks, selection);
      }
      if (match) return match;
    }
    var fallback = null;
    tracks.some(function (track) {
      if (!track.selected) return false;
      fallback = track;
      return true;
    });
    if (fallback) return fallback;
    tracks.some(function (track) {
      if (!track.default) return false;
      fallback = track;
      return true;
    });
    if (fallback) return fallback;
    tracks.some(function (track) {
      if (!track.forced) return false;
      fallback = track;
      return true;
    });
    return fallback;
  }

  function subtitleDeliveryForTrack(track) {
    if (!track) return "off";
    if (Subtitles && Subtitles.subtitleDeliveryFor) return Subtitles.subtitleDeliveryFor(track);
    return track.external ? "external" : "native";
  }

  function markSelectedSubtitleTracks(tracks, selected) {
    return array(tracks).map(function (track) {
      var result = Object.assign({}, track);
      result.selected = Boolean(selected && String(selected.id) === String(track.id));
      return result;
    });
  }

  function absoluteServerUrl(baseUrl, value) {
    value = String(value || "");
    if (!value) return "";
    return /^https?:\/\//i.test(value) ? value : joinUrl(baseUrl, value);
  }

  function subtitleFileExtension(codec) {
    codec = String(codec || "").toLowerCase();
    if (codec === "subrip" || codec === "srt") return "srt";
    if (codec === "webvtt" || codec === "vtt") return "vtt";
    if (codec === "ssa") return "ssa";
    if (codec === "ass") return "ass";
    return "srt";
  }

  function appendSubtitleExtension(value, extension) {
    value = String(value || "");
    var suffixAt = value.search(/[?#]/);
    var path = suffixAt === -1 ? value : value.slice(0, suffixAt);
    var suffix = suffixAt === -1 ? "" : value.slice(suffixAt);
    if (/\.(?:srt|vtt|ass|ssa)$/i.test(path)) return value;
    return path + "." + extension + suffix;
  }

  function authenticatedServerUrl(baseUrl, value, query) {
    var source = String(value || "");
    var url = absoluteServerUrl(baseUrl, source);
    if (/^https?:\/\//i.test(source)) {
      var serverBase = trimSlash(baseUrl);
      var belongsToServer = url === serverBase || url.indexOf(serverBase + "/") === 0 ||
        url.indexOf(serverBase + "?") === 0 || url.indexOf(serverBase + "#") === 0;
      if (!belongsToServer) return url;
    }
    return withQuery(url, query);
  }

  function chooseUpNext(items) {
    var playable = array(items).filter(function (item) { return item && item.playable; });
    var partial = playable.filter(function (item) {
      return item.resumeMs > 30000 && (!item.durationMs || item.resumeMs < item.durationMs - 30000);
    })[0];
    if (partial) return partial;
    var unplayed = playable.filter(function (item) {
      var raw = item.raw || {};
      var userData = raw.UserData || {};
      return number(raw.viewCount) === 0 && !raw.viewedAt && userData.Played !== true;
    })[0];
    return unplayed || playable[0] || null;
  }

  function apiError(message, response, payload) {
    var error = new Error(message);
    error.status = response ? response.status : 0;
    error.payload = payload;
    return error;
  }

  function request(url, options) {
    options = options || {};
    var timeoutMs = options.timeoutMs || 20000;
    var fetchOptions = {};
    Object.keys(options).forEach(function (key) {
      if (key !== "timeoutMs") fetchOptions[key] = options[key];
    });
    var timeout;
    var timedOut = new Promise(function (_, reject) {
      timeout = setTimeout(function () {
        reject(apiError("The server did not respond in time."));
      }, timeoutMs);
    });

    return Promise.race([fetch(url, fetchOptions), timedOut])
      .then(function (response) {
        clearTimeout(timeout);
        return response.text().then(function (text) {
          var payload = text;
          if (text) {
            try { payload = JSON.parse(text); } catch (_) { /* Some endpoints intentionally return no JSON. */ }
          }
          if (!response.ok) {
            var detail = payload && (payload.Message || payload.message || payload.error);
            throw apiError(detail || ("Request failed (" + response.status + ")."), response, payload);
          }
          return payload;
        });
      }, function (error) {
        clearTimeout(timeout);
        throw error;
      });
  }

  function plexHeaders(token) {
    var headers = {
      "Accept": "application/json",
      "X-Plex-Product": PRODUCT,
      "X-Plex-Version": VERSION,
      "X-Plex-Client-Identifier": deviceId(),
      "X-Plex-Platform": "Tizen",
      "X-Plex-Platform-Version": "6+",
      "X-Plex-Device": "Samsung TV",
      "X-Plex-Device-Name": "Plezy Samsung TV"
    };
    if (token) headers["X-Plex-Token"] = token;
    return headers;
  }

  function choosePlexConnection(connections) {
    var candidates = array(connections).filter(function (connection) {
      return connection && connection.uri;
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      function score(connection) {
        var result = 0;
        if (connection.local === true) result += 40;
        if (connection.protocol === "https" || /^https:/i.test(connection.uri)) result += 20;
        if (connection.relay === true) result -= 10;
        return result;
      }
      return score(b) - score(a);
    });
    return candidates[0];
  }

  function orderPlexServers(servers) {
    return array(servers).slice().sort(function (a, b) {
      if (Boolean(a.owned) !== Boolean(b.owned)) return a.owned ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function PlexClient(state) {
    state = state || {};
    this.provider = "plex";
    this.token = state.token || "";
    /* accountToken is the owner credential and is used only for Plex Home
       administration. identityToken belongs to the selected Home user and is
       the only credential used to discover that user's servers. */
    this.accountToken = state.accountToken || "";
    this.identityToken = state.identityToken || state.discoveryToken || "";
    this.server = state.server || null;
    this.baseUrl = state.baseUrl || "";
    this.servers = orderPlexServers(state.servers || []);
  }

  PlexClient.prototype.createPin = function () {
    return request("https://plex.tv/api/v2/pins", {
      method: "POST",
      headers: plexHeaders()
    }).then(function (pin) {
      var code = String(pin && pin.code || "").trim().toUpperCase();
      if (!pin || !pin.id || !/^[A-Z0-9]{4}$/.test(code)) {
        throw apiError("Plex did not return a four-character TV link code.");
      }
      pin.code = code;
      return pin;
    });
  };

  PlexClient.prototype.checkPin = function (pinId) {
    return request("https://plex.tv/api/v2/pins/" + encodeURIComponent(pinId), {
      headers: plexHeaders()
    });
  };

  function xmlAttributes(source) {
    var result = {};
    String(source || "").replace(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g, function (_, key, doubleValue, singleValue) {
      result[key] = doubleValue !== undefined ? doubleValue : singleValue;
      return _;
    });
    return result;
  }

  function plexHomeUser(raw) {
    raw = raw || {};
    var uuidValue = raw.uuid || raw.id || raw.userId || raw.ID;
    if (!uuidValue) return null;
    return {
      id: raw.id === undefined || raw.id === null ? "" : String(raw.id),
      uuid: String(uuidValue),
      title: raw.title || raw.name || raw.username || "Plex user",
      username: raw.username || raw.email || "",
      thumb: raw.thumb || raw.avatar || "",
      protected: truthy(raw.protected),
      admin: truthy(raw.admin || raw.owner || raw.homeAdmin || raw.restricted === false),
      raw: raw
    };
  }

  function normalizeHomeUsers(payload) {
    var users = [];
    if (typeof payload === "string") {
      var userPattern = /<User\b([^>]*)\/?\s*>/gi;
      var match;
      while ((match = userPattern.exec(payload))) users.push(xmlAttributes(match[1]));
    } else if (Array.isArray(payload)) {
      users = payload;
    } else if (payload) {
      var container = payload.MediaContainer || payload.data || payload;
      users = array(container.User || container.users || container.user || container);
    }
    return users.map(plexHomeUser).filter(Boolean);
  }

  function plexIdentityToken(payload) {
    if (!payload) return "";
    if (typeof payload === "string") {
      var match = payload.match(/(?:authToken|authenticationToken|authentication_token|auth_token)=(?:"([^"]+)"|'([^']+)')/i);
      return match ? (match[1] || match[2] || "") : "";
    }
    var container = payload.MediaContainer || payload.data || payload;
    var user = container.user || container.User || payload.user || payload.User || container;
    if (Array.isArray(user)) user = user[0] || {};
    return user.authToken || user.authenticationToken || user.authentication_token || user.auth_token || user.token || "";
  }

  PlexClient.prototype.getHomeUsers = function () {
    var token = this.accountToken;
    if (!token) return Promise.reject(apiError("Link a Plex account before choosing a Home user."));
    return request("https://clients.plex.tv/api/v2/home/users", {
      headers: plexHeaders(token)
    }).then(function (payload) {
      var users = normalizeHomeUsers(payload);
      if (!users.length) throw apiError("Plex Home did not return any users.");
      return users;
    });
  };

  PlexClient.prototype.switchHomeUser = function (userUuid, pin) {
    var self = this;
    var token = this.accountToken;
    if (!token) return Promise.reject(apiError("The linked Plex account credential is unavailable."));
    var pinValue = pin === undefined || pin === null ? "" : String(pin);
    var url = withQuery("https://clients.plex.tv/api/v2/home/users/" + encodeURIComponent(userUuid) + "/switch", {
      includeSubscriptions: 1,
      includeProviders: 1,
      includeSettings: 1,
      includeSharedSettings: 1
    });
    url += "&pin=" + encodeURIComponent(pinValue);
    return request(url, {
      method: "POST",
      headers: plexHeaders(token)
    }).then(function (payload) {
      var identityToken = plexIdentityToken(payload);
      if (!identityToken) throw apiError("Plex did not return a Home-user token.");
      self.identityToken = identityToken;
      var container = payload && (payload.data || payload.MediaContainer || payload);
      return {
        token: identityToken,
        authToken: identityToken,
        user: container && (container.user || container.User || container)
      };
    }).catch(function (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        error.code = pinValue ? "PLEX_PIN_INVALID" : "PLEX_PIN_REQUIRED";
        error.isPinError = true;
        error.recoverable = true;
        error.message = pinValue ? "That Plex Home PIN was not accepted." : "This Plex Home user requires a PIN.";
      }
      throw error;
    });
  };

  PlexClient.prototype.getServers = function (identityToken) {
    var self = this;
    var discoveryToken = identityToken || this.identityToken;
    if (!discoveryToken) return Promise.reject(apiError("A Plex Home-user token is required to discover servers."));
    if (identityToken) this.identityToken = identityToken;
    return request("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1", {
      headers: plexHeaders(discoveryToken),
      timeoutMs: 7000
    }).then(function (resources) {
      return array(resources).filter(function (resource) {
        return resource && String(resource.provides || "").split(",").indexOf("server") !== -1;
      }).map(function (resource) {
        var connection = choosePlexConnection(resource.connections);
        return {
          id: resource.clientIdentifier,
          name: resource.name || "Plex server",
          owned: resource.owned !== false,
          local: connection ? connection.local === true : false,
          relay: connection ? connection.relay === true : false,
          protocol: connection ? connection.protocol : "",
          accessToken: resource.accessToken || discoveryToken,
          baseUrl: connection ? trimSlash(connection.uri) : "",
          connections: array(resource.connections),
          raw: resource
        };
      }).filter(function (server) { return Boolean(server.baseUrl); });
    }).then(orderPlexServers).then(function (servers) {
      self.servers = servers;
      return servers;
    });
  };

  PlexClient.prototype.discoverServers = PlexClient.prototype.getServers;
  PlexClient.prototype.getServersForIdentity = PlexClient.prototype.getServers;

  PlexClient.prototype.connect = function (server) {
    this.server = {
      id: server.id,
      name: server.name,
      owned: server.owned,
      local: server.local
    };
    this.token = server.accessToken || this.token;
    this.baseUrl = trimSlash(server.baseUrl);
    return this;
  };

  PlexClient.prototype.toSession = function () {
    return {
      provider: "plex",
      token: this.token,
      identityToken: this.identityToken,
      server: this.server,
      baseUrl: this.baseUrl,
      servers: this.servers
    };
  };

  PlexClient.prototype._request = function (path, query, options) {
    options = options || {};
    var headers = plexHeaders(this.token);
    Object.keys(options.headers || {}).forEach(function (key) { headers[key] = options.headers[key]; });
    return request(withQuery(joinUrl(this.baseUrl, path), query), {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
      timeoutMs: options.timeoutMs
    });
  };

  PlexClient.prototype._container = function (payload) {
    return payload && payload.MediaContainer ? payload.MediaContainer : (payload || {});
  };

  PlexClient.prototype.imageUrl = function (path, width) {
    if (!path) return "";
    var source = /^https?:/i.test(path) ? path : joinUrl(this.baseUrl, path);
    if (!/^https?:/i.test(path)) {
      source = withQuery(source, { "X-Plex-Token": this.token });
    }
    if (!width || /^https?:/i.test(path)) return source;
    var transcodePath = "/photo/:/transcode";
    return withQuery(joinUrl(this.baseUrl, transcodePath), {
      width: width,
      height: Math.round(width * 1.5),
      minSize: 1,
      upscale: 1,
      url: path,
      "X-Plex-Token": this.token
    });
  };

  PlexClient.prototype._item = function (raw) {
    raw = raw || {};
    var viewOffset = number(raw.viewOffset);
    var duration = number(raw.duration);
    var type = String(raw.type || "video").toLowerCase();
    return {
      id: String(raw.ratingKey || raw.key || ""),
      key: raw.key || (raw.ratingKey ? "/library/metadata/" + raw.ratingKey : ""),
      title: raw.title || raw.grandparentTitle || "Untitled",
      subtitle: raw.grandparentTitle
        ? [raw.grandparentTitle, raw.parentTitle, raw.index ? "Episode " + raw.index : ""].filter(Boolean).join(" · ")
        : (raw.parentTitle || raw.originalTitle || (raw.year ? String(raw.year) : "")),
      summary: raw.summary || "",
      type: type,
      year: raw.year || null,
      thumb: this.imageUrl(raw.thumb || raw.parentThumb || raw.grandparentThumb, 420),
      art: this.imageUrl(raw.art || raw.grandparentArt || raw.thumb, 1280),
      durationMs: duration,
      resumeMs: viewOffset,
      progress: duration > 0 ? Math.min(1, viewOffset / duration) : 0,
      playable: ["movie", "episode", "clip", "track"].indexOf(type) !== -1,
      hasChildren: ["show", "season", "artist", "album"].indexOf(type) !== -1,
      raw: raw
    };
  };

  PlexClient.prototype.getLibraries = function () {
    var self = this;
    return this._request("/library/sections").then(function (payload) {
      return array(self._container(payload).Directory).map(function (raw) {
        return {
          id: String(raw.key),
          title: raw.title || "Library",
          type: raw.type || "library",
          key: raw.key,
          raw: raw
        };
      });
    });
  };

  PlexClient.prototype._hubShelves = function (payload) {
    var self = this;
    return array(this._container(payload).Hub).map(function (hub) {
      return {
        id: String(hub.hubIdentifier || hub.key || hub.title),
        title: hub.title || "Media",
        items: array(hub.Metadata || hub.Directory).map(function (item) { return self._item(item); })
      };
    }).filter(function (shelf) { return shelf.items.length; });
  };

  PlexClient.prototype._fallbackHome = function () {
    var self = this;
    var options = {
      headers: {
        "X-Plex-Container-Start": "0",
        "X-Plex-Container-Size": "24"
      }
    };
    function optional(path) {
      return self._request(path, { includeMeta: 1 }, options).catch(function (error) {
        if (error && (error.status === 401 || error.status === 403)) throw error;
        return null;
      });
    }
    return Promise.all([
      optional("/library/onDeck"),
      optional("/library/recentlyAdded")
    ]).then(function (payloads) {
      var definitions = [
        { id: "on-deck", title: "Continue Watching", payload: payloads[0] },
        { id: "recent", title: "Recently Added", payload: payloads[1] }
      ];
      return definitions.map(function (definition) {
        var container = self._container(definition.payload);
        return {
          id: definition.id,
          title: definition.title,
          items: array(container.Metadata || container.Directory).map(function (item) { return self._item(item); })
        };
      }).filter(function (shelf) { return shelf.items.length; });
    });
  };

  PlexClient.prototype.getHome = function () {
    var self = this;
    var options = {
      headers: {
        "X-Plex-Container-Start": "0",
        "X-Plex-Container-Size": "24"
      }
    };
    function loadHubs(path) {
      return self._request(path, {
        includeMetadata: 1,
        includeExternalMedia: 1,
        count: 24
      }, options).then(function (payload) { return self._hubShelves(payload); });
    }
    return loadHubs("/hubs/home").catch(function (error) {
      if (error && (error.status === 401 || error.status === 403)) throw error;
      return loadHubs("/hubs").catch(function (fallbackError) {
        if (fallbackError && (fallbackError.status === 401 || fallbackError.status === 403)) throw fallbackError;
        return [];
      });
    }).then(function (shelves) {
      return shelves.length ? shelves : self._fallbackHome();
    });
  };

  PlexClient.prototype.getLibraryItems = function (libraryId) {
    var self = this;
    return this._request("/library/sections/" + encodeURIComponent(libraryId) + "/all", {
      includeCollections: 1,
      includeMeta: 1
    }).then(function (payload) {
      var container = self._container(payload);
      return array(container.Metadata || container.Directory).map(function (item) { return self._item(item); });
    });
  };

  PlexClient.prototype.getChildren = function (itemId) {
    var self = this;
    return this._request("/library/metadata/" + encodeURIComponent(itemId) + "/children").then(function (payload) {
      var container = self._container(payload);
      return array(container.Metadata || container.Directory).map(function (item) { return self._item(item); });
    });
  };

  PlexClient.prototype.getShowUpNext = function (showId) {
    var self = this;
    return this._request("/library/metadata/" + encodeURIComponent(showId) + "/allLeaves", {
      includeMeta: 1
    }).then(function (payload) {
      var container = self._container(payload);
      return chooseUpNext(array(container.Metadata || container.Directory).map(function (item) { return self._item(item); }));
    }).catch(function (error) {
      if (error && (error.status === 401 || error.status === 403)) throw error;
      return self.getChildren(showId).then(function (seasons) {
        return Promise.all(seasons.map(function (season) {
          return self.getChildren(season.id).catch(function () { return []; });
        }));
      }).then(function (groups) {
        var episodes = [];
        groups.forEach(function (group) { episodes = episodes.concat(group); });
        return chooseUpNext(episodes);
      });
    });
  };

  PlexClient.prototype.search = function (term) {
    var self = this;
    return this._request("/hubs/search", { query: term, limit: 60 }).then(function (payload) {
      var seen = {};
      var results = [];
      array(self._container(payload).Hub).forEach(function (hub) {
        array(hub.Metadata || hub.Directory).forEach(function (raw) {
          var item = self._item(raw);
          if (item.id && !seen[item.id]) {
            seen[item.id] = true;
            results.push(item);
          }
        });
      });
      return results;
    });
  };

  PlexClient.prototype.getDetails = function (itemId, options) {
    options = options || {};
    var self = this;
    return this._request("/library/metadata/" + encodeURIComponent(itemId), {
      includeExtras: 1,
      includeChapters: 1,
      includeMedia: 1,
      includeStreamInfo: 1
    }, { timeoutMs: options.timeoutMs }).then(function (payload) {
      var raw = array(self._container(payload).Metadata)[0];
      if (!raw) throw apiError("This item is no longer available.");
      return self._item(raw);
    });
  };

  PlexClient.prototype.subtitleTracksForItem = function (item) {
    return Subtitles && Subtitles.normalizePlexSubtitleTracks
      ? Subtitles.normalizePlexSubtitleTracks(item)
      : [];
  };

  PlexClient.prototype.subtitleUrlForTrack = function (track) {
    if (!track || !track.external || !track.key) return "";
    var path = appendSubtitleExtension(track.key, subtitleFileExtension(track.codec));
    return authenticatedServerUrl(this.baseUrl, path, {
      encoding: "utf-8",
      "X-Plex-Token": this.token
    });
  };

  PlexClient.prototype.searchSubtitles = function (itemId, filters) {
    filters = filters || {};
    var self = this;
    return this._request("/library/metadata/" + encodeURIComponent(itemId) + "/subtitles", {
      language: filters.language || "en",
      title: filters.title,
      hearingImpaired: filters.hearingImpaired ? 1 : 0,
      forced: filters.forced ? 1 : 0
    }).then(function (payload) {
      return array(self._container(payload).Stream).map(function (raw) {
        return {
          id: String(raw.id === undefined || raw.id === null ? "" : raw.id),
          key: raw.key || "",
          codec: String(raw.codec || "").toLowerCase(),
          language: raw.language || "",
          languageCode: Subtitles && Subtitles.canonicalLanguage
            ? Subtitles.canonicalLanguage(raw.languageCode || filters.language)
            : (raw.languageCode || filters.language || ""),
          title: raw.displayTitle || raw.title || "",
          displayTitle: raw.displayTitle || "",
          providerTitle: raw.providerTitle || "",
          hearingImpaired: truthy(raw.hearingImpaired),
          forced: truthy(raw.forced),
          score: number(raw.score),
          downloaded: truthy(raw.downloaded),
          perfectMatch: truthy(raw.perfectMatch),
          raw: raw
        };
      });
    });
  };

  PlexClient.prototype.downloadSubtitle = function (itemId, subtitle) {
    subtitle = subtitle || {};
    return this._request("/library/metadata/" + encodeURIComponent(itemId) + "/subtitles", {
      key: subtitle.key,
      codec: subtitle.codec,
      language: subtitle.languageCode || subtitle.language,
      hearingImpaired: subtitle.hearingImpaired ? 1 : 0,
      forced: subtitle.forced ? 1 : 0,
      providerTitle: subtitle.providerTitle || subtitle.title
    }, { method: "PUT" }).then(function () { return true; });
  };

  PlexClient.prototype.waitForSubtitle = function (itemId, existingIds, options) {
    options = options || {};
    var self = this;
    var known = {};
    array(existingIds).forEach(function (id) { known[String(id)] = true; });
    var timeoutMs = Math.max(0, number(options.timeoutMs, 10000));
    var intervalMs = Math.max(0, number(options.intervalMs, 1000));
    var now = options.now || function () { return Date.now(); };
    var delay = options.delay || function (milliseconds) {
      return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    };
    var deadline = now() + timeoutMs;

    function timedOut() {
      var error = apiError("The downloaded subtitle did not appear before the 10-second timeout.");
      error.code = "SUBTITLE_DOWNLOAD_TIMEOUT";
      return error;
    }

    function waitAndPoll() {
      if (now() >= deadline) return Promise.reject(timedOut());
      return delay(Math.min(intervalMs, Math.max(0, deadline - now()))).then(poll);
    }

    function poll() {
      if (now() >= deadline) return Promise.reject(timedOut());
      return self.getDetails(itemId, { timeoutMs: Math.max(100, deadline - now()) }).then(function (detail) {
        var tracks = self.subtitleTracksForItem(detail);
        var additions = tracks.filter(function (track) { return !known[String(track.id)]; });
        var found = null;
        var wanted = options.matchResult || options.match;
        if (wanted && additions.length && Subtitles && Subtitles.matchSubtitleTrack) {
          found = Subtitles.matchSubtitleTrack(additions, wanted);
        }
        found = found || additions[0] || null;
        if (found) return { item: detail, track: found, subtitleTracks: tracks };
        return waitAndPoll();
      }).catch(function (error) {
        if (error && (error.status === 401 || error.status === 403 || error.code === "SUBTITLE_DOWNLOAD_TIMEOUT")) throw error;
        return waitAndPoll();
      });
    }

    return poll();
  };

  PlexClient.prototype.selectSubtitleStream = function (partId, subtitleStreamId) {
    return this._request("/library/parts/" + encodeURIComponent(partId), {
      subtitleStreamID: subtitleStreamId,
      allParts: 1
    }, { method: "PUT" }).then(function () { return true; });
  };

  PlexClient.prototype.createPlayback = function (item, options) {
    options = options || {};
    var self = this;
    var loadDetails = item && item.raw && item.raw.Media ? Promise.resolve(item) : this.getDetails(item.id);
    return loadDetails.then(function (detail) {
      if (!detail.playable) throw apiError("Choose a playable movie or episode.");
      var subtitleTracks = self.subtitleTracksForItem(detail);
      var explicitSubtitle = hasOwn(options, "subtitleSelection");
      var selectedSubtitle = subtitleBySelection(subtitleTracks, options.subtitleSelection, explicitSubtitle);
      subtitleTracks = markSelectedSubtitleTracks(subtitleTracks, selectedSubtitle);
      if (selectedSubtitle) {
        subtitleTracks.some(function (track) {
          if (String(track.id) !== String(selectedSubtitle.id)) return false;
          selectedSubtitle = track;
          return true;
        });
      }
      var subtitleDelivery = subtitleDeliveryForTrack(selectedSubtitle);
      var startMs = hasOwn(options, "startMs")
        ? Math.max(0, number(options.startMs))
        : Math.max(0, detail.resumeMs || 0);
      var sessionId = uuid();
      var metadataPath = "/library/metadata/" + detail.id;
      var streamUrl = withQuery(joinUrl(self.baseUrl, "/video/:/transcode/universal/start.m3u8"), {
        path: metadataPath,
        mediaIndex: 0,
        partIndex: 0,
        protocol: "hls",
        fastSeek: 1,
        directPlay: 0,
        directStream: 1,
        directStreamAudio: 1,
        hasMDE: 1,
        subtitles: subtitleDelivery === "burned" ? "burn" : (subtitleDelivery === "off" ? "none" : "auto"),
        subtitleStreamID: selectedSubtitle ? selectedSubtitle.id : (explicitSubtitle ? 0 : undefined),
        subtitleSize: 100,
        audioBoost: 100,
        videoQuality: 100,
        videoResolution: "1920x1080",
        maxVideoBitrate: 20000,
        mediaBufferSize: 60000,
        location: self.server && self.server.local === false ? "wan" : "lan",
        offset: Math.floor(startMs / 1000),
        session: sessionId,
        "X-Plex-Client-Profile-Name": "Generic",
        "X-Plex-Client-Profile-Extra": PLEX_TIZEN_PROFILE,
        "X-Plex-Client-Identifier": deviceId(),
        "X-Plex-Product": PRODUCT,
        "X-Plex-Version": VERSION,
        "X-Plex-Platform": "Tizen",
        "X-Plex-Device": "Samsung TV",
        "X-Plex-Token": self.token
      });
      var media = array(detail.raw.Media)[0] || {};
      var part = array(media.Part)[0] || {};
      var directUrl = part.key && subtitleDelivery !== "burned" && subtitleDelivery !== "external"
        ? withQuery(joinUrl(self.baseUrl, part.key), { "X-Plex-Token": self.token })
        : "";
      return {
        provider: "plex",
        item: detail,
        url: streamUrl,
        directUrl: directUrl,
        sessionId: sessionId,
        partId: part.id === undefined || part.id === null ? "" : String(part.id),
        startMs: startMs,
        durationMs: detail.durationMs,
        subtitleTracks: subtitleTracks,
        selectedSubtitle: selectedSubtitle || null,
        subtitleDelivery: subtitleDelivery,
        subtitleUrl: subtitleDelivery === "external" ? self.subtitleUrlForTrack(selectedSubtitle) : ""
      };
    });
  };

  PlexClient.prototype.rebuildPlayback = function (playback, options) {
    options = Object.assign({}, options || {});
    if (!hasOwn(options, "startMs")) options.startMs = playback && playback.startMs || 0;
    return this.createPlayback(playback && playback.item, options);
  };

  PlexClient.prototype.rebuildPlaybackUrl = PlexClient.prototype.rebuildPlayback;

  PlexClient.prototype.reportProgress = function (playback, positionMs, state) {
    if (!playback || !playback.item) return Promise.resolve();
    return this._request("/:/timeline", {
      ratingKey: playback.item.id,
      key: "/library/metadata/" + playback.item.id,
      state: state || "playing",
      time: Math.max(0, Math.round(positionMs || 0)),
      duration: Math.max(0, Math.round(playback.durationMs || playback.item.durationMs || 0)),
      playQueueItemID: playback.item.raw.playQueueItemID,
      session: playback.sessionId
    }, { timeoutMs: 7000 }).catch(function () { /* Progress reporting must not stop playback. */ });
  };

  function jellyfinAuthHeader() {
    return 'MediaBrowser Client="' + PRODUCT + '", Device="Samsung TV", DeviceId="' +
      deviceId() + '", Version="' + VERSION + '"';
  }

  function JellyfinClient(state) {
    state = state || {};
    this.provider = "jellyfin";
    this.baseUrl = trimSlash(state.baseUrl);
    this.token = state.token || "";
    this.userId = state.userId || "";
    this.server = state.server || { name: state.serverName || "Jellyfin" };
  }

  JellyfinClient.authenticate = function (baseUrl, username, password) {
    baseUrl = trimSlash(baseUrl);
    if (!/^https?:\/\//i.test(baseUrl)) {
      return Promise.reject(apiError("Server address must start with http:// or https://."));
    }
    return request(joinUrl(baseUrl, "/Users/AuthenticateByName"), {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": jellyfinAuthHeader()
      },
      body: JSON.stringify({ Username: username, Pw: password || "" })
    }).then(function (payload) {
      if (!payload || !payload.AccessToken || !payload.User) throw apiError("Jellyfin returned an incomplete sign-in response.");
      return new JellyfinClient({
        baseUrl: baseUrl,
        token: payload.AccessToken,
        userId: payload.User.Id,
        server: {
          id: payload.ServerId || "",
          name: payload.ServerName || "Jellyfin",
          username: payload.User.Name || username
        }
      });
    });
  };

  JellyfinClient.prototype.toSession = function () {
    return {
      provider: "jellyfin",
      baseUrl: this.baseUrl,
      token: this.token,
      userId: this.userId,
      server: this.server
    };
  };

  JellyfinClient.prototype._headers = function (json) {
    var headers = {
      "Accept": "application/json",
      "Authorization": jellyfinAuthHeader() + (this.token ? ', Token="' + this.token + '"' : ""),
      "X-Emby-Token": this.token
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  };

  JellyfinClient.prototype._request = function (path, query, options) {
    options = options || {};
    return request(withQuery(joinUrl(this.baseUrl, path), query), {
      method: options.method || "GET",
      headers: this._headers(Boolean(options.body)),
      body: options.body ? JSON.stringify(options.body) : undefined,
      timeoutMs: options.timeoutMs
    });
  };

  JellyfinClient.prototype.imageUrl = function (itemId, kind, width) {
    if (!itemId) return "";
    return withQuery(joinUrl(this.baseUrl, "/Items/" + encodeURIComponent(itemId) + "/Images/" + (kind || "Primary")), {
      maxWidth: width || 500,
      quality: 86,
      api_key: this.token
    });
  };

  JellyfinClient.prototype._item = function (raw) {
    raw = raw || {};
    var typeMap = {
      Movie: "movie",
      Episode: "episode",
      Series: "show",
      Season: "season",
      Audio: "track",
      MusicAlbum: "album",
      MusicArtist: "artist",
      Video: "video"
    };
    var type = typeMap[raw.Type] || String(raw.Type || "video").toLowerCase();
    var userData = raw.UserData || {};
    var durationMs = number(raw.RunTimeTicks) / 10000;
    var resumeMs = number(userData.PlaybackPositionTicks) / 10000;
    var parentTitle = raw.SeriesName || raw.Album || "";
    var episode = raw.IndexNumber ? "Episode " + raw.IndexNumber : "";
    return {
      id: String(raw.Id || ""),
      key: String(raw.Id || ""),
      title: raw.Name || "Untitled",
      subtitle: parentTitle ? [parentTitle, episode].filter(Boolean).join(" · ") : (raw.ProductionYear ? String(raw.ProductionYear) : ""),
      summary: raw.Overview || "",
      type: type,
      year: raw.ProductionYear || null,
      thumb: this.imageUrl(raw.Id, "Primary", 420),
      art: this.imageUrl(raw.Id, raw.BackdropImageTags && raw.BackdropImageTags.length ? "Backdrop/0" : "Primary", 1280),
      durationMs: durationMs,
      resumeMs: resumeMs,
      progress: durationMs > 0 ? Math.min(1, resumeMs / durationMs) : 0,
      playable: ["movie", "episode", "video", "track"].indexOf(type) !== -1,
      hasChildren: ["show", "season", "artist", "album"].indexOf(type) !== -1,
      raw: raw
    };
  };

  JellyfinClient.prototype.getLibraries = function () {
    var self = this;
    return this._request("/Users/" + encodeURIComponent(this.userId) + "/Views").then(function (payload) {
      return array(payload.Items).filter(function (raw) {
        return ["movies", "tvshows", "music", "mixed"].indexOf(String(raw.CollectionType || "").toLowerCase()) !== -1;
      }).map(function (raw) {
        return {
          id: String(raw.Id),
          title: raw.Name || "Library",
          type: raw.CollectionType || "library",
          key: raw.Id,
          raw: raw
        };
      });
    });
  };

  JellyfinClient.prototype.getHome = function () {
    var self = this;
    var common = {
      Fields: "Overview,PrimaryImageAspectRatio,MediaSources",
      ImageTypeLimit: 1,
      EnableImageTypes: "Primary,Backdrop",
      Limit: 24
    };
    return Promise.all([
      this._request("/Users/" + encodeURIComponent(this.userId) + "/Items/Resume", common),
      this._request("/Users/" + encodeURIComponent(this.userId) + "/Items/Latest", common)
    ]).then(function (payloads) {
      var shelves = [
        { id: "resume", title: "Continue Watching", items: array(payloads[0].Items).map(function (item) { return self._item(item); }) },
        { id: "latest", title: "Recently Added", items: array(payloads[1]).map(function (item) { return self._item(item); }) }
      ];
      return shelves.filter(function (shelf) { return shelf.items.length; });
    });
  };

  JellyfinClient.prototype.getLibraryItems = function (libraryId) {
    var self = this;
    return this._request("/Users/" + encodeURIComponent(this.userId) + "/Items", {
      ParentId: libraryId,
      Recursive: true,
      IncludeItemTypes: "Movie,Series",
      Fields: "Overview,PrimaryImageAspectRatio,MediaSources",
      EnableImageTypes: "Primary,Backdrop",
      ImageTypeLimit: 1,
      SortBy: "SortName",
      SortOrder: "Ascending",
      Limit: 300
    }).then(function (payload) {
      return array(payload.Items).map(function (item) { return self._item(item); });
    });
  };

  JellyfinClient.prototype.getChildren = function (itemId, knownDetail) {
    var self = this;
    return (knownDetail ? Promise.resolve(knownDetail) : this.getDetails(itemId)).then(function (detail) {
      if (detail.type === "show") {
        return self._request("/Shows/" + encodeURIComponent(itemId) + "/Seasons", {
          UserId: self.userId,
          Fields: "Overview,PrimaryImageAspectRatio"
        });
      }
      return self._request("/Shows/" + encodeURIComponent(detail.raw.SeriesId || itemId) + "/Episodes", {
        UserId: self.userId,
        SeasonId: detail.type === "season" ? itemId : detail.raw.SeasonId,
        Fields: "Overview,PrimaryImageAspectRatio,MediaSources"
      });
    }).then(function (payload) {
      return array(payload.Items).map(function (item) { return self._item(item); });
    });
  };

  JellyfinClient.prototype.getShowUpNext = function (showId) {
    var self = this;
    return this._request("/Shows/" + encodeURIComponent(showId) + "/Episodes", {
      UserId: this.userId,
      Fields: "Overview,PrimaryImageAspectRatio,MediaSources",
      SortBy: "ParentIndexNumber,IndexNumber",
      SortOrder: "Ascending"
    }).then(function (payload) {
      return chooseUpNext(array(payload.Items).map(function (item) { return self._item(item); }));
    });
  };

  JellyfinClient.prototype.search = function (term) {
    var self = this;
    return this._request("/Users/" + encodeURIComponent(this.userId) + "/Items", {
      SearchTerm: term,
      Recursive: true,
      IncludeItemTypes: "Movie,Series,Episode",
      Fields: "Overview,PrimaryImageAspectRatio,MediaSources",
      EnableImageTypes: "Primary,Backdrop",
      ImageTypeLimit: 1,
      Limit: 60
    }).then(function (payload) {
      return array(payload.Items).map(function (item) { return self._item(item); });
    });
  };

  JellyfinClient.prototype.getDetails = function (itemId) {
    var self = this;
    return this._request("/Users/" + encodeURIComponent(this.userId) + "/Items/" + encodeURIComponent(itemId), {
      Fields: "Overview,PrimaryImageAspectRatio,MediaSources,MediaStreams"
    }).then(function (payload) { return self._item(payload); });
  };

  JellyfinClient.prototype.subtitleTracksForItem = function (item) {
    return Subtitles && Subtitles.normalizeJellyfinSubtitleTracks
      ? Subtitles.normalizeJellyfinSubtitleTracks(item)
      : [];
  };

  JellyfinClient.prototype.defaultSubtitleSelectionForItem = function (item) {
    var source = item && item.raw && array(item.raw.MediaSources)[0] || {};
    if (Number(source.DefaultSubtitleStreamIndex) === -1) {
      return Subtitles && Subtitles.OFF_TRACK ? Subtitles.OFF_TRACK : { id: "off", off: true };
    }
    if (source.DefaultSubtitleStreamIndex === undefined || source.DefaultSubtitleStreamIndex === null) return null;
    var wantedIndex = Number(source.DefaultSubtitleStreamIndex);
    var selected = null;
    this.subtitleTracksForItem(item).some(function (track) {
      if (Number(track.index) !== wantedIndex) return false;
      selected = track;
      return true;
    });
    return selected;
  };

  JellyfinClient.prototype.subtitleUrlForTrack = function (itemId, mediaSourceId, track) {
    if (!track || !track.external) return "";
    var path = track.deliveryUrl;
    if (!path) {
      path = "/Videos/" + encodeURIComponent(itemId) + "/" + encodeURIComponent(mediaSourceId) +
        "/Subtitles/" + encodeURIComponent(track.index) + "/Stream." + subtitleFileExtension(track.codec);
    }
    return authenticatedServerUrl(this.baseUrl, path, { api_key: this.token });
  };

  JellyfinClient.prototype.getPlaybackInfo = function (itemId, options) {
    options = options || {};
    var subtitleIndex = options.subtitleStreamIndex;
    var startTimeTicks = Math.max(0, Math.round(number(options.startMs) * 10000));
    var body = {
      UserId: this.userId,
      DeviceId: deviceId(),
      MediaSourceId: options.mediaSourceId || undefined,
      StartTimeTicks: startTimeTicks,
      SubtitleStreamIndex: subtitleIndex,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      DeviceProfile: {
        Name: "Plezy Samsung Tizen",
        MaxStreamingBitrate: 20000000,
        TranscodingProfiles: [{
          Type: "Video",
          Context: "Streaming",
          Protocol: "hls",
          Container: "ts",
          VideoCodec: "h264",
          AudioCodec: "aac,ac3,eac3,mp3"
        }],
        SubtitleProfiles: [
          { Format: "srt", Method: "Embed" },
          { Format: "subrip", Method: "Embed" },
          { Format: "vtt", Method: "Embed" },
          { Format: "webvtt", Method: "Embed" },
          { Format: "ass", Method: "Embed" },
          { Format: "ssa", Method: "Embed" },
          { Format: "srt", Method: "External" },
          { Format: "subrip", Method: "External" },
          { Format: "vtt", Method: "External" },
          { Format: "webvtt", Method: "External" },
          { Format: "ass", Method: "External" },
          { Format: "ssa", Method: "External" },
          { Format: "pgssub", Method: "Encode" },
          { Format: "dvdsub", Method: "Encode" },
          { Format: "dvbsub", Method: "Encode" }
        ]
      }
    };
    return this._request("/Items/" + encodeURIComponent(itemId) + "/PlaybackInfo", {
      UserId: this.userId,
      MediaSourceId: options.mediaSourceId,
      StartTimeTicks: startTimeTicks,
      SubtitleStreamIndex: subtitleIndex
    }, { method: "POST", body: body });
  };

  JellyfinClient.prototype.createPlayback = function (item, options) {
    options = options || {};
    var self = this;
    var loadDetails = item && item.raw && item.raw.MediaSources ? Promise.resolve(item) : this.getDetails(item.id);
    return loadDetails.then(function (detail) {
      if (!detail.playable) throw apiError("Choose a playable movie or episode.");
      var mediaSource = array(detail.raw.MediaSources)[0] || {};
      var subtitleTracks = self.subtitleTracksForItem(detail);
      var explicitSubtitle = hasOwn(options, "subtitleSelection");
      var serverSubtitleOff = !explicitSubtitle && Number(mediaSource.DefaultSubtitleStreamIndex) === -1;
      var selectedSubtitle = serverSubtitleOff
        ? null
        : subtitleBySelection(subtitleTracks, options.subtitleSelection, explicitSubtitle);
      var requestedSubtitleIndex;
      if (explicitSubtitle) requestedSubtitleIndex = selectedSubtitle ? selectedSubtitle.index : -1;
      else if (selectedSubtitle) requestedSubtitleIndex = selectedSubtitle.index;
      else if (mediaSource.DefaultSubtitleStreamIndex !== undefined && mediaSource.DefaultSubtitleStreamIndex !== null) {
        requestedSubtitleIndex = number(mediaSource.DefaultSubtitleStreamIndex, -1);
      } else requestedSubtitleIndex = -1;
      subtitleTracks = markSelectedSubtitleTracks(subtitleTracks, selectedSubtitle);
      if (selectedSubtitle) {
        subtitleTracks.some(function (track) {
          if (String(track.id) !== String(selectedSubtitle.id)) return false;
          selectedSubtitle = track;
          return true;
        });
      }
      var startMs = hasOwn(options, "startMs")
        ? Math.max(0, number(options.startMs))
        : Math.max(0, detail.resumeMs || 0);
      var negotiate = explicitSubtitle || options.negotiate === true;
      var pendingNegotiation = negotiate ? self.getPlaybackInfo(detail.id, {
        mediaSourceId: mediaSource.Id,
        startMs: startMs,
        subtitleStreamIndex: requestedSubtitleIndex
      }).catch(function () { return null; }) : Promise.resolve(null);

      return pendingNegotiation.then(function (negotiation) {
        var negotiatedSources = negotiation && array(negotiation.MediaSources);
        var negotiatedSource = null;
        array(negotiatedSources).some(function (source) {
          if (mediaSource.Id && source.Id !== mediaSource.Id) return false;
          negotiatedSource = source;
          return true;
        });
        negotiatedSource = negotiatedSource || array(negotiatedSources)[0] || mediaSource;
        if (negotiatedSource.MediaStreams) {
          var refreshedTracks = Subtitles && Subtitles.normalizeJellyfinSubtitleTracks
            ? Subtitles.normalizeJellyfinSubtitleTracks(negotiatedSource)
            : subtitleTracks;
          var refreshedSelected = subtitleBySelection(refreshedTracks,
            selectedSubtitle || (requestedSubtitleIndex === -1 ? null : { id: String(requestedSubtitleIndex) }), true);
          subtitleTracks = markSelectedSubtitleTracks(refreshedTracks, refreshedSelected);
          selectedSubtitle = refreshedSelected;
        }
        var subtitleDelivery = subtitleDeliveryForTrack(selectedSubtitle);
        var playSessionId = negotiation && negotiation.PlaySessionId || uuid();
        var negotiatedPath = negotiatedSource.TranscodingUrl || negotiatedSource.DirectStreamUrl || "";
        var streamUrl = negotiatedPath ? absoluteServerUrl(self.baseUrl, negotiatedPath) : withQuery(
          joinUrl(self.baseUrl, "/Videos/" + encodeURIComponent(detail.id) + "/master.m3u8"), {
            UserId: self.userId,
            DeviceId: deviceId(),
            MediaSourceId: negotiatedSource.Id || mediaSource.Id,
            PlaySessionId: playSessionId,
            api_key: self.token,
            VideoCodec: "h264",
            AudioCodec: "aac",
            TranscodingContainer: "ts",
            SegmentContainer: "ts",
            AllowVideoStreamCopy: true,
            AllowAudioStreamCopy: true,
            EnableAutoStreamCopy: true,
            BreakOnNonKeyFrames: false,
            StartTimeTicks: Math.round(startMs * 10000),
            SubtitleStreamIndex: requestedSubtitleIndex
          });
        if (streamUrl.indexOf("api_key=") === -1) streamUrl = withQuery(streamUrl, { api_key: self.token });
        var directUrl = subtitleDelivery === "burned" || subtitleDelivery === "external" ? "" : withQuery(
          joinUrl(self.baseUrl, "/Videos/" + encodeURIComponent(detail.id) + "/stream"), {
            static: true,
            MediaSourceId: negotiatedSource.Id || mediaSource.Id,
            api_key: self.token
          });
        return {
          provider: "jellyfin",
          item: detail,
          url: streamUrl,
          directUrl: directUrl,
          sessionId: playSessionId,
          mediaSourceId: negotiatedSource.Id || mediaSource.Id || "",
          startMs: startMs,
          durationMs: detail.durationMs,
          subtitleTracks: subtitleTracks,
          selectedSubtitle: selectedSubtitle || null,
          subtitleDelivery: subtitleDelivery,
          subtitleStreamIndex: requestedSubtitleIndex,
          subtitleUrl: subtitleDelivery === "external"
            ? self.subtitleUrlForTrack(detail.id, negotiatedSource.Id || mediaSource.Id, selectedSubtitle)
            : ""
        };
      });
    });
  };

  JellyfinClient.prototype.rebuildPlayback = function (playback, options) {
    options = Object.assign({}, options || {});
    if (!hasOwn(options, "startMs")) options.startMs = playback && playback.startMs || 0;
    return this.createPlayback(playback && playback.item, options);
  };

  JellyfinClient.prototype.rebuildPlaybackUrl = JellyfinClient.prototype.rebuildPlayback;

  JellyfinClient.prototype.reportProgress = function (playback, positionMs, state) {
    if (!playback || !playback.item) return Promise.resolve();
    var endpoint;
    if (state === "stopped") endpoint = "Stopped";
    else if (!playback.progressStarted) {
      endpoint = "";
      playback.progressStarted = true;
    } else endpoint = "Progress";
    var path = "/Sessions/Playing" + (endpoint ? "/" + endpoint : "");
    return this._request(path, null, {
      method: "POST",
      timeoutMs: 7000,
      body: {
        ItemId: playback.item.id,
        MediaSourceId: playback.mediaSourceId,
        PlaySessionId: playback.sessionId,
        PositionTicks: Math.max(0, Math.round((positionMs || 0) * 10000)),
        IsPaused: state === "paused",
        PlayMethod: "Transcode"
      }
    }).catch(function () { /* Progress reporting must not stop playback. */ });
  };

  function clientFromSession(session) {
    if (!session) return null;
    if (session.provider === "plex") return new PlexClient(session);
    if (session.provider === "jellyfin") return new JellyfinClient(session);
    return null;
  }

  function authFailure(error) {
    return Boolean(error && (error.status === 401 || error.status === 403));
  }

  function cancelledError() {
    var error = apiError("Identity activation was cancelled.");
    error.code = "ACTIVATION_CANCELLED";
    error.cancelled = true;
    error.recoverable = true;
    return error;
  }

  function activationFailure(identity, connection, error) {
    return {
      ok: false,
      identity: clone(identity),
      connection: clone(connection),
      client: null,
      session: null,
      recoverable: Boolean(error && (error.recoverable || error.cancelled || authFailure(error))),
      error: {
        message: error && error.message ? error.message : "Could not activate this identity.",
        status: error && error.status || 0,
        code: error && error.code || "ACTIVATION_FAILED",
        cancelled: Boolean(error && error.cancelled),
        pinRequired: Boolean(error && error.isPinError)
      }
    };
  }

  function activateIdentity(identity, connection, account, options) {
    options = options || {};
    identity = clone(identity);
    connection = clone(connection);
    account = clone(account);
    if (!identity || (identity.provider !== "plex" && identity.provider !== "jellyfin")) {
      return Promise.resolve(activationFailure(identity, connection, apiError("The saved identity is incomplete.")));
    }
    if (identity.provider === "plex" && (!account || account.id !== identity.plexAccountId || !account.token ||
        !identity.homeUser || !identity.homeUser.uuid)) {
      return Promise.resolve(activationFailure(identity, connection, apiError("The linked Plex account is incomplete.")));
    }
    if (connection && connection.identityId !== identity.id) {
      return Promise.resolve(activationFailure(identity, connection, apiError("The saved server does not belong to this identity.")));
    }
    var session = clone(connection && connection.session || identity.session) || {};
    session.provider = identity.provider;
    if (identity.provider === "jellyfin") {
      session.token = session.token || identity.token;
      session.userId = session.userId || identity.userId;
      session.baseUrl = session.baseUrl || identity.baseUrl;
      session.server = session.server || identity.server;
    } else {
      session.identityToken = identity.identityToken || session.identityToken;
      session.accountToken = account.token;
    }
    var client = clientFromSession(session);
    var validationValue = null;
    if (!client) return Promise.resolve(activationFailure(identity, connection, apiError("This provider is not supported.")));

    function validate() {
      var pending = typeof options.validate === "function"
        ? Promise.resolve(options.validate(client))
        : client.getLibraries();
      return pending.then(function (value) {
        validationValue = value;
        return value;
      });
    }

    function chooseServer(servers) {
      var wantedServerId = connection && (connection.serverId ||
        (connection.session && connection.session.server && connection.session.server.id));
      var selected = null;
      servers.some(function (server) {
        if (!wantedServerId || server.id !== wantedServerId) return false;
        selected = server;
        return true;
      });
      if (selected) return Promise.resolve(selected);
      if (typeof options.chooseServer !== "function") {
        var unavailable = apiError(wantedServerId
          ? "The last Plex server is no longer available to this Home user."
          : "Choose a Plex server for this Home user.");
        unavailable.code = wantedServerId ? "PLEX_SERVER_UNAVAILABLE" : "PLEX_SERVER_REQUIRED";
        unavailable.recoverable = true;
        unavailable.servers = clone(servers);
        return Promise.reject(unavailable);
      }
      return Promise.resolve(options.chooseServer(clone(servers), clone(identity), wantedServerId ? "unavailable" : "required"))
        .then(function (choice) {
          if (choice === null || choice === undefined || choice === false) throw cancelledError();
          if (typeof choice === "number") selected = servers[choice] || null;
          else if (typeof choice === "string") {
            servers.some(function (server) {
              if (server.id !== choice) return false;
              selected = server;
              return true;
            });
          } else if (choice && choice.id) {
            servers.some(function (server) {
              if (server.id !== choice.id) return false;
              selected = server;
              return true;
            });
          }
          if (!selected) throw apiError("The selected Plex server is unavailable.");
          return selected;
        });
    }

    function switchAndDiscover(pin, renewed) {
      return client.switchHomeUser(identity.homeUser.uuid, pin).then(function (switched) {
        var refreshedHomeUser = plexHomeUser(switched.user);
        if (refreshedHomeUser && refreshedHomeUser.uuid === identity.homeUser.uuid) {
          identity.homeUser = refreshedHomeUser;
          identity.name = refreshedHomeUser.title;
          identity.thumb = refreshedHomeUser.thumb;
          identity.protected = refreshedHomeUser.protected;
        }
        return client.getServers(switched.token).then(function (servers) {
          if (!servers.length) throw apiError("No Plex Media Server is available to this Home user.");
          return chooseServer(servers).then(function (selected) {
            client.connect(selected);
            identity.identityToken = switched.token;
            var savedServerId = connection && (connection.serverId ||
              (connection.session && connection.session.server && connection.session.server.id));
            /* A picker choice must not reuse another server's connection ID.
               Keeping it would overwrite that saved session and could create
               duplicate rows for a server that was already known. */
            var connectionBase = savedServerId && savedServerId === selected.id ? connection : {};
            connection = Object.assign({}, connectionBase, {
              identityId: identity.id,
              provider: "plex",
              name: selected.name,
              serverId: selected.id,
              identityToken: switched.token,
              session: client.toSession()
            });
            return validate();
          });
        });
      }).catch(function (error) {
        /* A newly minted Home token or server token can already have expired
           by the time resources or libraries are requested. Re-mint once;
           PIN failures stay in the dedicated prompt/retry flow. */
        if (!renewed && authFailure(error) && !error.isPinError) return switchAndDiscover(pin, true);
        throw error;
      });
    }

    function requestPin(error, attempt) {
      if (typeof options.requestPin !== "function") {
        error = error || apiError("A Plex Home PIN is required.");
        error.code = "PLEX_PIN_REQUIRED";
        error.isPinError = true;
        error.recoverable = true;
        return Promise.reject(error);
      }
      return Promise.resolve(options.requestPin(clone(identity.homeUser), error || null)).then(function (pin) {
        if (pin === null || pin === undefined || pin === false) throw cancelledError();
        pin = String(pin).trim();
        if (!/^\d{4}$/.test(pin)) {
          var invalid = apiError("Enter the four-digit Plex Home PIN.");
          invalid.code = "PLEX_PIN_INVALID";
          invalid.isPinError = true;
          invalid.recoverable = true;
          throw invalid;
        }
        return switchAndDiscover(pin, false).catch(function (switchError) {
          if (switchError && switchError.isPinError && attempt < 1) return requestPin(switchError, attempt + 1);
          throw switchError;
        });
      });
    }

    var activation;
    if (identity.provider === "plex") {
      activation = identity.protected || identity.homeUser.protected
        ? requestPin(null, 0)
        : switchAndDiscover("", false).catch(function (error) {
          if (error && error.isPinError) return requestPin(error, 0);
          throw error;
        });
    } else {
      activation = validate();
    }

    return activation.then(function () {
      var resultSession = client.toSession();
      if (identity.provider === "plex") {
        delete resultSession.accountToken;
        identity.identityToken = client.identityToken;
        connection.identityToken = client.identityToken;
        connection.serverId = client.server && client.server.id || connection.serverId;
        connection.session = clone(resultSession);
      }
      return {
        ok: true,
        identity: identity,
        connection: connection,
        client: client,
        session: resultSession,
        validation: validationValue,
        recoverable: false,
        error: null
      };
    }).catch(function (error) {
      return activationFailure(identity, connection, error);
    });
  }

  return {
    PRODUCT: PRODUCT,
    VERSION: VERSION,
    PlexClient: PlexClient,
    JellyfinClient: JellyfinClient,
    choosePlexConnection: choosePlexConnection,
    orderPlexServers: orderPlexServers,
    chooseUpNext: chooseUpNext,
    normalizeHomeUsers: normalizeHomeUsers,
    plexIdentityToken: plexIdentityToken,
    activateIdentity: activateIdentity,
    clientFromSession: clientFromSession,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    deviceId: deviceId,
    joinUrl: joinUrl,
    queryString: queryString,
    withQuery: withQuery,
    trimSlash: trimSlash,
    array: array
  };
}));
