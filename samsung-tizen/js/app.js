(function () {
  "use strict";

  var Api = window.PlezyTVApi;
  var Navigation = window.PlezyTVNavigation;
  var Identities = window.PlezyTVIdentities;
  var Subtitles = window.PlezyTVSubtitles;
  var STANDARD_LOGO_SOURCE = "icon.png";
  var NICK_MODE_LOGO_SOURCE = "nick-mode.png";
  var requestFrame = window.requestAnimationFrame
    ? function (callback) { return window.requestAnimationFrame(callback); }
    : function (callback) { return setTimeout(function () { callback(Date.now()); }, 16); };
  var cancelFrame = window.cancelAnimationFrame
    ? function (handle) { window.cancelAnimationFrame(handle); }
    : clearTimeout;
  var state = {
    client: null,
    identityStore: null,
    subtitleStore: null,
    activeIdentity: null,
    activeConnection: null,
    setupAccount: null,
    setupServers: [],
    setupReturnScreen: "identity-picker",
    serverResolver: null,
    providerRefreshRevision: 0,
    confirmAction: null,
    confirmReturnScreen: "identity-picker",
    pinResolver: null,
    activationRevision: 0,
    screen: "loading",
    route: "home",
    libraries: [],
    libraryItems: [],
    libraryVisibleCount: 0,
    searchItems: [],
    searchVisibleCount: 0,
    contentRevision: 0,
    items: {},
    currentDetail: null,
    currentPlayTarget: null,
    detailStack: [],
    pendingServers: [],
    pinTimer: null,
    pinStartedAt: 0,
    toastTimer: null,
    player: null,
    navigation: null,
    navigationFrame: 0,
    pendingFocus: null,
    repeatGate: null,
    performanceDiagnostics: null,
    lastBackAt: 0,
    suppressExitUntil: 0
  };

  function byId(id) { return document.getElementById(id); }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function closest(element, selector) {
    while (element && element !== document) {
      if (element.matches && element.matches(selector)) return element;
      element = element.parentElement;
    }
    return null;
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = value === undefined || value === null ? "" : String(value);
  }

  function applyBranding(enabled) {
    enabled = enabled === true;
    var appRoot = byId("app");
    if (appRoot) appRoot.classList.toggle("nick-mode", enabled);
    all(".main-logo").forEach(function (logo) {
      logo.setAttribute("src", enabled ? NICK_MODE_LOGO_SOURCE : STANDARD_LOGO_SOURCE);
      var alternateText = logo.getAttribute(enabled ? "data-nick-alt" : "data-standard-alt");
      if (alternateText !== null) logo.setAttribute("alt", alternateText);
    });
    setText("loading-message", enabled ? "Summoning Nick…" : "Starting Plezy TV…");
    setText("identity-picker-eyebrow", enabled ? "WHO’S NICKING?" : "WHO'S WATCHING?");
  }

  function applyGlobalBranding() {
    applyBranding(Boolean(state.identityStore && state.identityStore.getNickMode()));
  }

  function show(element) { if (element) element.classList.remove("hidden"); }
  function hide(element) { if (element) element.classList.add("hidden"); }

  function activeScreen() {
    return byId(state.screen + "-screen");
  }

  function scheduleNavigationRefresh(focusRequest) {
    if (!state.navigation) return;
    if (focusRequest) state.pendingFocus = focusRequest;
    if (state.navigationFrame) cancelFrame(state.navigationFrame);
    var scheduledScreen = state.screen;
    state.navigationFrame = requestFrame(function () {
      state.navigationFrame = 0;
      if (scheduledScreen !== state.screen) return;
      var screen = activeScreen();
      if (!screen) return;
      state.navigation.refresh(screen);
      var request = state.pendingFocus;
      state.pendingFocus = null;
      if (request) {
        var target = state.navigation.resolveFocus(request);
        if (target) state.navigation.focus(target);
      }
    });
  }

  function focusFirst(root) {
    scheduleNavigationRefresh({
      scope: root || activeScreen(),
      preferAutofocus: true
    });
  }

  function showScreen(name) {
    all("section.screen").forEach(function (screen) { screen.classList.add("hidden"); });
    var screen = byId(name + "-screen");
    show(screen);
    state.screen = name;
    focusFirst(screen);
  }

  function setLoading(message) {
    setText("loading-message", message || "Loading…");
    showScreen("loading");
  }

  function toast(message, duration) {
    var element = byId("toast");
    clearTimeout(state.toastTimer);
    element.textContent = message;
    show(element);
    state.toastTimer = setTimeout(function () { hide(element); }, duration || 4200);
  }

  function friendlyError(error) {
    if (!error) return "Something went wrong.";
    if (error.message === "Failed to fetch") {
      return "Could not reach the server. Check its address, HTTPS certificate, and network access.";
    }
    return error.message || String(error);
  }

  function identityInitials(name) {
    var words = String(name || "P").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "P";
    return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : "")).toUpperCase();
  }

  function providerBadge(kind) {
    return '<span class="provider-badge provider-badge--' + escapeHtml(kind) + '">' +
      escapeHtml(kind) + "</span>";
  }

  function clearMediaNavigationState() {
    state.contentRevision += 1;
    state.libraries = [];
    state.libraryItems = [];
    state.libraryVisibleCount = 0;
    state.searchItems = [];
    state.searchVisibleCount = 0;
    state.items = {};
    state.currentDetail = null;
    state.currentPlayTarget = null;
    state.detailStack = [];
    state.pendingServers = [];
    if (byId("content-body")) byId("content-body").innerHTML = "";
    if (byId("detail-children")) byId("detail-children").innerHTML = "";
    if (byId("detail-backdrop")) byId("detail-backdrop").style.backgroundImage = "";
  }

  function leaveActiveContext() {
    state.activationRevision += 1;
    clearInterval(state.pinTimer);
    if (state.pinResolver) {
      var resolver = state.pinResolver;
      state.pinResolver = null;
      resolver(null);
    }
    if (state.serverResolver) {
      var serverResolver = state.serverResolver;
      state.serverResolver = null;
      serverResolver(null);
    }
    if (state.player && state.player.teardown) state.player.teardown();
    clearMediaNavigationState();
    state.client = null;
    state.activeIdentity = null;
    state.activeConnection = null;
  }

  function renderIdentityPicker(error, focusIdentityId, focusAction) {
    applyGlobalBranding();
    var identities = state.identityStore.getIdentities();
    var list = byId("identity-list");
    list.innerHTML = identities.map(function (identity) {
      var connection = state.identityStore.chooseDefaultConnection(identity.id);
      var avatar = identity.thumb
        ? '<img src="' + escapeHtml(identity.thumb) + '" alt="">'
        : escapeHtml(identityInitials(identity.name));
      var subtitle = identity.provider === "plex"
        ? (connection ? connection.name : (identity.protected ? "PIN protected" : "Choose a server"))
        : (connection ? connection.name : "Saved login");
      return '<button class="identity-card" data-identity-id="' + escapeHtml(identity.id) +
        '" data-focusable="true"><span class="identity-avatar">' + avatar +
        '</span><strong>' + escapeHtml(identity.name) + '</strong><span class="identity-provider-badge">' +
        providerBadge(identity.provider) + "</span><small>" + escapeHtml(subtitle) + "</small></button>";
    }).join("");
    var emptyElement = byId("identity-picker-empty");
    if (identities.length) hide(emptyElement);
    else show(emptyElement);
    var errorElement = byId("identity-picker-error");
    if (error) {
      errorElement.textContent = friendlyError(error);
      show(errorElement);
    } else {
      errorElement.textContent = "";
      hide(errorElement);
    }
    showScreen("identity-picker");
    if (focusIdentityId || focusAction) {
      scheduleNavigationRefresh({
        scope: byId("identity-picker-screen"),
        attributes: focusIdentityId
          ? { "data-identity-id": focusIdentityId }
          : { "data-action": focusAction },
        preferAutofocus: false
      });
    }
  }

  function refreshPlexIdentities() {
    var accounts = state.identityStore.getPlexAccounts();
    var revision = ++state.providerRefreshRevision;
    if (!accounts.length) {
      setText("identity-refresh-status", "");
      return Promise.resolve([]);
    }
    setText("identity-refresh-status", "Refreshing Plex Home…");
    return Promise.all(accounts.map(function (account) {
      var client = new Api.PlexClient({ accountToken: account.token });
      return client.getHomeUsers().then(function (users) {
        if (revision !== state.providerRefreshRevision) return [];
        state.identityStore.syncPlexHomeUsers(account.id, users, { prune: true });
        return users;
      }).catch(function (error) {
        return { account: account, error: error };
      });
    })).then(function (results) {
      if (revision !== state.providerRefreshRevision) return results;
      var failures = results.filter(function (result) { return result && result.error; });
      setText("identity-refresh-status", failures.length
        ? "Some Plex Home users could not be refreshed. Cached identities are still available."
        : "Plex Home is up to date.");
      if (state.screen === "identity-picker") {
        var focusedIdentity = document.activeElement && document.activeElement.getAttribute
          ? document.activeElement.getAttribute("data-identity-id")
          : "";
        var focusedAction = document.activeElement && document.activeElement.getAttribute
          ? document.activeElement.getAttribute("data-action")
          : "";
        renderIdentityPicker(null, focusedIdentity, focusedAction);
      }
      return results;
    });
  }

  function openIdentityPicker(error, focusIdentityId) {
    leaveActiveContext();
    renderIdentityPicker(error, focusIdentityId);
    refreshPlexIdentities();
  }

  function renderProviderManagement(focusValue) {
    applyGlobalBranding();
    var accounts = state.identityStore.getPlexAccounts();
    var jellyfin = state.identityStore.getIdentities("jellyfin");
    var rows = accounts.map(function (account) {
      var homeCount = state.identityStore.getIdentities("plex").filter(function (identity) {
        return identity.plexAccountId === account.id;
      }).length;
      return '<div class="provider-management-row"><div class="management-copy"><strong>' +
        escapeHtml(account.name) + '</strong><small>Plex · ' + homeCount +
        (homeCount === 1 ? " Home user" : " Home users") +
        '</small></div><button class="small-button small-button--danger" data-plex-unlink="' +
        escapeHtml(account.id) + '" data-focusable="true">Unlink</button></div>';
    }).concat(jellyfin.map(function (identity) {
      var connection = state.identityStore.chooseDefaultConnection(identity.id);
      return '<div class="provider-management-row"><div class="management-copy"><strong>' +
        escapeHtml(identity.name) + '</strong><small>Jellyfin · ' +
        escapeHtml(connection ? connection.name : identity.baseUrl) +
        '</small></div><button class="small-button small-button--danger" data-jellyfin-remove="' +
        escapeHtml(identity.id) + '" data-focusable="true">Remove</button></div>';
    }));
    byId("provider-manage-list").innerHTML = rows.length
      ? rows.join("")
      : '<p class="empty-provider-copy">No providers are connected yet.</p>';
    setText("plex-connect-manage", accounts.length ? "Link another Plex account" : "Connect Plex");
    showScreen("provider-manage");
    if (focusValue) {
      scheduleNavigationRefresh({
        scope: byId("provider-manage-screen"),
        attributes: focusValue.provider === "plex"
          ? { "data-plex-unlink": focusValue.id }
          : { "data-jellyfin-remove": focusValue.id },
        preferAutofocus: false
      });
    }
  }

  function showConfirmation(title, message, label, action, returnScreen) {
    state.confirmAction = action;
    state.confirmReturnScreen = returnScreen || state.screen;
    setText("confirm-title", title);
    setText("confirm-message", message);
    setText("confirm-button", label || "Confirm");
    showScreen("confirm");
  }

  function cancelConfirmation() {
    var destination = state.confirmReturnScreen;
    state.confirmAction = null;
    if (destination === "provider-manage") renderProviderManagement();
    else if (destination === "browse") {
      showScreen("browse");
      routeSettings();
    } else renderIdentityPicker();
  }

  function confirmAction() {
    var action = state.confirmAction;
    state.confirmAction = null;
    if (action) action();
  }

  function unlinkPlexAccount(accountId) {
    var account = state.identityStore.getPlexAccount(accountId);
    if (!account) return;
    showConfirmation(
      "Unlink " + account.name + "?",
      "This removes the linked parent account, its cached Plex Home identities, and all of their saved server sessions.",
      "Unlink Plex",
      function () {
        var removesActive = Boolean(state.activeIdentity && state.activeIdentity.provider === "plex" &&
          state.activeIdentity.plexAccountId === accountId);
        if (removesActive) leaveActiveContext();
        state.identityStore.unlinkPlexAccount(accountId);
        if (removesActive) renderIdentityPicker();
        else renderProviderManagement();
      },
      "provider-manage"
    );
  }

  function removeJellyfinIdentity(identityId) {
    var identity = state.identityStore.getIdentity(identityId);
    if (!identity || identity.provider !== "jellyfin") return;
    showConfirmation(
      "Remove " + identity.name + "?",
      "This removes the saved Jellyfin login and its local server session.",
      "Remove Jellyfin",
      function () {
        var removesActive = Boolean(state.activeIdentity && state.activeIdentity.id === identityId);
        if (removesActive) leaveActiveContext();
        state.identityStore.removeJellyfinIdentity(identityId);
        if (removesActive) renderIdentityPicker();
        else renderProviderManagement();
      },
      "provider-manage"
    );
  }

  function providerName() {
    return state.client && state.client.provider === "jellyfin" ? "Jellyfin" : "Plex";
  }

  function serverName() {
    return state.client && state.client.server && state.client.server.name
      ? state.client.server.name
      : providerName();
  }

  function setActiveRoute(route) {
    state.route = route;
    all(".nav-item").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-route") === route);
    });
  }

  function setPage(title, eyebrow) {
    setText("page-title", title);
    setText("page-eyebrow", eyebrow || providerName());
  }

  function setBody(html) {
    byId("content-body").innerHTML = html;
    scheduleNavigationRefresh();
  }

  function bodyLoading(message) {
    setBody('<div class="empty-state"><div class="spinner"></div><p>' + escapeHtml(message || "Loading…") + "</p></div>");
  }

  function bodyError(error, retryRoute) {
    setBody(
      '<div class="error-state"><h2>Could not load this page</h2><p>' +
      escapeHtml(friendlyError(error)) +
      '</p><button class="button" data-focusable="true" data-route="' +
      escapeHtml(retryRoute || state.route) +
      '">Try again</button></div>'
    );
    focusFirst(byId("content-body"));
  }

  function itemKey(item) {
    return String(item.id);
  }

  function rememberItems(items) {
    (items || []).forEach(function (item) { state.items[itemKey(item)] = item; });
  }

  function progressHtml(item) {
    if (!item.progress) return "";
    return '<div class="media-progress"><div style="width:' +
      Math.round(item.progress * 100) + '%"></div></div>';
  }

  function cardHtml(item, wide, directPlayable, pageAnchor) {
    var key = itemKey(item);
    var shouldPlay = item.playable && (directPlayable || item.type === "episode" || item.type === "clip");
    var art = item.thumb
      ? '<img data-artwork-src="' + escapeHtml(item.thumb) + '" alt="" decoding="async">'
      : '<div class="media-placeholder">▶</div>';
    return '<button class="media-card' + (wide ? " media-card--wide" : "") +
      '" data-focusable="true" data-item="' + escapeHtml(key) + '"' +
      (shouldPlay ? ' data-direct-play="true"' : "") +
      (pageAnchor === key ? ' data-page-anchor="true"' : "") + '>' +
      '<div class="media-art">' + art + progressHtml(item) + '</div>' +
      '<div class="media-copy"><span class="media-title">' + escapeHtml(item.title) +
      '</span><span class="media-subtitle">' + escapeHtml(item.subtitle || item.type) +
      "</span></div></button>";
  }

  function shelfHtml(shelf, options) {
    options = options || {};
    var items = options.limit ? shelf.items.slice(0, options.limit) : shelf.items;
    rememberItems(items);
    var wide = items.some(function (item) {
      return item.type === "episode" || item.type === "clip";
    });
    return '<section class="shelf"><h2>' + escapeHtml(shelf.title) +
      '</h2><div class="card-row">' +
      items.map(function (item) { return cardHtml(item, wide, Boolean(options.directPlayable)); }).join("") +
      "</div></section>";
  }

  function gridHtml(items, options) {
    options = options || {};
    var visible = options.limit ? items.slice(0, options.limit) : items;
    rememberItems(visible);
    if (!items.length) return '<div class="empty-state">Nothing was found.</div>';
    var more = options.limit && items.length > visible.length
      ? '<button class="media-card load-more-card" data-focusable="true" data-action="load-more">' +
        '<div class="media-art"><div class="media-placeholder">+' + Math.min(60, items.length - visible.length) +
        '</div></div><div class="media-copy"><span class="media-title">Load more</span>' +
        '<span class="media-subtitle">' + visible.length + ' of ' + items.length + '</span></div></button>'
      : "";
    return '<div class="library-grid">' +
      visible.map(function (item) {
        return cardHtml(item, false, Boolean(options.directPlayable), options.pageAnchor);
      }).join("") + more +
      "</div>";
  }

  function renderLibraryItems(pageAnchor) {
    setBody(gridHtml(state.libraryItems, {
      limit: state.libraryVisibleCount,
      pageAnchor: pageAnchor
    }));
    if (pageAnchor) {
      scheduleNavigationRefresh({
        scope: byId("content-body"),
        attributes: { "data-page-anchor": "true" },
        preferAutofocus: false
      });
      return;
    }
    focusFirst(byId("content-body"));
  }

  function openBrowse() {
    state.currentDetail = null;
    state.currentPlayTarget = null;
    state.detailStack = [];
    showScreen("browse");
    setText("connection-badge", (state.activeIdentity ? state.activeIdentity.name + " · " : "") + providerName() + " · " + serverName());
    routeHome();
  }

  function routeHome() {
    setActiveRoute("home");
    var revision = ++state.contentRevision;
    setPage("Home", serverName());
    bodyLoading("Loading your home screen…");
    state.client.getHome().then(function (shelves) {
      if (state.route !== "home" || revision !== state.contentRevision) return;
      var visibleShelves = shelves.slice(0, 8);
      setBody(visibleShelves.length
        ? visibleShelves.map(function (shelf) {
          return shelfHtml(shelf, { directPlayable: true, limit: 12 });
        }).join("")
        : '<div class="empty-state">Your server did not return any home-screen items.</div>');
      focusFirst(byId("content-body"));
    }).catch(function (error) {
      if (state.route === "home" && revision === state.contentRevision) bodyError(error, "home");
    });
  }

  function ensureCurrentPlexServer() {
    if (providerName() !== "Plex" || !state.client.server) return;
    var current = state.client.server;
    var exists = state.pendingServers.some(function (server) { return server.id === current.id; });
    if (!exists) {
      state.pendingServers.push({
        id: current.id,
        name: current.name,
        owned: current.owned,
        local: current.local,
        accessToken: state.client.token,
        baseUrl: state.client.baseUrl
      });
    }
    state.pendingServers = Api.orderPlexServers(state.pendingServers);
  }

  function plexServerGroupHtml(title, owned) {
    var choices = [];
    state.pendingServers.forEach(function (server, index) {
      if (Boolean(server.owned) !== owned) return;
      var current = state.client.server && server.id === state.client.server.id;
      choices.push('<button class="server-option' + (current ? " is-current" : "") +
        '" data-focusable="true" data-server-switch="' + index + '">' +
        '<strong>' + escapeHtml(server.name) + '</strong><small>' +
        (current ? "Connected" : (owned ? "Owned" : "Shared")) + "</small></button>");
    });
    if (!choices.length) return "";
    return '<div class="server-group"><h3>' + escapeHtml(title) +
      '</h3><div class="server-grid">' + choices.join("") + "</div></div>";
  }

  function renderLibrariesPage(libraries) {
    ensureCurrentPlexServer();
    var servers = providerName() === "Plex"
      ? '<section class="server-picker"><h2>Plex Servers</h2>' +
        plexServerGroupHtml("Your Server", true) +
        plexServerGroupHtml("Shared With You", false) + "</section>"
      : "";
    var libraryContent = libraries.length
      ? '<div class="library-grid">' + libraries.map(function (library, index) {
        return '<button class="library-button" data-focusable="true" data-library="' + index +
          '"><strong>' + escapeHtml(library.title) + '</strong><small>' +
          escapeHtml(library.type) + "</small></button>";
      }).join("") + "</div>"
      : '<div class="empty-state">No supported libraries were found.</div>';
    setBody(servers + '<section class="library-list"><h2>Libraries</h2>' + libraryContent + "</section>");
    focusFirst(byId("content-body"));
  }

  function routeLibraries() {
    setActiveRoute("libraries");
    var revision = ++state.contentRevision;
    var client = state.client;
    var contextRevision = state.activationRevision;
    setPage("Libraries", serverName());
    bodyLoading("Loading libraries and servers…");
    var serversPromise = providerName() === "Plex"
      ? client.getServers().catch(function () { return state.pendingServers; })
      : Promise.resolve([]);
    Promise.all([client.getLibraries(), serversPromise]).then(function (results) {
      if (client !== state.client || contextRevision !== state.activationRevision || state.route !== "libraries" || revision !== state.contentRevision) return;
      state.libraries = results[0];
      if (providerName() === "Plex" && results[1].length) state.pendingServers = results[1];
      if (providerName() === "Plex" && state.activeConnection) {
        state.identityStore.updateConnectionSession(state.activeConnection.id, state.client.toSession(), {
          identityToken: state.client.identityToken,
          serverId: state.client.server && state.client.server.id
        });
        state.activeConnection = state.identityStore.getConnection(state.activeConnection.id);
      }
      renderLibrariesPage(state.libraries);
    }).catch(function (error) {
      if (client === state.client && contextRevision === state.activationRevision && state.route === "libraries" && revision === state.contentRevision) bodyError(error, "libraries");
    });
  }

  function switchPlexServer(index) {
    var server = state.pendingServers[index];
    if (!server || providerName() !== "Plex") return;
    if (state.client.server && server.id === state.client.server.id) return;
    var previousSession = state.client.toSession();
    var previousConnection = state.activeConnection;
    if (state.player && state.player.teardown) state.player.teardown();
    clearMediaNavigationState();
    var revision = state.contentRevision;
    setLoading("Connecting to " + server.name + "…");
    state.client.connect(server);
    state.client.getLibraries().then(function (libraries) {
      if (revision !== state.contentRevision) return;
      state.libraries = libraries;
      if (state.activeIdentity) {
        state.activeConnection = state.identityStore.upsertConnection(state.activeIdentity.id, {
          provider: "plex",
          name: server.name,
          identityToken: state.client.identityToken,
          serverId: state.client.server && state.client.server.id,
          session: state.client.toSession()
        });
        state.identityStore.setDefaultConnection(state.activeIdentity.id, state.activeConnection.id);
        state.identityStore.touchIdentity(state.activeIdentity.id, state.activeConnection.id);
      }
      openBrowse();
      toast("Connected to " + server.name + ".", 2800);
    }).catch(function (error) {
      if (revision !== state.contentRevision) return;
      state.client = Api.clientFromSession(previousSession);
      state.activeConnection = previousConnection;
      state.pendingServers = state.client && state.client.servers ? state.client.servers.slice() : [];
      showScreen("browse");
      routeLibraries();
      toast("Could not switch servers: " + friendlyError(error), 7000);
    });
  }

  function openLibrary(index) {
    var library = state.libraries[index];
    if (!library) return;
    var revision = ++state.contentRevision;
    setPage(library.title, "Library");
    bodyLoading("Loading " + library.title + "…");
    state.client.getLibraryItems(library.id).then(function (items) {
      if (state.route !== "libraries" || revision !== state.contentRevision) return;
      state.libraryItems = items;
      state.libraryVisibleCount = 60;
      renderLibraryItems();
    }).catch(function (error) {
      if (state.route === "libraries" && revision === state.contentRevision) bodyError(error, "libraries");
    });
  }

  function routeSearch() {
    setActiveRoute("search");
    state.contentRevision += 1;
    setPage("Search", serverName());
    setBody(
      '<form id="search-form" class="search-box">' +
      '<input id="search-input" data-focusable="true" placeholder="Movies, shows, episodes…" autocomplete="off">' +
      '<button class="button button--primary" data-focusable="true" type="submit">Search</button></form>' +
      '<div id="search-results" class="empty-state">Enter a title to search your server.</div>'
    );
    focusFirst(byId("content-body"));
  }

  function renderSearchItems(pageAnchor) {
    var results = byId("search-results");
    if (!results) return;
    results.className = "";
    results.innerHTML = gridHtml(state.searchItems, {
      limit: state.searchVisibleCount,
      pageAnchor: pageAnchor
    });
    if (pageAnchor) {
      scheduleNavigationRefresh({
        scope: results,
        attributes: { "data-page-anchor": "true" },
        preferAutofocus: false
      });
    } else {
      focusFirst(results);
    }
  }

  function runSearch(term) {
    term = String(term || "").trim();
    if (!term) return;
    var revision = ++state.contentRevision;
    var results = byId("search-results");
    results.className = "empty-state";
    results.innerHTML = '<div class="spinner"></div><p>Searching…</p>';
    scheduleNavigationRefresh();
    state.client.search(term).then(function (items) {
      if (state.route !== "search" || revision !== state.contentRevision) return;
      state.searchItems = items;
      state.searchVisibleCount = 60;
      renderSearchItems();
    }).catch(function (error) {
      if (state.route !== "search" || revision !== state.contentRevision) return;
      results.className = "error-state";
      results.textContent = friendlyError(error);
      scheduleNavigationRefresh();
    });
  }

  function routeSettings(focusNickModeSwitch) {
    setActiveRoute("settings");
    state.contentRevision += 1;
    setPage("Settings", state.activeIdentity ? state.activeIdentity.name : providerName());
    var nickModeEnabled = state.identityStore.getNickMode();
    var connections = state.activeIdentity ? state.identityStore.getConnections(state.activeIdentity.id) : [];
    var connectionRows = connections.map(function (connection) {
      var current = state.activeConnection && connection.id === state.activeConnection.id;
      return '<div class="connection-row' + (current ? " is-current" : "") +
        '"><div class="connection-copy"><strong>' + escapeHtml(connection.name) +
        '</strong><small>' + escapeHtml(providerName() + (current ? " · Connected" : " · Saved server")) +
        '</small></div><button class="small-button" data-connection-switch="' +
        escapeHtml(connection.id) + '" data-focusable="true"' + (current ? " disabled" : "") + '>Use</button></div>';
    }).join("");
    setBody(
      '<section class="settings-panel"><p class="eyebrow">ACTIVE IDENTITY</p><h2>' +
      escapeHtml(state.activeIdentity ? state.activeIdentity.name : "Identity") + '</h2><button class="button" ' +
      'data-action="switch-identity" data-focusable="true">Switch identity</button> ' +
      '<button class="button" data-action="manage-providers" data-focusable="true">Manage providers</button></section>' +
      '<section class="settings-panel"><p class="eyebrow">APPEARANCE</p><div class="nick-mode-setting">' +
      '<div class="nick-mode-copy"><h2>Nick Mode</h2><p id="nick-mode-status" class="status-text">' +
      escapeHtml(nickModeEnabled ? "Maximum Nick achieved." : "Plezy branding is active.") +
      '</p></div><button id="nick-mode-switch" class="nick-mode-switch" type="button" role="switch" ' +
      'aria-label="Nick Mode" aria-describedby="nick-mode-status" aria-checked="' +
      (nickModeEnabled ? "true" : "false") + '" data-action="toggle-nick-mode" data-focusable="true">' +
      '<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>' +
      '<span class="switch-label">' + (nickModeEnabled ? "On" : "Off") + '</span></button></div></section>' +
      '<section class="settings-panel"><p class="eyebrow">CONNECTION</p><h2>Saved server' +
      (connections.length === 1 ? "" : "s") + '</h2>' + connectionRows +
      (providerName() === "Plex" ? '<button class="button button--primary" data-route="libraries" data-focusable="true">Choose Plex server</button>' : "") +
      '<p class="privacy-note">Provider credentials stay in this TV app\'s local storage until their provider account or saved login is removed.</p></section>'
    );
    if (focusNickModeSwitch) {
      scheduleNavigationRefresh({
        scope: byId("content-body"),
        attributes: { "data-action": "toggle-nick-mode" },
        preferAutofocus: false
      });
    } else {
      focusFirst(byId("content-body"));
    }
  }

  function toggleNickMode() {
    var enabled = !state.identityStore.getNickMode();
    try {
      state.identityStore.setNickMode(enabled);
      applyBranding(enabled);
      routeSettings(true);
      toast(enabled ? "Nick Mode engaged." : "Nick Mode disengaged.");
    } catch (error) {
      toast(friendlyError(error), 6500);
      routeSettings(true);
    }
  }

  function navigate(route) {
    if (!state.client) return;
    state.currentDetail = null;
    state.currentPlayTarget = null;
    state.detailStack = [];
    if (route === "home") routeHome();
    if (route === "libraries") routeLibraries();
    if (route === "search") routeSearch();
    if (route === "settings") routeSettings();
  }

  function activateItem(item, directPlay) {
    if (!item) return;
    if (item.playable && (directPlay || item.type === "episode" || item.type === "clip")) {
      state.player.start(item);
      return;
    }
    if (directPlay && item.type === "show" && state.client.getShowUpNext) {
      var client = state.client;
      var contextRevision = state.activationRevision;
      toast("Finding the next episode…", 1800);
      client.getShowUpNext(item.id).then(function (nextEpisode) {
        if (client !== state.client || contextRevision !== state.activationRevision) return;
        if (nextEpisode) {
          rememberItems([nextEpisode]);
          state.player.start(nextEpisode);
        } else {
          openDetail(item, false);
        }
      }).catch(function () {
        if (client === state.client && contextRevision === state.activationRevision) openDetail(item, false);
      });
      return;
    }
    openDetail(item, false);
  }

  function playButtonLabel(item, showContext) {
    if (!item) return "▶ Play";
    if (item.resumeMs > 30000) return showContext ? "▶ Resume episode" : "▶ Resume";
    if (showContext) {
      var raw = item.raw || {};
      var seasonNumber = Number(raw.parentIndex || raw.ParentIndexNumber || 0);
      var episodeNumber = Number(raw.index || raw.IndexNumber || 0);
      return seasonNumber === 1 && episodeNumber === 1 ? "▶ Play first episode" : "▶ Play next episode";
    }
    return "▶ Play";
  }

  function openDetail(item, fromHistory) {
    if (!item) return;
    var previous = state.screen === "detail" ? state.currentDetail : null;
    if (!fromHistory) {
      if (previous) state.detailStack.push(previous);
      else state.detailStack = [];
    }
    var client = state.client;
    var contextRevision = state.activationRevision;
    setLoading("Loading details…");
    client.getDetails(item.id).then(function (detail) {
      if (client !== state.client || contextRevision !== state.activationRevision) return;
      state.currentDetail = detail;
      state.currentPlayTarget = detail.playable ? detail : null;
      rememberItems([detail]);
      setText("detail-eyebrow", String(detail.type || "Media") + (detail.year ? " · " + detail.year : ""));
      setText("detail-title", detail.title);
      setText("detail-meta", [detail.subtitle, formatDuration(detail.durationMs)].filter(Boolean).join("  ·  "));
      setText("detail-summary", detail.summary || "No description is available.");
      byId("detail-backdrop").style.backgroundImage = detail.art ? 'url("' + detail.art.replace(/"/g, "%22") + '")' : "";
      var playButton = byId("detail-play");
      playButton.classList.toggle("hidden", !detail.playable && detail.type !== "show");
      playButton.disabled = !detail.playable;
      playButton.textContent = detail.playable ? playButtonLabel(detail, false) : "Finding next episode…";
      byId("detail-children").innerHTML = "";
      showScreen("detail");
      if (detail.hasChildren) loadChildren(detail);
      if (detail.type === "show" && client.getShowUpNext) {
        client.getShowUpNext(detail.id).then(function (nextEpisode) {
          if (client !== state.client || contextRevision !== state.activationRevision || !state.currentDetail || state.currentDetail.id !== detail.id) return;
          state.currentPlayTarget = nextEpisode;
          if (!nextEpisode) {
            hide(playButton);
            return;
          }
          rememberItems([nextEpisode]);
          show(playButton);
          playButton.disabled = false;
          playButton.textContent = playButtonLabel(nextEpisode, true);
          scheduleNavigationRefresh(document.activeElement && document.activeElement.classList.contains("detail-back")
            ? { scope: byId("detail-screen"), element: playButton, preferAutofocus: false }
            : null);
        }).catch(function () {
          if (client === state.client && contextRevision === state.activationRevision && state.currentDetail && state.currentDetail.id === detail.id) {
            hide(playButton);
            scheduleNavigationRefresh();
          }
        });
      }
    }).catch(function (error) {
      if (client !== state.client || contextRevision !== state.activationRevision) return;
      toast(friendlyError(error));
      if (previous) showScreen("detail");
      else showScreen("browse");
    });
  }

  function loadChildren(detail) {
    detail = detail || state.currentDetail;
    if (!detail) return;
    var client = state.client;
    var contextRevision = state.activationRevision;
    var container = byId("detail-children");
    container.innerHTML = '<div class="children-loading"><div class="spinner"></div><p>Loading ' +
      (detail.type === "show" ? "seasons" : "episodes") + '…</p></div>';
    scheduleNavigationRefresh();
    client.getChildren(detail.id, detail).then(function (items) {
      if (client !== state.client || contextRevision !== state.activationRevision || !state.currentDetail || state.currentDetail.id !== detail.id) return;
      container.innerHTML = items.length
        ? shelfHtml({ title: detail.type === "show" ? "Seasons" : "Episodes", items: items }, {
          directPlayable: detail.type !== "show",
          limit: 60
        })
        : '<div class="empty-state">No episodes were found.</div>';
      if (detail.type === "season" || !state.currentPlayTarget) focusFirst(container);
      else scheduleNavigationRefresh();
    }).catch(function (error) {
      if (client !== state.client || contextRevision !== state.activationRevision || !state.currentDetail || state.currentDetail.id !== detail.id) return;
      container.innerHTML = '<div class="error-state">' + escapeHtml(friendlyError(error)) + "</div>";
      scheduleNavigationRefresh();
    });
  }

  function beginPlexLink(preserveReturnScreen) {
    clearInterval(state.pinTimer);
    if (preserveReturnScreen !== true) {
      state.setupReturnScreen = state.screen === "provider-manage" ? "provider-manage" : "identity-picker";
    }
    var client = new Api.PlexClient();
    state.setupAccount = null;
    hide(byId("plex-link-retry"));
    setText("plex-code", "––––");
    setText("plex-link-status", "Requesting a link code…");
    showScreen("plex-link");
    client.createPin().then(function (pin) {
      if (state.screen !== "plex-link") return;
      setText("plex-code", pin.code || "––––");
      setText("plex-link-status", "Waiting for authorization at plex.tv/link");
      state.pinStartedAt = Date.now();
      checkPlexPin(client, pin.id);
      state.pinTimer = setInterval(function () { checkPlexPin(client, pin.id); }, 2000);
    }).catch(showPlexLinkError);
  }

  function checkPlexPin(client, pinId) {
    if (state.screen !== "plex-link") {
      clearInterval(state.pinTimer);
      return;
    }
    if (Date.now() - state.pinStartedAt > 10 * 60 * 1000) {
      clearInterval(state.pinTimer);
      showPlexLinkError(new Error("The code expired. Request a new one."));
      return;
    }
    client.checkPin(pinId).then(function (pin) {
      if (state.screen !== "plex-link") return;
      if (!pin.authToken) return;
      clearInterval(state.pinTimer);
      client.token = pin.authToken;
      client.accountToken = pin.authToken;
      state.setupAccount = state.identityStore.upsertPlexAccount({
        name: "Plex account",
        token: pin.authToken
      });
      setText("plex-link-status", "Signed in. Loading Plex Home…");
      return finishPlexLink(client, state.setupAccount);
    }).catch(function (error) {
      if (error && (error.status === 401 || error.status === 404)) return;
      clearInterval(state.pinTimer);
      showPlexLinkError(error);
    });
  }

  function showPlexLinkError(error) {
    setText("plex-link-status", friendlyError(error));
    show(byId("plex-link-retry"));
    focusFirst(byId("plex-link-screen"));
  }

  function finishPlexLink(client, account) {
    setLoading("Loading Plex Home users…");
    return client.getHomeUsers().then(function (users) {
      var owner = users.filter(function (user) { return user.admin; })[0] || users[0];
      if (owner) {
        account = state.identityStore.upsertPlexAccount({
          id: account.id,
          accountId: owner.id,
          name: owner.title + " · Plex",
          username: owner.username,
          thumb: owner.thumb,
          token: account.token
        });
      }
      state.identityStore.syncPlexHomeUsers(account.id, users, { prune: true });
      var identity = state.identityStore.getIdentities("plex").filter(function (candidate) {
        return candidate.plexAccountId === account.id && owner && candidate.homeUser.uuid === owner.uuid;
      })[0];
      if (state.setupReturnScreen === "provider-manage") renderProviderManagement({ provider: "plex", id: account.id });
      else renderIdentityPicker(null, identity && identity.id);
      toast("Plex account connected.", 2800);
    }).catch(function (error) {
      if (state.setupReturnScreen === "provider-manage") {
        renderProviderManagement({ provider: "plex", id: account.id });
        toast("Plex Home could not be loaded: " + friendlyError(error), 7000);
      } else {
        renderIdentityPicker(error);
      }
    });
  }

  function requestPlexPin(user, error) {
    if (state.pinResolver) state.pinResolver(null);
    setText("plex-pin-title", "Unlock " + (user && user.title || "Plex user"));
    byId("plex-home-pin").value = "";
    var errorElement = byId("plex-pin-error");
    if (error) {
      errorElement.textContent = friendlyError(error);
      show(errorElement);
    } else hide(errorElement);
    showScreen("plex-pin");
    return new Promise(function (resolve) { state.pinResolver = resolve; });
  }

  function submitPlexPin(event) {
    event.preventDefault();
    var pin = String(byId("plex-home-pin").value || "").trim();
    if (!/^\d{4}$/.test(pin)) {
      setText("plex-pin-error", "Enter the four-digit Plex Home PIN.");
      show(byId("plex-pin-error"));
      focusFirst(byId("plex-pin-screen"));
      return;
    }
    var resolver = state.pinResolver;
    state.pinResolver = null;
    setLoading("Unlocking Plex Home…");
    if (resolver) resolver(pin);
  }

  function cancelPlexPin() {
    var resolver = state.pinResolver;
    state.pinResolver = null;
    if (resolver) {
      setLoading("Cancelling identity activation…");
      resolver(null);
      return;
    }
    renderIdentityPicker();
  }

  function requestPlexServer(servers, identity, reason) {
    if (state.serverResolver) state.serverResolver(null);
    state.setupServers = servers;
    setText("server-title", reason === "unavailable" ? "Choose another server" : "Choose a server");
    setText("server-copy", reason === "unavailable"
      ? "The last server saved for " + identity.name + " is unavailable."
      : "Select the Plex server " + identity.name + " should use.");
    renderPlexServers();
    return new Promise(function (resolve) { state.serverResolver = resolve; });
  }

  function renderPlexServers() {
    byId("server-list").innerHTML = state.setupServers.map(function (server, index) {
      return '<button class="choice-button" data-server="' + index + '" data-focusable="true">' +
        "<span>" + escapeHtml(server.name) + "</span><small>" +
        (server.owned ? "Owned" : "Shared") + "</small></button>";
    }).join("");
    showScreen("server");
  }

  function choosePlexServer(index) {
    var server = state.setupServers[index];
    var resolver = state.serverResolver;
    if (!server || !resolver) return;
    state.serverResolver = null;
    setLoading("Connecting to " + server.name + "…");
    resolver(server);
  }

  function cancelPlexServer() {
    var resolver = state.serverResolver;
    state.serverResolver = null;
    if (resolver) {
      setLoading("Cancelling identity activation…");
      resolver(null);
      return;
    }
    renderIdentityPicker();
  }

  function jellyfinLogin(event) {
    event.preventDefault();
    var url = byId("jellyfin-url").value;
    var username = byId("jellyfin-user").value;
    var password = byId("jellyfin-password").value;
    var errorElement = byId("jellyfin-error");
    hide(errorElement);
    setLoading("Signing in to Jellyfin…");
    Api.JellyfinClient.authenticate(url, username, password).then(function (client) {
      return client.getLibraries().then(function (libraries) {
        var session = client.toSession();
        var identity = state.identityStore.upsertJellyfinIdentity({
          name: (session.server && session.server.username) || username,
          session: session
        });
        var connection = state.identityStore.chooseDefaultConnection(identity.id);
        enterActiveIdentity(identity, connection, client, libraries);
      });
    }).catch(function (error) {
      showScreen("jellyfin-login");
      errorElement.textContent = friendlyError(error);
      show(errorElement);
      focusFirst(byId("jellyfin-login-screen"));
    });
  }

  function enterActiveIdentity(identity, connection, client, libraries) {
    if (state.player && state.player.teardown) state.player.teardown();
    state.activationRevision += 1;
    clearMediaNavigationState();
    state.client = client;
    state.activeIdentity = identity;
    state.activeConnection = connection;
    state.libraries = libraries || [];
    state.pendingServers = client && client.servers ? client.servers.slice() : [];
    state.identityStore.touchIdentity(identity.id, connection && connection.id);
    state.activeIdentity = state.identityStore.getIdentity(identity.id);
    state.activeConnection = connection ? state.identityStore.getConnection(connection.id) : null;
    applyGlobalBranding();
    state.setupAccount = null;
    state.setupServers = [];
    openBrowse();
  }

  function activateStoredIdentity(identityId, connectionId, rollback) {
    var resolved = state.identityStore.resolveIdentity(identityId, connectionId);
    var identity = resolved && resolved.identity;
    var connection = resolved && resolved.connection;
    var account = resolved && resolved.account;
    var previous = rollback ? {
      identity: state.activeIdentity,
      connection: state.activeConnection,
      client: state.client
    } : null;
    leaveActiveContext();
    applyGlobalBranding();
    var revision = state.activationRevision;
    setLoading("Opening " + (identity ? identity.name : "identity") + "…");
    Api.activateIdentity(identity, connection, account, {
      requestPin: function (homeUser, error) { return requestPlexPin(homeUser, error); },
      chooseServer: requestPlexServer
    }).then(function (result) {
      if (revision !== state.activationRevision) return;
      if (!result.ok) {
        if (previous && previous.client) {
          state.client = previous.client;
          state.activeIdentity = previous.identity;
          state.activeConnection = previous.connection;
          state.pendingServers = previous.client.servers ? previous.client.servers.slice() : [];
          applyGlobalBranding();
          showScreen("browse");
          routeSettings();
          scheduleNavigationRefresh({
            scope: byId("content-body"),
            attributes: { "data-connection-switch": connectionId },
            preferAutofocus: false
          });
          if (!result.error.cancelled) toast("Could not switch connections: " + result.error.message, 7000);
          return;
        }
        renderIdentityPicker(result.error.cancelled ? null : new Error(
          result.error.message + " Select the identity to retry, or use Manage providers to reconnect it."
        ), identityId);
        return;
      }
      if (identity.provider === "plex") {
        identity = state.identityStore.updatePlexIdentity(identity.id, {
          identityToken: result.identity.identityToken,
          homeUser: result.identity.homeUser
        });
        connection = state.identityStore.upsertConnection(identity.id, result.connection);
        state.identityStore.setDefaultConnection(identity.id, connection.id);
      } else if (result.connection) {
        connection = state.identityStore.updateConnectionSession(result.connection.id, result.session);
      }
      enterActiveIdentity(identity, connection, result.client, result.validation || []);
    });
  }

  function selectIdentity(identityId) {
    var identity = state.identityStore.getIdentity(identityId);
    if (!identity) {
      renderIdentityPicker(new Error("That identity is no longer available."));
      return;
    }
    var connection = state.identityStore.chooseDefaultConnection(identityId);
    activateStoredIdentity(identityId, connection && connection.id, false);
  }

  function switchConnection(connectionId) {
    if (!state.activeIdentity || state.activeConnection && state.activeConnection.id === connectionId) return;
    activateStoredIdentity(state.activeIdentity.id, connectionId, true);
  }

  function restoreIdentities() {
    state.identityStore.migrate();
    applyGlobalBranding();
    renderIdentityPicker();
    refreshPlexIdentities();
  }

  function formatTime(ms) {
    var seconds = Math.max(0, Math.floor((ms || 0) / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var rest = seconds % 60;
    return (hours ? hours + ":" + String(minutes).padStart(2, "0") : String(minutes)) +
      ":" + String(rest).padStart(2, "0");
  }

  function formatDuration(ms) {
    if (!ms) return "";
    var minutes = Math.round(ms / 60000);
    if (minutes < 60) return minutes + " min";
    return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  }

  function PlayerController() {
    this.playback = null;
    this.client = null;
    this.contextRevision = 0;
    this.usingAvPlay = false;
    this.positionMs = 0;
    this.durationMs = 0;
    this.timelineOffsetMs = 0;
    this.resumeSeekPending = false;
    this.paused = false;
    this.progressTimer = null;
    this.chromeTimer = null;
    this.htmlCueTimer = null;
    this.externalCueTimer = null;
    this.externalCues = [];
    this.externalCueLoadingUrl = "";
    this.externalCueLoadedUrl = "";
    this.triedDirect = false;
    this.mediaRevision = 0;
    this.subtitleOperationRevision = 0;
    this.searchRevision = 0;
    this.subtitlePreferenceContext = null;
    this.avTextTracks = [];
    this.cueScheduler = new Subtitles.CueScheduler();
    this.lastCueText = "";
    this.lastCueSource = "";
    this.focusMode = "transport";
    this.actionRowIndex = 0;
    this.panelTab = "tracks";
    this.panelSearchResults = [];
    this.panelSearchTitle = "";
    this.panelStatus = "";
    this.panelBusy = false;
    this.ignoreHtmlErrorUntil = 0;
    this.returnScreen = "detail";
    this.returnFocusItem = "";
    this.returnFocusAction = "";
    this.html = byId("html-player");
    this.avObject = byId("av-player");
    this._bindHtmlEvents();
  }

  PlayerController.prototype._bindHtmlEvents = function () {
    var self = this;
    this.html.addEventListener("timeupdate", function () {
      if (self.resumeSeekPending) return;
      self.positionMs = self.timelineOffsetMs + self.html.currentTime * 1000;
      if (!self.durationMs && Number.isFinite(self.html.duration)) {
        self.durationMs = self.timelineOffsetMs + self.html.duration * 1000;
      }
      self.updateChrome();
      self._updateHtmlCue();
      self._updateExternalCue();
    });
    this.html.addEventListener("loadedmetadata", function () { self._configureHtmlSubtitles(); });
    if (this.html.textTracks && this.html.textTracks.addEventListener) {
      this.html.textTracks.addEventListener("addtrack", function () { self._configureHtmlSubtitles(); });
    }
    this.html.addEventListener("ended", function () { if (self.playback) self.stop(true); });
    this.html.addEventListener("error", function () {
      if (self.playback && Date.now() >= self.ignoreHtmlErrorUntil) {
        self._playbackFailed("The TV could not play this stream.", self.mediaRevision);
      }
    });
  };

  PlayerController.prototype._preferenceContext = function (item) {
    return {
      provider: this.client && this.client.provider || state.client && state.client.provider || "",
      identityId: state.activeIdentity && state.activeIdentity.id || "",
      connectionId: state.activeConnection && state.activeConnection.id || "",
      serverId: state.activeConnection && state.activeConnection.serverId ||
        (this.client && this.client.server && this.client.server.id) || "",
      baseUrl: this.client && this.client.baseUrl || "",
      item: item
    };
  };

  PlayerController.prototype.start = function (item) {
    var self = this;
    var client = state.client;
    var contextRevision = state.activationRevision;
    var active = document.activeElement;
    this.returnScreen = state.screen === "browse" ? "browse" : "detail";
    this.returnFocusItem = active && active.getAttribute ? (active.getAttribute("data-item") || "") : "";
    this.returnFocusAction = active && active.getAttribute ? (active.getAttribute("data-action") || "") : "";
    setLoading("Preparing playback…");
    var loadDetails = client && client.getDetails ? client.getDetails(item.id) : Promise.resolve(item);
    return loadDetails.then(function (detail) {
      if (client !== state.client || contextRevision !== state.activationRevision) return null;
      self.client = client;
      var tracks = client.subtitleTracksForItem ? client.subtitleTracksForItem(detail) : [];
      self.subtitlePreferenceContext = self._preferenceContext(detail);
      var serverSelection = client.defaultSubtitleSelectionForItem
        ? client.defaultSubtitleSelectionForItem(detail)
        : null;
      var selection = state.subtitleStore.resolveSelection(self.subtitlePreferenceContext, tracks, serverSelection);
      return client.createPlayback(detail, {
        startMs: detail.resumeMs || item.resumeMs || 0,
        subtitleSelection: selection
      });
    }).then(function (playback) {
      if (!playback) return;
      if (client !== state.client || contextRevision !== state.activationRevision) return;
      self.client = client;
      self.contextRevision = contextRevision;
      self.playback = playback;
      self.positionMs = playback.startMs || 0;
      self.durationMs = playback.durationMs || 0;
      self.paused = false;
      self.triedDirect = false;
      self.focusMode = "transport";
      self.actionRowIndex = 0;
      self.panelTab = "tracks";
      self.panelSearchResults = [];
      self.panelStatus = "";
      self.subtitlePreferenceContext = self._preferenceContext(playback.item);
      setText("player-title", playback.item.title);
      setText("player-subtitle", playback.item.subtitle || providerName());
      self.applySubtitleStyle();
      self.updateChrome();
      showScreen("player");
      self._setActionRowFocusable(false);
      self.closeSubtitlePanel(true);
      self._open(playback.url);
      self.progressTimer = setInterval(function () {
        if (self.client && self.playback) self.client.reportProgress(self.playback, self.positionMs, self.paused ? "paused" : "playing");
      }, 10000);
      self.client.reportProgress(playback, self.positionMs, "playing");
      self.showChrome();
    }).catch(function (error) {
      if (client !== state.client || contextRevision !== state.activationRevision) return;
      toast(friendlyError(error), 6500);
      self.restoreScreen();
    });
  };

  PlayerController.prototype.restoreScreen = function () {
    var name = this.returnScreen === "browse" ? "browse" : "detail";
    showScreen(name);
    var attributes = null;
    if (this.returnFocusItem) attributes = { "data-item": this.returnFocusItem };
    else if (this.returnFocusAction) attributes = { "data-action": this.returnFocusAction };
    scheduleNavigationRefresh({
      scope: byId(name + "-screen"),
      attributes: attributes,
      preferAutofocus: !attributes
    });
  };

  PlayerController.prototype._open = function (url) {
    this.mediaRevision += 1;
    this.cueScheduler.cancel();
    clearInterval(this.htmlCueTimer);
    this.htmlCueTimer = null;
    this._resetExternalSubtitleCues();
    this.avTextTracks = [];
    this._renderCue("");
    this.timelineOffsetMs = this.triedDirect ? 0 : Number(this.playback && this.playback.startMs || 0);
    this.resumeSeekPending = this.triedDirect && this.playback && this.playback.startMs > 0;
    this.positionMs = Number(this.playback && this.playback.startMs || 0);
    this.updateChrome();
    if (window.webapis && window.webapis.avplay) this._openAvPlay(url);
    else this._openHtml(url);
  };

  PlayerController.prototype._mediaIsCurrent = function (revision) {
    return Boolean(this.playback && revision === this.mediaRevision && this.contextRevision === state.activationRevision);
  };

  PlayerController.prototype._customSubtitleActive = function () {
    return Boolean(this.playback && this.playback.selectedSubtitle &&
      (this.playback.subtitleDelivery === "native" || this.playback.subtitleDelivery === "external"));
  };

  PlayerController.prototype._resetExternalSubtitleCues = function () {
    clearInterval(this.externalCueTimer);
    this.externalCueTimer = null;
    this.externalCues = [];
    this.externalCueLoadingUrl = "";
    this.externalCueLoadedUrl = "";
  };

  PlayerController.prototype._loadExternalSubtitleCues = function (revision) {
    var self = this;
    var playback = this.playback;
    var url = playback && playback.subtitleUrl;
    if (!url || playback.subtitleDelivery !== "external" || !this._mediaIsCurrent(revision)) return;
    if (this.externalCueLoadingUrl === url || this.externalCueLoadedUrl === url) return;
    this._resetExternalSubtitleCues();
    this.externalCueLoadingUrl = url;
    window.fetch(url).then(function (response) {
      if (!response || response.ok === false) {
        var error = new Error("The external subtitle file could not be loaded.");
        error.status = response && response.status;
        throw error;
      }
      return response.text();
    }).then(function (source) {
      if (!self._mediaIsCurrent(revision) || self.playback !== playback || self.externalCueLoadingUrl !== url) return;
      self.externalCueLoadingUrl = "";
      self.externalCueLoadedUrl = url;
      self.externalCues = Subtitles.parseSubtitleCues(source,
        playback.selectedSubtitle && playback.selectedSubtitle.codec);
      self.externalCueTimer = setInterval(function () { self._updateExternalCue(); }, 100);
      self._updateExternalCue();
      if (!self.externalCues.length) {
        self.panelStatus = "The external subtitle file contained no readable cues.";
        setText("subtitle-panel-status", self.panelStatus);
      }
    }).catch(function (error) {
      if (!self._mediaIsCurrent(revision) || self.playback !== playback || self.externalCueLoadingUrl !== url) return;
      self.externalCueLoadingUrl = "";
      self.panelStatus = "Could not load external subtitles: " + friendlyError(error);
      setText("subtitle-panel-status", self.panelStatus);
    });
  };

  PlayerController.prototype._updateExternalCue = function () {
    if (!this.externalCueLoadedUrl || !this._customSubtitleActive()) return;
    var offset = state.subtitleStore.getSyncOffset();
    var textParts = [];
    for (var index = 0; index < this.externalCues.length; index += 1) {
      var cue = this.externalCues[index];
      if (Subtitles.cueIsActive(cue, this.positionMs, offset)) textParts.push(cue.text || "");
    }
    var cueText = textParts.join("\n");
    if (cueText !== this.lastCueSource) this._renderCue(cueText);
  };

  PlayerController.prototype._parseAvTrack = function (track) {
    var extra = track && (track.extra_info || track.extraInfo) || {};
    if (typeof extra === "string") {
      try { extra = JSON.parse(extra); } catch (_) { extra = {}; }
    }
    return {
      index: Number(track && track.index),
      languageCode: Subtitles.canonicalLanguage(extra.track_lang || extra.language || extra.languageCode),
      title: String(extra.title || extra.track_name || "")
    };
  };

  PlayerController.prototype._findAvTextTrack = function (track, allowSingle) {
    if (!track) return null;
    var exact = null;
    this.avTextTracks.some(function (candidate) {
      if (track.index === null || track.index === undefined || Number(track.index) !== Number(candidate.index)) return false;
      exact = candidate;
      return true;
    });
    if (exact) return exact;
    var wantedLanguage = Subtitles.canonicalLanguage(track.languageCode || track.language);
    if (wantedLanguage) {
      this.avTextTracks.some(function (candidate) {
        if (!candidate.languageCode || candidate.languageCode !== wantedLanguage) return false;
        exact = candidate;
        return true;
      });
    }
    if (!exact && allowSingle && this.avTextTracks.length === 1) exact = this.avTextTracks[0];
    return exact;
  };

  PlayerController.prototype._configureAvSubtitles = function (player) {
    var self = this;
    var trackInfo = [];
    try { trackInfo = player.getTotalTrackInfo() || []; } catch (_) { trackInfo = []; }
    this.avTextTracks = Array.prototype.slice.call(trackInfo).filter(function (track) {
      return String(track && track.type || "").toUpperCase() === "TEXT";
    }).map(function (track) { return self._parseAvTrack(track); });
    var custom = this._customSubtitleActive();
    try { player.setSilentSubtitle(custom || this.playback.subtitleDelivery === "off"); } catch (_) { /* Optional on older firmware. */ }
    if (custom) {
      var selected = this._findAvTextTrack(this.playback.selectedSubtitle, true);
      var selectedApplied = false;
      if (selected) {
        try {
          player.setSelectTrack("TEXT", selected.index);
          selectedApplied = true;
        } catch (_) { /* Fall back to the external cue file when one is available. */ }
      }
      if (selectedApplied && this.playback.subtitleDelivery === "external") {
        this.playback.subtitleDelivery = "native";
        this.playback.subtitleUrl = "";
      } else if (!selectedApplied && this.playback.subtitleDelivery === "external") {
        this._loadExternalSubtitleCues(this.mediaRevision);
      }
      this._applySubtitleSync();
    } else {
      this._renderCue("");
    }
  };

  PlayerController.prototype._handleAvSubtitle = function (duration, cueText, revision) {
    if (!this._mediaIsCurrent(revision) || !this._customSubtitleActive() || this.externalCueLoadedUrl) return;
    var self = this;
    var safeText = Subtitles.sanitizeCueText(cueText);
    var sourceText = String(cueText === undefined || cueText === null ? "" : cueText);
    var durationMs = Math.max(0, Number(duration) || 0);
    this.cueScheduler.showFor(durationMs, function () {
      if (self._mediaIsCurrent(revision)) self._renderCue(safeText ? sourceText : "");
    }, function () {
      if (self._mediaIsCurrent(revision)) self._renderCue("");
    });
  };

  PlayerController.prototype._openAvPlay = function (url) {
    var self = this;
    var player = window.webapis.avplay;
    var revision = this.mediaRevision;
    this.usingAvPlay = true;
    hide(this.html);
    show(this.avObject);
    try {
      player.close();
    } catch (_) { /* Already closed. */ }
    try {
      player.open(url);
      player.setDisplayRect(0, 0, 1920, 1080);
      player.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      try {
        player.setSilentSubtitle(this._customSubtitleActive() || this.playback.subtitleDelivery === "off");
      } catch (_) { /* Optional on older firmware. */ }
      try { player.setTimeoutForBuffering(30); } catch (_) { /* Not available on every model year. */ }
      try { player.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 5); } catch (_) { /* Optional. */ }
      try { player.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 2); } catch (_) { /* Optional. */ }
      player.setListener({
        onbufferingstart: function () { if (self._mediaIsCurrent(revision)) toast("Buffering…", 1200); },
        onbufferingcomplete: function () { if (self._mediaIsCurrent(revision)) self.showChrome(); },
        oncurrentplaytime: function (time) {
          if (!self._mediaIsCurrent(revision)) return;
          if (self.resumeSeekPending) return;
          self.positionMs = self.timelineOffsetMs + (Number(time) || 0);
          self.updateChrome();
          self._updateExternalCue();
        },
        onsubtitlechange: function (duration, cueText) {
          self._handleAvSubtitle(duration, cueText, revision);
        },
        onstreamcompleted: function () { if (self._mediaIsCurrent(revision)) self.stop(true); },
        onerror: function (eventType) {
          self._playbackFailed("Samsung AVPlay could not play this stream" +
            (eventType ? " (" + eventType + ")." : "."), revision);
        }
      });
      player.prepareAsync(function () {
        if (!self._mediaIsCurrent(revision)) return;
        try {
          var mediaDuration = Number(player.getDuration()) || 0;
          if (!self.durationMs && mediaDuration) self.durationMs = self.timelineOffsetMs + mediaDuration;
          function playInSavedState() {
            if (!self._mediaIsCurrent(revision)) return;
            player.play();
            if (self.paused) player.pause();
            self._configureAvSubtitles(player);
          }
          if (self.triedDirect && self.playback.startMs > 0) {
            player.seekTo(self.playback.startMs, function () {
              if (!self._mediaIsCurrent(revision)) return;
              self.resumeSeekPending = false;
              self.positionMs = self.playback.startMs;
              self.updateChrome();
              playInSavedState();
            }, function () {
              if (!self._mediaIsCurrent(revision)) return;
              self.resumeSeekPending = false;
              playInSavedState();
            });
          } else {
            self.resumeSeekPending = false;
            playInSavedState();
          }
          self.updateChrome();
        } catch (error) { self._playbackFailed(friendlyError(error), revision); }
      }, function (error) {
        self._playbackFailed("Samsung AVPlay could not prepare this stream" +
          (error ? " (" + friendlyError(error) + ")." : "."), revision);
      });
    } catch (error) {
      this._playbackFailed(friendlyError(error), revision);
    }
  };

  PlayerController.prototype._openHtml = function (url) {
    var self = this;
    var revision = this.mediaRevision;
    this.usingAvPlay = false;
    hide(this.avObject);
    show(this.html);
    this.html.src = url;
    if (this.triedDirect && this.playback.startMs > 0) {
      var resumeAfterMetadata = function () {
        self.html.removeEventListener("loadedmetadata", resumeAfterMetadata);
        if (!self._mediaIsCurrent(revision)) return;
        try {
          self.html.currentTime = self.playback.startMs / 1000;
          self.positionMs = self.playback.startMs;
        } catch (_) { /* Stream may not be seekable. */ }
        self.resumeSeekPending = false;
        self.updateChrome();
      };
      if (this.html.readyState >= 1) resumeAfterMetadata();
      else this.html.addEventListener("loadedmetadata", resumeAfterMetadata);
    }
    this._configureHtmlSubtitles();
    if (!this.paused) {
      var promise = this.html.play();
      if (promise && promise.catch) promise.catch(function (error) {
        self._playbackFailed(friendlyError(error), revision);
      });
    }
  };

  PlayerController.prototype._htmlTextTrackArray = function () {
    return this.html && this.html.textTracks ? Array.prototype.slice.call(this.html.textTracks) : [];
  };

  PlayerController.prototype._findHtmlTextTrack = function (selected, allowSingle) {
    var tracks = this._htmlTextTrackArray();
    if (!selected || !tracks.length) return null;
    var wantedLanguage = Subtitles.canonicalLanguage(selected.languageCode || selected.language);
    var wantedTitle = String(selected.title || "").toLowerCase();
    var match = null;
    tracks.some(function (track) {
      var language = Subtitles.canonicalLanguage(track.language || track.srclang);
      var label = String(track.label || "").toLowerCase();
      if (wantedLanguage && language === wantedLanguage || wantedTitle && label.indexOf(wantedTitle) !== -1) {
        match = track;
        return true;
      }
      return false;
    });
    return match || (allowSingle !== false && tracks.length === 1 ? tracks[0] : null);
  };

  PlayerController.prototype._configureHtmlSubtitles = function () {
    var self = this;
    clearInterval(this.htmlCueTimer);
    this.htmlCueTimer = null;
    var tracks = this._htmlTextTrackArray();
    var selected = this._customSubtitleActive() ? this._findHtmlTextTrack(this.playback.selectedSubtitle, true) : null;
    tracks.forEach(function (track) {
      try { track.mode = track === selected ? "hidden" : "disabled"; } catch (_) { /* Read-only on some preview engines. */ }
    });
    if (!selected) {
      if (this.playback && this.playback.subtitleDelivery === "external") {
        if (this.html.readyState < 1) return;
        this._loadExternalSubtitleCues(this.mediaRevision);
        return;
      }
      this._renderCue("");
      return;
    }
    this._resetExternalSubtitleCues();
    if (this.playback.subtitleDelivery === "external") {
      this.playback.subtitleDelivery = "native";
      this.playback.subtitleUrl = "";
    }
    this.htmlCueTimer = setInterval(function () { self._updateHtmlCue(); }, 100);
    this._updateHtmlCue();
  };

  PlayerController.prototype._updateHtmlCue = function () {
    if (this.usingAvPlay || !this._customSubtitleActive()) return;
    if (this.externalCueLoadedUrl) {
      this._updateExternalCue();
      return;
    }
    var track = this._findHtmlTextTrack(this.playback.selectedSubtitle);
    if (!track || !track.cues) return;
    var positionMs = (Number(this.html.currentTime) || 0) * 1000;
    var offset = state.subtitleStore.getSyncOffset();
    var textParts = [];
    for (var index = 0; index < track.cues.length; index += 1) {
      var cue = track.cues[index];
      if (Subtitles.cueIsActive({ startTime: cue.startTime, endTime: cue.endTime }, positionMs, offset)) {
        textParts.push(cue.text || "");
      }
    }
    var cueText = textParts.join("\n");
    if (cueText !== this.lastCueSource) this._renderCue(cueText);
  };

  PlayerController.prototype._playbackFailed = function (message, revision) {
    if (revision !== undefined && revision !== this.mediaRevision) return;
    if (!this.playback || !this.client || this.contextRevision !== state.activationRevision) return;
    if (this.playback && this.playback.directUrl && !this.triedDirect) {
      this.triedDirect = true;
      toast("Transcode failed; trying direct play…", 3200);
      this._closeMedia();
      this._open(this.playback.directUrl);
      return;
    }
    toast(message || "Playback failed.", 7000);
    this.stop(false);
  };

  PlayerController.prototype._closeMedia = function () {
    this.mediaRevision += 1;
    this.cueScheduler.cancel();
    clearInterval(this.htmlCueTimer);
    this.htmlCueTimer = null;
    this._resetExternalSubtitleCues();
    this.avTextTracks = [];
    this._renderCue("");
    if (this.usingAvPlay && window.webapis && window.webapis.avplay) {
      try { window.webapis.avplay.stop(); } catch (_) { /* no-op */ }
      try { window.webapis.avplay.close(); } catch (_) { /* no-op */ }
    }
    this.ignoreHtmlErrorUntil = Date.now() + 500;
    this.html.pause();
    this.html.removeAttribute("src");
    this.html.load();
  };

  PlayerController.prototype.toggle = function () {
    if (!this.playback) return;
    try {
      if (this.usingAvPlay) {
        if (this.paused) window.webapis.avplay.play();
        else window.webapis.avplay.pause();
      } else {
        if (this.paused) this.html.play();
        else this.html.pause();
      }
      this.paused = !this.paused;
      if (this.client) this.client.reportProgress(this.playback, this.positionMs, this.paused ? "paused" : "playing");
      this._updateActionLabels();
      this.showChrome();
    } catch (error) { toast(friendlyError(error)); }
  };

  PlayerController.prototype.seek = function (deltaMs) {
    if (!this.playback) return;
    var target = Math.max(this.timelineOffsetMs, Math.min(this.durationMs || Infinity, this.positionMs + deltaMs));
    var mediaTarget = Math.max(0, target - this.timelineOffsetMs);
    try {
      if (this.usingAvPlay) window.webapis.avplay.seekTo(mediaTarget);
      else this.html.currentTime = mediaTarget / 1000;
      this.positionMs = target;
      this.updateChrome();
      this.showChrome();
    } catch (error) { toast(friendlyError(error)); }
  };

  PlayerController.prototype.stop = function (completed) {
    if (!this.playback) {
      this.restoreScreen();
      return;
    }
    clearInterval(this.progressTimer);
    clearTimeout(this.chromeTimer);
    clearInterval(this.htmlCueTimer);
    clearInterval(this.externalCueTimer);
    this.subtitleOperationRevision += 1;
    this.searchRevision += 1;
    if (this.client) this.client.reportProgress(this.playback, completed ? this.durationMs : this.positionMs, "stopped");
    this._closeMedia();
    this.closeSubtitlePanel(true);
    this.playback = null;
    this.client = null;
    this.positionMs = 0;
    this.durationMs = 0;
    this.timelineOffsetMs = 0;
    this.resumeSeekPending = false;
    this.paused = false;
    this.focusMode = "transport";
    this.subtitlePreferenceContext = null;
    this.restoreScreen();
  };

  PlayerController.prototype.teardown = function () {
    clearInterval(this.progressTimer);
    clearTimeout(this.chromeTimer);
    clearInterval(this.htmlCueTimer);
    clearInterval(this.externalCueTimer);
    this.subtitleOperationRevision += 1;
    this.searchRevision += 1;
    if (this.playback && this.client) {
      this.client.reportProgress(this.playback, this.positionMs, "stopped");
    }
    if (this.playback) this._closeMedia();
    this.closeSubtitlePanel(true);
    this.playback = null;
    this.client = null;
    this.positionMs = 0;
    this.durationMs = 0;
    this.timelineOffsetMs = 0;
    this.resumeSeekPending = false;
    this.paused = false;
    this.focusMode = "transport";
    this.subtitlePreferenceContext = null;
    this.panelSearchResults = [];
    this.panelStatus = "";
  };

  PlayerController.prototype.updateChrome = function () {
    setText("player-current", formatTime(this.positionMs));
    setText("player-duration", formatTime(this.durationMs));
    var percent = this.durationMs ? Math.min(100, this.positionMs / this.durationMs * 100) : 0;
    byId("player-progress-fill").style.width = percent + "%";
    this._updateActionLabels();
  };

  PlayerController.prototype.showChrome = function () {
    var chrome = byId("player-chrome");
    chrome.classList.remove("is-hidden");
    clearTimeout(this.chromeTimer);
    if (this.focusMode === "row" || this.focusMode === "panel") return;
    var self = this;
    this.chromeTimer = setTimeout(function () {
      if (self.focusMode === "transport") chrome.classList.add("is-hidden");
    }, 4500);
  };

  PlayerController.prototype._renderCue = function (cueText) {
    var overlay = byId("subtitle-overlay");
    var cue = byId("subtitle-cue");
    if (!overlay || !cue) return;
    while (cue.firstChild) cue.removeChild(cue.firstChild);
    var sourceText = String(cueText === undefined || cueText === null ? "" : cueText);
    var safeText = Subtitles.sanitizeCueText(sourceText);
    this.lastCueSource = sourceText;
    this.lastCueText = safeText;
    if (!safeText || !this._customSubtitleActive()) {
      overlay.setAttribute("aria-hidden", "true");
      return;
    }
    var style = state.subtitleStore.getAppearance();
    var wrapper = document.createElement("span");
    wrapper.className = "subtitle-cue-text";
    wrapper.style.backgroundColor = Subtitles.hexToRgba(style.backgroundColor, style.backgroundOpacity);
    Subtitles.parseCueMarkup(sourceText).forEach(function (run) {
      var span = document.createElement("span");
      var classes = [];
      if (run.bold) classes.push("subtitle-cue-run--bold");
      if (run.italic) classes.push("subtitle-cue-run--italic");
      if (run.underline) classes.push("subtitle-cue-run--underline");
      span.className = classes.join(" ");
      span.appendChild(document.createTextNode(run.text));
      wrapper.appendChild(span);
    });
    cue.appendChild(wrapper);
    overlay.setAttribute("aria-hidden", "false");
  };

  PlayerController.prototype.applySubtitleStyle = function () {
    var cue = byId("subtitle-cue");
    if (!cue || !state.subtitleStore) return;
    var style = state.subtitleStore.getAppearance();
    cue.style.fontSize = style.fontSize + "px";
    cue.style.color = style.textColor;
    cue.style.fontWeight = style.bold ? "800" : "400";
    cue.style.fontStyle = style.italic ? "italic" : "normal";
    cue.style.bottom = (100 - style.verticalPosition) + "%";
    cue.style.webkitTextStroke = style.outlineThickness + "px " + style.outlineColor;
    cue.style.textShadow = style.outlineThickness ?
      "0 2px " + Math.max(2, style.outlineThickness * 2) + "px " + style.outlineColor : "none";
    if (this.lastCueSource) this._renderCue(this.lastCueSource);
  };

  PlayerController.prototype._applySubtitleSync = function () {
    if (!this.playback || this.playback.subtitleDelivery === "burned") return false;
    var offset = state.subtitleStore.getSyncOffset();
    if (this.usingAvPlay && !this.externalCueLoadedUrl && this._customSubtitleActive() &&
        window.webapis && window.webapis.avplay) {
      try {
        window.webapis.avplay.setSubtitlePosition(offset);
        return true;
      } catch (_) { return false; }
    }
    this._updateExternalCue();
    this._updateHtmlCue();
    return true;
  };

  PlayerController.prototype._updateActionLabels = function () {
    var playAction = byId("player-play-action");
    var subtitleAction = byId("player-subtitles-action");
    if (playAction) playAction.textContent = this.paused ? "▶ Play" : "Ⅱ Pause";
    if (subtitleAction) {
      var selected = this.playback && this.playback.selectedSubtitle;
      var label = selected ? Subtitles.languageName(selected.languageCode, selected.language) : "Off";
      subtitleAction.textContent = "CC " + label;
    }
  };

  PlayerController.prototype._setActionRowFocusable = function (enabled) {
    [byId("player-play-action"), byId("player-subtitles-action")].forEach(function (button) {
      if (button) button.setAttribute("data-focusable", enabled ? "true" : "false");
    });
  };

  PlayerController.prototype._focusAction = function () {
    var actions = [byId("player-play-action"), byId("player-subtitles-action")];
    actions.forEach(function (button, index) {
      if (button) button.classList.toggle("is-selected", index === this.actionRowIndex);
    }, this);
    var target = actions[this.actionRowIndex];
    if (target && target.focus) target.focus({ preventScroll: true });
  };

  PlayerController.prototype.enterActionRow = function (index) {
    if (!this.playback) return;
    this.focusMode = "row";
    this.actionRowIndex = Number(index) === 1 ? 1 : 0;
    this._setActionRowFocusable(true);
    this.showChrome();
    this._focusAction();
  };

  PlayerController.prototype.leaveActionRow = function () {
    this.focusMode = "transport";
    this._setActionRowFocusable(false);
    [byId("player-play-action"), byId("player-subtitles-action")].forEach(function (button) {
      if (button) button.classList.remove("is-selected");
    });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.showChrome();
  };

  PlayerController.prototype.handleDirection = function (direction) {
    if (!this.playback) return false;
    if (this.focusMode === "panel") return this._movePanelFocus(direction);
    var transition = Subtitles.playerFocusTransition(this.focusMode, direction, this.actionRowIndex);
    if (transition.action === "seek-back") this.seek(-30000);
    else if (transition.action === "seek-forward") this.seek(30000);
    else if (transition.action === "leave-row") this.leaveActionRow();
    else if (transition.action === "focus-row") this.enterActionRow(transition.rowIndex);
    else this.showChrome();
    return true;
  };

  PlayerController.prototype.handleEnter = function () {
    if (!this.playback) return;
    if (this.focusMode === "panel") {
      var active = document.activeElement;
      if (active && active.tagName === "INPUT") {
        if (active.id === "subtitle-search-language") this._focusPanelByAttribute("id", "subtitle-search-title");
        else this.submitSubtitleSearch();
      } else if (active && active.click) active.click();
      return;
    }
    if (this.focusMode === "row") {
      if (this.actionRowIndex === 1) this.openSubtitlePanel("tracks");
      else this.toggle();
      return;
    }
    this.toggle();
  };

  PlayerController.prototype.openSubtitlePanel = function (tab) {
    if (!this.playback) return;
    this.focusMode = "panel";
    this.panelTab = tab || this.panelTab || "tracks";
    if (this.panelTab === "search" && this.client.provider !== "plex") this.panelTab = "tracks";
    this._setActionRowFocusable(false);
    clearTimeout(this.chromeTimer);
    byId("player-chrome").classList.remove("is-hidden");
    var panel = byId("subtitle-panel");
    panel.classList.remove("hidden");
    panel.setAttribute("aria-hidden", "false");
    var searchTab = byId("subtitle-search-tab");
    var canSearch = this.client && this.client.provider === "plex";
    searchTab.classList.toggle("hidden", !canSearch);
    searchTab.setAttribute("data-focusable", canSearch ? "true" : "false");
    this._renderSubtitlePanel({ first: true });
  };

  PlayerController.prototype.closeSubtitlePanel = function (silent) {
    var panel = byId("subtitle-panel");
    var wasOpen = panel && !panel.classList.contains("hidden");
    if (panel) {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
    }
    if (!wasOpen) return false;
    this.panelBusy = false;
    this.searchRevision += 1;
    if (!silent && this.playback) this.enterActionRow(1);
    else this.focusMode = "transport";
    return true;
  };

  PlayerController.prototype._panelFocusables = function () {
    return all('#subtitle-panel [data-focusable="true"]:not([disabled])').filter(function (element) {
      return !closest(element, ".hidden");
    });
  };

  PlayerController.prototype._focusPanelElement = function (element) {
    if (!element || !element.focus) return;
    element.focus({ preventScroll: true });
    var viewport = byId("subtitle-panel-scroll");
    if (!viewport || !viewport.contains(element)) return;
    var top = element.offsetTop;
    var bottom = top + element.offsetHeight;
    if (top < viewport.scrollTop + 10) viewport.scrollTop = Math.max(0, top - 10);
    else if (bottom > viewport.scrollTop + viewport.clientHeight - 10) {
      viewport.scrollTop = bottom - viewport.clientHeight + 10;
    }
  };

  PlayerController.prototype._focusPanelByAttribute = function (name, value) {
    var target = null;
    this._panelFocusables().some(function (element) {
      if (element.getAttribute(name) !== value) return false;
      target = element;
      return true;
    });
    this._focusPanelElement(target || this._panelFocusables()[0]);
  };

  PlayerController.prototype._afterPanelRender = function (focusRequest) {
    var self = this;
    requestFrame(function () {
      if (self.focusMode !== "panel") return;
      if (state.navigation) state.navigation.refresh(byId("player-screen"));
      if (focusRequest && focusRequest.name) self._focusPanelByAttribute(focusRequest.name, focusRequest.value);
      else self._focusPanelElement(self._panelFocusables()[0]);
    });
  };

  PlayerController.prototype._movePanelFocus = function (direction) {
    var active = document.activeElement;
    var adjust = active && active.getAttribute && active.getAttribute("data-subtitle-adjust");
    if (adjust && (direction === "left" || direction === "right")) {
      this._adjustSubtitleSetting(adjust, direction === "right" ? 1 : -1);
      return true;
    }
    var activeTab = active && active.getAttribute && active.getAttribute("data-subtitle-tab");
    if (activeTab && (direction === "left" || direction === "right")) {
      var tabs = all('#subtitle-panel [data-subtitle-tab][data-focusable="true"]').filter(function (tab) {
        return !tab.classList.contains("hidden");
      });
      var tabIndex = Math.max(0, tabs.indexOf(active));
      tabIndex = Math.max(0, Math.min(tabs.length - 1, tabIndex + (direction === "right" ? 1 : -1)));
      if (tabs[tabIndex]) {
        this.setSubtitlePanelTab(tabs[tabIndex].getAttribute("data-subtitle-tab"));
        this._focusPanelByAttribute("data-subtitle-tab", tabs[tabIndex].getAttribute("data-subtitle-tab"));
      }
      return true;
    }
    var controls = this._panelFocusables();
    var index = controls.indexOf(active);
    if (index < 0) index = 0;
    if (direction === "up") index = Math.max(0, index - 1);
    else if (direction === "down") index = Math.min(controls.length - 1, index + 1);
    else return true;
    this._focusPanelElement(controls[index]);
    return true;
  };

  PlayerController.prototype._deliveryNote = function () {
    if (!this.playback || this.playback.subtitleDelivery === "off") return "Subtitles are off.";
    if (this.playback.subtitleDelivery === "burned") {
      return "This image-based subtitle is burned into the video by the server. Appearance and sync controls are unavailable.";
    }
    if (this.playback.subtitleDelivery === "external") return "External text subtitles are rendered safely by Plezy.";
    return "Text subtitles are rendered safely by Plezy.";
  };

  PlayerController.prototype._renderSubtitlePanel = function (focusRequest) {
    var self = this;
    all("#subtitle-panel [data-subtitle-tab]").forEach(function (tab) {
      tab.classList.toggle("is-active", tab.getAttribute("data-subtitle-tab") === self.panelTab);
    });
    setText("subtitle-delivery-note", this._deliveryNote());
    if (this.panelTab === "appearance") this._renderAppearancePanel();
    else if (this.panelTab === "sync") this._renderSyncPanel();
    else if (this.panelTab === "search") this._renderSubtitleSearchPanel();
    else this._renderSubtitleTrackPanel();
    setText("subtitle-panel-status", this.panelStatus);
    this._afterPanelRender(focusRequest || { first: true });
  };

  PlayerController.prototype.setSubtitlePanelTab = function (tab) {
    if (["tracks", "appearance", "sync", "search"].indexOf(tab) === -1) return;
    if (tab === "search" && (!this.client || this.client.provider !== "plex")) return;
    this.panelTab = tab;
    this.panelStatus = "";
    this._renderSubtitlePanel({ name: "data-subtitle-tab", value: tab });
  };

  PlayerController.prototype._renderSubtitleTrackPanel = function () {
    var selected = this.playback && this.playback.selectedSubtitle;
    var tracks = this.playback && this.playback.subtitleTracks || [];
    var html = '<p class="subtitle-section-title">Available tracks</p>' +
      '<button class="subtitle-choice' + (!selected ? " is-selected" : "") + '" data-subtitle-track="off" ' +
      'data-focusable="true" aria-pressed="' + (!selected ? "true" : "false") + '"><span>Off</span></button>';
    html += tracks.map(function (track) {
      var isSelected = selected && String(selected.id) === String(track.id);
      return '<button class="subtitle-choice' + (isSelected ? " is-selected" : "") + '" data-subtitle-track="' +
        encodeURIComponent(String(track.id)) + '" data-focusable="true" aria-pressed="' + (isSelected ? "true" : "false") + '">' +
        '<span>' + escapeHtml(Subtitles.subtitleTrackLabel(track)) + '</span></button>';
    }).join("");
    if (!tracks.length) html += '<p class="subtitle-control-note">No subtitle tracks are available for this item.</p>';
    if (this.client && this.client.provider === "plex") {
      html += '<button class="subtitle-panel-button" data-subtitle-action="open-search" data-focusable="true">' +
        '<span>Search Plex subtitles</span><small>OpenSubtitles</small></button>';
    }
    byId("subtitle-panel-body").innerHTML = html;
  };

  PlayerController.prototype._appearanceSetting = function (key, label, value, disabled) {
    return '<button class="subtitle-setting" data-subtitle-adjust="' + key + '" data-focusable="true"' +
      (disabled ? " disabled" : "") + '><span>' + escapeHtml(label) + '</span><span class="subtitle-setting-value">' +
      escapeHtml(value) + "</span></button>";
  };

  PlayerController.prototype._renderAppearancePanel = function () {
    var style = state.subtitleStore.getAppearance();
    var disabled = Boolean(this.playback && this.playback.subtitleDelivery === "burned");
    var html = '<p class="subtitle-section-title">Text appearance</p>';
    if (disabled) html += '<p class="subtitle-control-note">PGS and other bitmap subtitles are part of the video image after server burn-in.</p>';
    html += this._appearanceSetting("fontSize", "Font size", style.fontSize + " px", disabled);
    html += this._appearanceSetting("textColor", "Text color", style.textColor, disabled);
    html += this._appearanceSetting("outlineColor", "Outline color", style.outlineColor, disabled);
    html += this._appearanceSetting("outlineThickness", "Outline thickness", style.outlineThickness + " px", disabled);
    html += this._appearanceSetting("backgroundColor", "Background color", style.backgroundColor, disabled);
    html += this._appearanceSetting("backgroundOpacity", "Background opacity", Math.round(style.backgroundOpacity * 100) + "%", disabled);
    html += this._appearanceSetting("bold", "Bold", style.bold ? "On" : "Off", disabled);
    html += this._appearanceSetting("italic", "Italic", style.italic ? "On" : "Off", disabled);
    html += this._appearanceSetting("verticalPosition", "Vertical position", style.verticalPosition + "%", disabled);
    html += '<button class="subtitle-panel-button" data-subtitle-action="reset-appearance" data-focusable="true"' +
      (disabled ? " disabled" : "") + '>Reset appearance</button>';
    byId("subtitle-panel-body").innerHTML = html;
  };

  PlayerController.prototype._formatSyncOffset = function (offset) {
    if (!offset) return "0.0 s";
    return (offset > 0 ? "+" : "") + (offset / 1000).toFixed(1) + " s";
  };

  PlayerController.prototype._renderSyncPanel = function () {
    var disabled = Boolean(this.playback && this.playback.subtitleDelivery === "burned");
    var offset = state.subtitleStore.getSyncOffset();
    var html = '<p class="subtitle-section-title">Subtitle timing</p>' +
      '<p class="subtitle-control-note">Use Left/Right for 100 ms steps. Positive values show subtitles later.</p>';
    if (disabled) html += '<p class="subtitle-control-note">Timing cannot be changed because this subtitle is burned into the video.</p>';
    html += this._appearanceSetting("sync", "Delay", this._formatSyncOffset(offset), disabled);
    html += '<button class="subtitle-panel-button" data-subtitle-action="reset-sync" data-focusable="true"' +
      (disabled ? " disabled" : "") + '>Reset synchronization</button>';
    byId("subtitle-panel-body").innerHTML = html;
  };

  PlayerController.prototype._renderSubtitleSearchPanel = function () {
    if (!this.client || this.client.provider !== "plex") {
      byId("subtitle-panel-body").innerHTML = '<p class="subtitle-control-note">Subtitle search is available for Plex playback only.</p>';
      return;
    }
    var language = state.subtitleStore.getSearchLanguage();
    var html = '<form id="subtitle-search-form" class="subtitle-search-form">' +
      '<label>Language code<input id="subtitle-search-language" data-focusable="true" maxlength="3" required value="' +
      escapeHtml(language) + '" placeholder="en"></label>' +
      '<label>Optional title filter<input id="subtitle-search-title" data-focusable="true" value="' +
      escapeHtml(this.panelSearchTitle) + '" placeholder="Release or episode title"></label>' +
      '<button type="submit" class="subtitle-panel-button" data-focusable="true">Search</button></form>';
    if (this.panelSearchResults.length) {
      html += '<p class="subtitle-section-title">Search results</p>';
      html += this.panelSearchResults.map(function (result, index) {
        var label = result.displayTitle || result.title || result.language || result.languageCode || "Subtitle";
        var details = [result.providerTitle, result.forced ? "Forced" : "", result.hearingImpaired ? "SDH/CC" : "",
          result.codec ? String(result.codec).toUpperCase() : "", result.score ? "Score " + result.score : ""].filter(Boolean).join(" · ");
        return '<button class="subtitle-search-result" data-subtitle-result="' + index + '" data-focusable="true">' +
          '<span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(details) + '</small></span>' +
          '<small>' + (result.downloaded ? "Add again" : "Download") + "</small></button>";
      }).join("");
    }
    byId("subtitle-panel-body").innerHTML = html;
  };

  PlayerController.prototype._adjustSubtitleSetting = function (key, direction) {
    if (!this.playback || this.playback.subtitleDelivery === "burned") return;
    if (key === "sync") {
      var offset = state.subtitleStore.getSyncOffset();
      state.subtitleStore.setSyncOffset(offset + (direction || 1) * Subtitles.SYNC_STEP_MS);
      this._applySubtitleSync();
      this._renderSubtitlePanel({ name: "data-subtitle-adjust", value: "sync" });
      return;
    }
    var style = state.subtitleStore.getAppearance();
    var colors = ["#FFFFFF", "#FFF200", "#00FFFF", "#00FF66", "#FF80C0", "#000000"];
    if (key === "fontSize") style.fontSize += (direction || 1) * 2;
    else if (key === "outlineThickness") style.outlineThickness += (direction || 1);
    else if (key === "backgroundOpacity") style.backgroundOpacity += (direction || 1) * 0.1;
    else if (key === "verticalPosition") style.verticalPosition += (direction || 1) * 2;
    else if (key === "bold" || key === "italic") {
      style[key] = direction < 0 ? false : (direction > 0 ? true : !style[key]);
    } else if (key === "textColor" || key === "outlineColor" || key === "backgroundColor") {
      var colorIndex = colors.indexOf(style[key]);
      if (colorIndex < 0) colorIndex = 0;
      colorIndex = (colorIndex + (direction || 1) + colors.length) % colors.length;
      style[key] = colors[colorIndex];
    }
    state.subtitleStore.setAppearance(style);
    this.applySubtitleStyle();
    this._renderSubtitlePanel({ name: "data-subtitle-adjust", value: key });
  };

  PlayerController.prototype.handlePlayerClick = function (target) {
    if (!target || !this.playback) return false;
    var playerAction = target.getAttribute("data-player-action");
    if (playerAction === "play") {
      this.enterActionRow(0);
      this.toggle();
      return true;
    }
    if (playerAction === "subtitles") {
      this.enterActionRow(1);
      this.openSubtitlePanel("tracks");
      return true;
    }
    var panelAction = target.getAttribute("data-subtitle-action");
    if (panelAction === "close") this.closeSubtitlePanel();
    else if (panelAction === "open-search") this.setSubtitlePanelTab("search");
    else if (panelAction === "reset-appearance") {
      state.subtitleStore.resetAppearance();
      this.applySubtitleStyle();
      this._renderSubtitlePanel({ name: "data-subtitle-action", value: "reset-appearance" });
    } else if (panelAction === "reset-sync") {
      state.subtitleStore.setSyncOffset(0);
      this._applySubtitleSync();
      this._renderSubtitlePanel({ name: "data-subtitle-action", value: "reset-sync" });
    }
    if (panelAction) return true;
    var tab = target.getAttribute("data-subtitle-tab");
    if (tab) {
      this.setSubtitlePanelTab(tab);
      return true;
    }
    var trackId = target.getAttribute("data-subtitle-track");
    if (trackId !== null) {
      if (trackId === "off") this.selectSubtitle(Subtitles.OFF_TRACK);
      else {
        try { trackId = decodeURIComponent(trackId); } catch (_) { /* Already decoded. */ }
        var selected = null;
        (this.playback.subtitleTracks || []).some(function (track) {
          if (String(track.id) !== String(trackId)) return false;
          selected = track;
          return true;
        });
        if (selected) this.selectSubtitle(selected);
      }
      return true;
    }
    var adjust = target.getAttribute("data-subtitle-adjust");
    if (adjust) {
      this._adjustSubtitleSetting(adjust, 0);
      return true;
    }
    var resultIndex = target.getAttribute("data-subtitle-result");
    if (resultIndex !== null) {
      this.downloadSubtitleResult(Number(resultIndex));
      return true;
    }
    return false;
  };

  PlayerController.prototype.submitSubtitleSearch = function () {
    if (!this.playback || !this.client || this.client.provider !== "plex" || this.panelBusy) return;
    var languageInput = byId("subtitle-search-language");
    var titleInput = byId("subtitle-search-title");
    var language = Subtitles.canonicalLanguage(languageInput && languageInput.value);
    var titleValue = String(titleInput && titleInput.value || "").trim();
    if (!/^[a-z]{2,3}$/.test(language)) {
      this.panelStatus = "Enter a two- or three-letter language code.";
      setText("subtitle-panel-status", this.panelStatus);
      return;
    }
    state.subtitleStore.setSearchLanguage(language);
    this.panelSearchTitle = titleValue;
    this.panelBusy = true;
    this.panelStatus = "Searching Plex subtitle providers…";
    setText("subtitle-panel-status", this.panelStatus);
    var revision = ++this.searchRevision;
    var client = this.client;
    var playback = this.playback;
    var self = this;
    client.searchSubtitles(playback.item.id, { language: language, title: titleValue }).then(function (results) {
      if (revision !== self.searchRevision || client !== self.client || playback !== self.playback) return;
      self.panelBusy = false;
      self.panelSearchResults = results || [];
      self.panelStatus = self.panelSearchResults.length ?
        self.panelSearchResults.length + " subtitle result" + (self.panelSearchResults.length === 1 ? "" : "s") + "." :
        "No matching subtitles were found.";
      self._renderSubtitlePanel({ name: "id", value: "subtitle-search-language" });
    }).catch(function (error) {
      if (revision !== self.searchRevision || client !== self.client || playback !== self.playback) return;
      self.panelBusy = false;
      self.panelSearchResults = [];
      self.panelStatus = "Subtitle search failed: " + friendlyError(error);
      self._renderSubtitlePanel({ first: true });
    });
  };

  PlayerController.prototype.downloadSubtitleResult = function (index) {
    if (this.panelBusy || !this.client || this.client.provider !== "plex") return;
    var result = this.panelSearchResults[index];
    if (!result || !this.playback) return;
    var self = this;
    var client = this.client;
    var playback = this.playback;
    var contextRevision = this.contextRevision;
    var existingIds = (playback.subtitleTracks || []).map(function (track) { return track.id; });
    var operation = ++this.subtitleOperationRevision;
    this.panelBusy = true;
    this.panelStatus = "Downloading subtitle and waiting for Plex metadata…";
    setText("subtitle-panel-status", this.panelStatus);
    client.downloadSubtitle(playback.item.id, result).then(function () {
      return client.waitForSubtitle(playback.item.id, existingIds, {
        timeoutMs: 10000,
        intervalMs: 1000,
        matchResult: result
      });
    }).then(function (refreshed) {
      if (operation !== self.subtitleOperationRevision || contextRevision !== state.activationRevision ||
          client !== self.client || playback !== self.playback) return;
      self.panelBusy = false;
      self.playback.item = refreshed.item;
      self.playback.subtitleTracks = refreshed.subtitleTracks;
      self.subtitlePreferenceContext = self._preferenceContext(refreshed.item);
      self.panelStatus = "Subtitle downloaded. Applying it now…";
      self.selectSubtitle(refreshed.track, refreshed.item);
    }).catch(function (error) {
      if (operation !== self.subtitleOperationRevision || client !== self.client || playback !== self.playback) return;
      self.panelBusy = false;
      self.panelStatus = error && error.code === "SUBTITLE_DOWNLOAD_TIMEOUT"
        ? "Plex accepted the download, but the new track did not appear within 10 seconds."
        : "Subtitle download failed: " + friendlyError(error);
      self._renderSubtitlePanel({ first: true });
    });
  };

  PlayerController.prototype._commitSubtitleSelection = function (selection, delivery) {
    var off = Subtitles.isOffSelection(selection);
    var selected = off ? null : selection;
    this.playback.subtitleTracks = (this.playback.subtitleTracks || []).map(function (track) {
      var result = Object.assign({}, track);
      result.selected = Boolean(selected && String(selected.id) === String(track.id));
      if (result.selected) selected = result;
      return result;
    });
    this.playback.selectedSubtitle = selected;
    this.playback.subtitleDelivery = delivery || Subtitles.subtitleDeliveryFor(selected || Subtitles.OFF_TRACK);
    state.subtitleStore.rememberSelection(this.subtitlePreferenceContext, selected || Subtitles.OFF_TRACK);
    if (!this._customSubtitleActive()) this._renderCue("");
    this.applySubtitleStyle();
    this._applySubtitleSync();
    this._updateActionLabels();
    this.panelStatus = selected ? "Selected " + Subtitles.subtitleTrackLabel(selected) + "." : "Subtitles are off.";
    if (this.focusMode === "panel") this._renderSubtitlePanel({
      name: "data-subtitle-track",
      value: selected ? encodeURIComponent(String(selected.id)) : "off"
    });
  };

  PlayerController.prototype.selectSubtitle = function (selection, itemOverride) {
    if (!this.playback || !this.client || this.panelBusy) return Promise.resolve(false);
    var off = Subtitles.isOffSelection(selection);
    var delivery = off ? "off" : Subtitles.subtitleDeliveryFor(selection);
    var current = this.playback.selectedSubtitle;
    if (!off && current && String(current.id) === String(selection.id) && this.playback.subtitleDelivery === delivery) {
      this._commitSubtitleSelection(selection, delivery);
      return Promise.resolve(true);
    }
    if (!off && delivery !== "burned" && this.usingAvPlay) {
      var avTrack = this._findAvTextTrack(selection, false);
      if (avTrack) {
        try {
          window.webapis.avplay.setSelectTrack("TEXT", avTrack.index);
          try { window.webapis.avplay.setSilentSubtitle(true); } catch (_) { /* Optional. */ }
          this._resetExternalSubtitleCues();
          this.playback.subtitleUrl = "";
          this._commitSubtitleSelection(selection, "native");
          return Promise.resolve(true);
        } catch (_) { /* Reopen with an explicit server selection below. */ }
      }
    }
    if (!off && delivery !== "burned" && !this.usingAvPlay) {
      var htmlTrack = this._findHtmlTextTrack(selection, false);
      if (htmlTrack) {
        this._resetExternalSubtitleCues();
        this.playback.subtitleUrl = "";
        this._commitSubtitleSelection(selection, "native");
        this._configureHtmlSubtitles();
        return Promise.resolve(true);
      }
    }

    var self = this;
    var client = this.client;
    var oldPlayback = this.playback;
    var contextRevision = this.contextRevision;
    var operation = ++this.subtitleOperationRevision;
    var position = this.positionMs;
    var wasPaused = this.paused;
    this.panelBusy = true;
    this.panelStatus = off ? "Turning subtitles off…" : "Switching subtitle track…";
    setText("subtitle-panel-status", this.panelStatus);
    return client.createPlayback(itemOverride || oldPlayback.item, {
      startMs: position,
      subtitleSelection: off ? Subtitles.OFF_TRACK : selection
    }).then(function (playback) {
      if (operation !== self.subtitleOperationRevision || contextRevision !== state.activationRevision ||
          client !== self.client || oldPlayback !== self.playback) return false;
      client.reportProgress(oldPlayback, position, "stopped");
      self._closeMedia();
      self.playback = playback;
      self.positionMs = playback.startMs || position;
      self.durationMs = playback.durationMs || self.durationMs;
      self.paused = wasPaused;
      self.triedDirect = false;
      self.subtitlePreferenceContext = self._preferenceContext(playback.item);
      self.panelBusy = false;
      state.subtitleStore.rememberSelection(self.subtitlePreferenceContext,
        playback.selectedSubtitle || Subtitles.OFF_TRACK);
      self.applySubtitleStyle();
      self.updateChrome();
      self._open(playback.url);
      client.reportProgress(playback, self.positionMs, self.paused ? "paused" : "playing");
      self.panelStatus = playback.selectedSubtitle
        ? "Selected " + Subtitles.subtitleTrackLabel(playback.selectedSubtitle) + "."
        : "Subtitles are off.";
      if (self.focusMode === "panel") self._renderSubtitlePanel({
        name: "data-subtitle-track",
        value: playback.selectedSubtitle ? encodeURIComponent(String(playback.selectedSubtitle.id)) : "off"
      });
      self.showChrome();
      return true;
    }).catch(function (error) {
      if (operation !== self.subtitleOperationRevision || client !== self.client || oldPlayback !== self.playback) return false;
      self.panelBusy = false;
      self.panelStatus = "Could not switch subtitles: " + friendlyError(error);
      if (self.focusMode === "panel") self._renderSubtitlePanel({ first: true });
      toast(self.panelStatus, 6500);
      return false;
    });
  };

  function moveFocus(direction) {
    return state.navigation ? state.navigation.move(direction) : false;
  }

  function exitApplication() {
    try {
      if (window.tizen && tizen.application) {
        tizen.application.getCurrentApplication().exit();
        return;
      }
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "exit-app" }));
        return;
      }
    } catch (_) { /* Fall through in browser preview. */ }
    toast("Press Back again from the TV home screen to exit.");
  }

  function goBack() {
    if (state.screen !== "player" && Date.now() < state.suppressExitUntil) return;
    if (state.screen === "player") {
      if (state.player.closeSubtitlePanel()) return;
      state.suppressExitUntil = Date.now() + 2500;
      state.player.stop(false);
      return;
    }
    if (state.screen === "detail") {
      if (state.detailStack.length) {
        openDetail(state.detailStack.pop(), true);
      } else {
        state.currentDetail = null;
        state.currentPlayTarget = null;
        showScreen("browse");
      }
      return;
    }
    if (state.screen === "confirm") {
      cancelConfirmation();
      return;
    }
    if (state.screen === "plex-pin") {
      cancelPlexPin();
      return;
    }
    if (state.screen === "provider-manage") {
      if (state.activeIdentity && state.client) {
        showScreen("browse");
        routeSettings();
      } else renderIdentityPicker();
      return;
    }
    if (state.screen === "server") {
      cancelPlexServer();
      return;
    }
    if (state.screen === "plex-link" || state.screen === "jellyfin-login") {
      clearInterval(state.pinTimer);
      if (state.setupReturnScreen === "provider-manage") renderProviderManagement();
      else renderIdentityPicker();
      return;
    }
    if (state.screen === "browse" && state.route !== "home") {
      routeHome();
      return;
    }
    if (state.screen === "identity-picker") {
      exitApplication();
      return;
    }
    exitApplication();
  }

  function handleHardwareBack() {
    var now = Date.now();
    if (now - state.lastBackAt < 700) return;
    state.lastBackAt = now;
    goBack();
  }

  function performanceNow() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  }

  function performanceDiagnosticsEnabled() {
    if (window.__PLEZY_TV_PERFORMANCE__ === true) return true;
    try {
      if (window.localStorage.getItem("plezy.tv.performanceDiagnostics") === "1") return true;
    } catch (_) { /* Storage can be unavailable in browser preview privacy modes. */ }
    return /(?:\?|&)plezyPerf=1(?:&|$)/.test(window.location && window.location.search || "");
  }

  function logRuntimeDimensions() {
    if (!state.performanceDiagnostics) return;
    var display = window.screen || {};
    console.log("[PlezyTV performance] runtime-dimensions", {
      logicalCanvas: "1920x1080",
      viewport: String(window.innerWidth || 0) + "x" + String(window.innerHeight || 0),
      display: String(display.width || 0) + "x" + String(display.height || 0),
      devicePixelRatio: window.devicePixelRatio || 1,
      avPlayDisplayRect: "0,0,1920,1080"
    });
  }

  function recordNavigationPerformance(startedAt, direction, moved, repeat) {
    if (!state.performanceDiagnostics) return;
    console.log("[PlezyTV performance] keydown-to-focus", {
      direction: direction,
      repeat: repeat,
      moved: moved,
      durationMs: Math.round((performanceNow() - startedAt) * 10) / 10
    });
    requestFrame(function () {
      setTimeout(function () {
        console.log("[PlezyTV performance] keydown-to-next-paint", {
          direction: direction,
          repeat: repeat,
          moved: moved,
          durationMs: Math.round((performanceNow() - startedAt) * 10) / 10
        });
      }, 0);
    });
  }

  function directionForKeyCode(code) {
    if (code === 37) return "left";
    if (code === 38) return "up";
    if (code === 39) return "right";
    if (code === 40) return "down";
    return "";
  }

  function handleKey(event) {
    var code = event.keyCode;
    var direction = directionForKeyCode(code);
    var repeatResult = null;
    var diagnosticStartedAt = 0;
    if (direction) {
      event.preventDefault();
      repeatResult = state.repeatGate.accept(code, event.repeat);
      if (!repeatResult.accepted) return;
      if (state.performanceDiagnostics) diagnosticStartedAt = performanceNow();
    }
    if (state.screen === "player") {
      if (code === 13) state.player.handleEnter();
      else if ([19, 415, 10252].indexOf(code) !== -1) state.player.toggle();
      else if (direction) state.player.handleDirection(direction);
      else if (code === 412) state.player.seek(-30000);
      else if (code === 417) state.player.seek(30000);
      else if (code === 10009 || code === 27) handleHardwareBack();
      else if (code === 413) goBack();
      else state.player.showChrome();
      if (!direction) event.preventDefault();
      if (direction) recordNavigationPerformance(diagnosticStartedAt, direction, true, repeatResult.repeat);
      return;
    }
    if (direction) {
      var moved = moveFocus(direction);
      recordNavigationPerformance(diagnosticStartedAt, direction, moved, repeatResult.repeat);
    }
    else if (code === 10009 || code === 27) { handleHardwareBack(); event.preventDefault(); }
  }

  function handleKeyUp(event) {
    if (!directionForKeyCode(event.keyCode)) return;
    event.preventDefault();
    state.repeatGate.release(event.keyCode);
  }

  function registerRemoteKeys() {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind"].forEach(function (key) {
          try { tizen.tvinputdevice.registerKey(key); } catch (_) { /* Key availability differs by model. */ }
        });
      }
    } catch (_) { /* Browser preview has no Tizen API. */ }
  }

  function bindEvents() {
    document.addEventListener("keydown", handleKey);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", function () { state.repeatGate.releaseAll(); });
    document.addEventListener("tizenhwkey", function (event) {
      if (event.keyName === "back") {
        handleHardwareBack();
        if (event.preventDefault) event.preventDefault();
      }
    });
    document.addEventListener("click", function (event) {
      var target = closest(event.target, "button,[data-item],[data-route],[data-library]");
      if (!target) return;
      if (state.screen === "player" && state.player.handlePlayerClick(target)) return;
      var route = target.getAttribute("data-route");
      var itemId = target.getAttribute("data-item");
      var libraryIndex = target.getAttribute("data-library");
      var serverIndex = target.getAttribute("data-server");
      var serverSwitchIndex = target.getAttribute("data-server-switch");
      var identityId = target.getAttribute("data-identity-id");
      var unlinkPlexAccountId = target.getAttribute("data-plex-unlink");
      var removeJellyfinIdentityId = target.getAttribute("data-jellyfin-remove");
      var connectionId = target.getAttribute("data-connection-switch");
      var action = target.getAttribute("data-action");
      if (route) navigate(route);
      if (itemId !== null) activateItem(state.items[itemId], target.getAttribute("data-direct-play") === "true");
      if (libraryIndex !== null) openLibrary(Number(libraryIndex));
      if (serverIndex !== null) choosePlexServer(Number(serverIndex));
      if (serverSwitchIndex !== null) switchPlexServer(Number(serverSwitchIndex));
      if (identityId !== null) selectIdentity(identityId);
      if (unlinkPlexAccountId !== null) unlinkPlexAccount(unlinkPlexAccountId);
      if (removeJellyfinIdentityId !== null) removeJellyfinIdentity(removeJellyfinIdentityId);
      if (connectionId !== null) switchConnection(connectionId);
      if (action === "back") goBack();
      if (action === "manage-providers") renderProviderManagement();
      if (action === "switch-identity") openIdentityPicker();
      if (action === "connect-plex") beginPlexLink();
      if (action === "connect-jellyfin") {
        state.setupReturnScreen = state.screen === "provider-manage" ? "provider-manage" : "identity-picker";
        showScreen("jellyfin-login");
      }
      if (action === "toggle-nick-mode") toggleNickMode();
      if (action === "cancel-pin") cancelPlexPin();
      if (action === "cancel-confirm") cancelConfirmation();
      if (action === "confirm") confirmAction();
      if (action === "load-more") {
        if (state.route === "search") {
          var nextSearchItem = state.searchItems[state.searchVisibleCount];
          state.searchVisibleCount += 60;
          renderSearchItems(nextSearchItem ? itemKey(nextSearchItem) : "");
        } else {
          var nextItem = state.libraryItems[state.libraryVisibleCount];
          state.libraryVisibleCount += 60;
          renderLibraryItems(nextItem ? itemKey(nextItem) : "");
        }
      }
    });
    byId("plex-link-retry").addEventListener("click", function () { beginPlexLink(true); });
    byId("jellyfin-form").addEventListener("submit", jellyfinLogin);
    byId("plex-pin-form").addEventListener("submit", submitPlexPin);
    byId("content-body").addEventListener("submit", function (event) {
      if (event.target && event.target.id === "search-form") {
        event.preventDefault();
        runSearch(byId("search-input").value);
      }
    });
    byId("player-screen").addEventListener("submit", function (event) {
      if (event.target && event.target.id === "subtitle-search-form") {
        event.preventDefault();
        state.player.submitSubtitleSearch();
      }
    });
    byId("detail-play").addEventListener("click", function () {
      if (state.currentPlayTarget) state.player.start(state.currentPlayTarget);
    });
  }

  function updateClock() {
    var now = new Date();
    setText("clock", now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }

  function init() {
    if (!Navigation) throw new Error("Plezy TV navigation module did not load.");
    if (!Identities || !Identities.IdentityStore) throw new Error("Plezy TV identity store did not load.");
    if (!Subtitles || !Subtitles.SubtitlePreferenceStore) throw new Error("Plezy TV subtitle runtime did not load.");
    state.identityStore = new Identities.IdentityStore();
    state.subtitleStore = new Subtitles.SubtitlePreferenceStore();
    state.navigation = new Navigation.NavigationIndex({ document: document, artworkLookAhead: 6 });
    state.repeatGate = new Navigation.RepeatGate(85);
    state.performanceDiagnostics = performanceDiagnosticsEnabled();
    state.player = new PlayerController();
    bindEvents();
    registerRemoteKeys();
    logRuntimeDimensions();
    updateClock();
    setInterval(updateClock, 30000);
    restoreIdentities();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
