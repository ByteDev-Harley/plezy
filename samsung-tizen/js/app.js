(function () {
  "use strict";

  var Api = window.PlezyTVApi;
  var Navigation = window.PlezyTVNavigation;
  var Profiles = window.PlezyTVProfiles;
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
    profileStore: null,
    activeProfile: null,
    activeBinding: null,
    setupProfileId: "",
    setupAccount: null,
    setupClient: null,
    setupAccountPersisted: false,
    setupHomeUsers: [],
    setupHomeUser: null,
    setupIdentityToken: "",
    setupServers: [],
    setupReturnScreen: "profile-picker",
    profileFormMode: "create",
    profileFormTarget: "",
    confirmAction: null,
    confirmReturnScreen: "profile-picker",
    pinResolver: null,
    pinReturnScreen: "profile-picker",
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

  function applyProfileBranding(profile) {
    var enabled = Boolean(profile && profile.nickMode === true);
    var appRoot = byId("app");
    if (appRoot) appRoot.classList.toggle("nick-mode", enabled);
    all(".main-logo").forEach(function (logo) {
      logo.setAttribute("src", enabled ? NICK_MODE_LOGO_SOURCE : STANDARD_LOGO_SOURCE);
      var alternateText = logo.getAttribute(enabled ? "data-nick-alt" : "data-standard-alt");
      if (alternateText !== null) logo.setAttribute("alt", alternateText);
    });
    setText("loading-message", enabled ? "Summoning Nick…" : "Starting Plezy TV…");
    setText("profile-picker-eyebrow", enabled ? "WHO’S NICKING?" : "WHO'S WATCHING?");
    setText("provider-setup-eyebrow", enabled ? "NICK NEEDS A CONNECTION" : "ADD A CONNECTION");
  }

  function persistedLastUsedProfile() {
    var profileId = state.profileStore && state.profileStore.document
      ? state.profileStore.document.lastProfileId
      : "";
    return profileId ? state.profileStore.getProfile(profileId) : null;
  }

  function applyLastUsedProfileBranding() {
    applyProfileBranding(persistedLastUsedProfile());
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

  function profileInitials(name) {
    var words = String(name || "P").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "P";
    return (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : "")).toUpperCase();
  }

  function providerBadges(bindings) {
    var seen = {};
    return (bindings || []).map(function (binding) {
      if (seen[binding.provider]) return "";
      seen[binding.provider] = true;
      return '<span class="provider-badge provider-badge--' + escapeHtml(binding.provider) + '">' +
        escapeHtml(binding.provider) + "</span>";
    }).join("");
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
    if (state.player && state.player.teardown) state.player.teardown();
    clearMediaNavigationState();
    state.client = null;
    state.activeProfile = null;
    state.activeBinding = null;
  }

  function renderProfilePicker(error, focusProfileId) {
    applyLastUsedProfileBranding();
    var profiles = state.profileStore.getProfiles();
    if (!profiles.length) {
      showProfileEditor(null);
      return;
    }
    var list = byId("profile-list");
    list.innerHTML = profiles.map(function (profile) {
      var bindings = state.profileStore.getBindings(profile.id);
      return '<button class="profile-card" data-profile-id="' + escapeHtml(profile.id) +
        '" data-focusable="true"><span class="profile-avatar">' + escapeHtml(profileInitials(profile.name)) +
        '</span><strong>' + escapeHtml(profile.name) + '</strong><span class="profile-provider-badges">' +
        providerBadges(bindings) + "</span><small>" +
        escapeHtml(bindings.length ? bindings.length + (bindings.length === 1 ? " connection" : " connections") : "Set up a provider") +
        "</small></button>";
    }).join("");
    var errorElement = byId("profile-picker-error");
    if (error) {
      errorElement.textContent = friendlyError(error);
      show(errorElement);
    } else {
      errorElement.textContent = "";
      hide(errorElement);
    }
    showScreen("profile-picker");
    if (focusProfileId) {
      scheduleNavigationRefresh({
        scope: byId("profile-picker-screen"),
        attributes: { "data-profile-id": focusProfileId },
        preferAutofocus: false
      });
    }
  }

  function openProfilePicker(error, focusProfileId) {
    leaveActiveContext();
    renderProfilePicker(error, focusProfileId);
  }

  function showProfileEditor(profile) {
    state.profileFormMode = profile ? "rename" : "create";
    state.profileFormTarget = profile ? profile.id : "";
    setText("profile-name-eyebrow", profile ? "EDIT PROFILE" : "NEW PROFILE");
    setText("profile-name-title", profile ? "Rename " + profile.name : "Create a profile");
    setText("profile-name-submit", profile ? "Save" : "Continue");
    byId("profile-name-input").value = profile ? profile.name : "";
    hide(byId("profile-name-error"));
    showScreen("profile-name");
  }

  function submitProfileName(event) {
    event.preventDefault();
    var name = byId("profile-name-input").value;
    var errorElement = byId("profile-name-error");
    try {
      if (state.profileFormMode === "rename") {
        state.profileStore.renameProfile(state.profileFormTarget, name);
        renderProfileManagement(state.profileFormTarget);
      } else {
        var profile = state.profileStore.createProfile(name);
        showProviderSetup(profile.id);
      }
    } catch (error) {
      errorElement.textContent = friendlyError(error);
      show(errorElement);
      focusFirst(byId("profile-name-screen"));
    }
  }

  function showProviderSetup(profileId, error, returnScreen) {
    var profile = state.profileStore.getProfile(profileId);
    if (!profile) {
      renderProfilePicker(new Error("That profile is no longer available."));
      return;
    }
    applyProfileBranding(profile);
    state.setupProfileId = profileId;
    state.setupAccount = null;
    state.setupClient = null;
    state.setupAccountPersisted = false;
    state.setupHomeUsers = [];
    state.setupHomeUser = null;
    state.setupIdentityToken = "";
    state.setupServers = [];
    state.setupReturnScreen = returnScreen || (state.activeProfile ? "browse" : "profile-picker");
    setText("provider-setup-title", "Connect " + profile.name);
    var accounts = state.profileStore.getAccounts("plex");
    setText("plex-connect", accounts.length ? "Link another Plex account" : "Connect Plex");
    byId("linked-plex-accounts").innerHTML = accounts.length
      ? '<p class="eyebrow">LINKED PLEX ACCOUNTS</p>' + accounts.map(function (account) {
        return '<button class="linked-account-button" data-plex-account-id="' + escapeHtml(account.id) +
          '" data-focusable="true"><strong>Use ' + escapeHtml(account.name) +
          '</strong><small>Choose a different Plex Home user or server</small></button>';
      }).join("")
      : "";
    if (error) toast(friendlyError(error), 6500);
    showScreen("welcome");
  }

  function renderProfileManagement(focusProfileId) {
    if (!state.activeProfile) applyLastUsedProfileBranding();
    var profiles = state.profileStore.getProfiles();
    if (!profiles.length) {
      showProfileEditor(null);
      return;
    }
    byId("profile-manage-list").innerHTML = profiles.map(function (profile) {
      var bindings = state.profileStore.getBindings(profile.id);
      return '<div class="management-row"><div class="management-copy"><strong>' + escapeHtml(profile.name) +
        '</strong><small>' + escapeHtml(bindings.length + (bindings.length === 1 ? " connection" : " connections")) +
        '</small></div><button class="small-button" data-profile-rename="' + escapeHtml(profile.id) +
        '" data-focusable="true">Rename</button><button class="small-button small-button--danger" data-profile-delete="' +
        escapeHtml(profile.id) + '" data-focusable="true">Delete</button></div>';
    }).join("");
    showScreen("profile-manage");
    if (focusProfileId) {
      scheduleNavigationRefresh({
        scope: byId("profile-manage-screen"),
        attributes: { "data-profile-rename": focusProfileId },
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
    if (destination === "profile-manage") renderProfileManagement();
    else if (destination === "browse") {
      showScreen("browse");
      routeSettings();
    } else renderProfilePicker();
  }

  function confirmAction() {
    var action = state.confirmAction;
    state.confirmAction = null;
    if (action) action();
  }

  function deleteProfile(profileId) {
    var profile = state.profileStore.getProfile(profileId);
    if (!profile) return;
    showConfirmation(
      "Delete " + profile.name + "?",
      "This removes this profile's connections and Jellyfin credentials. A linked Plex account stays available only while another profile uses it.",
      "Delete profile",
      function () {
        var deletedActiveProfile = Boolean(state.activeProfile && state.activeProfile.id === profileId);
        if (deletedActiveProfile) leaveActiveContext();
        state.profileStore.deleteProfile(profileId);
        if (deletedActiveProfile) applyLastUsedProfileBranding();
        if (state.profileStore.getProfiles().length) renderProfileManagement();
        else showProfileEditor(null);
      },
      "profile-manage"
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
    setText("connection-badge", (state.activeProfile ? state.activeProfile.name + " · " : "") + providerName() + " · " + serverName());
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
      if (providerName() === "Plex" && state.activeBinding) {
        state.profileStore.updateBindingSession(state.activeBinding.id, state.client.toSession(), {
          identityToken: state.client.identityToken,
          serverId: state.client.server && state.client.server.id
        });
        state.activeBinding = state.profileStore.getBinding(state.activeBinding.id);
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
    var previousBinding = state.activeBinding;
    if (state.player && state.player.teardown) state.player.teardown();
    clearMediaNavigationState();
    var revision = state.contentRevision;
    setLoading("Connecting to " + server.name + "…");
    state.client.connect(server);
    state.client.getLibraries().then(function (libraries) {
      if (revision !== state.contentRevision) return;
      state.libraries = libraries;
      if (state.activeBinding) {
        state.profileStore.updateBindingSession(state.activeBinding.id, state.client.toSession(), {
          identityToken: state.client.identityToken,
          serverId: state.client.server && state.client.server.id
        });
        state.profileStore.touchConnection(state.activeProfile.id, state.activeBinding.id);
        state.activeBinding = state.profileStore.getBinding(state.activeBinding.id);
      }
      openBrowse();
      toast("Connected to " + server.name + ".", 2800);
    }).catch(function (error) {
      if (revision !== state.contentRevision) return;
      state.client = Api.clientFromSession(previousSession);
      state.activeBinding = previousBinding;
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
    setPage("Settings", state.activeProfile ? state.activeProfile.name : providerName());
    var nickModeEnabled = Boolean(state.activeProfile && state.activeProfile.nickMode === true);
    var bindings = state.activeProfile ? state.profileStore.getBindings(state.activeProfile.id) : [];
    var connectionRows = bindings.map(function (binding) {
      var current = state.activeBinding && binding.id === state.activeBinding.id;
      var account = state.profileStore.getAccount(binding.accountId);
      var identity = binding.provider === "plex" && binding.homeUser
        ? (binding.homeUser.title || "Plex user")
        : (account && account.name || providerName());
      return '<div class="connection-row' + (current ? " is-current" : "") +
        '"><div class="connection-copy"><strong>' + escapeHtml(binding.name) +
        '</strong><small>' + escapeHtml((binding.provider === "plex" ? "Plex" : "Jellyfin") + " · " + identity +
          (current ? " · Connected" : "")) + '</small></div><button class="small-button" data-connection-switch="' +
        escapeHtml(binding.id) + '" data-focusable="true"' + (current ? " disabled" : "") + '>Use</button>' +
        '<button class="small-button small-button--danger" data-connection-remove="' + escapeHtml(binding.id) +
        '" data-focusable="true">Remove</button></div>';
    }).join("");
    setBody(
      '<section class="settings-panel"><p class="eyebrow">ACTIVE PROFILE</p><h2>' +
      escapeHtml(state.activeProfile ? state.activeProfile.name : "Profile") + '</h2><button class="button" ' +
      'data-action="switch-profile" data-focusable="true">Switch profile</button> ' +
      '<button class="button" data-action="manage-profiles" data-focusable="true">Manage profiles</button></section>' +
      '<section class="settings-panel"><p class="eyebrow">APPEARANCE</p><div class="nick-mode-setting">' +
      '<div class="nick-mode-copy"><h2>Nick Mode</h2><p id="nick-mode-status" class="status-text">' +
      escapeHtml(nickModeEnabled ? "Maximum Nick achieved." : "Plezy branding is active.") +
      '</p></div><button id="nick-mode-switch" class="nick-mode-switch" type="button" role="switch" ' +
      'aria-label="Nick Mode" aria-describedby="nick-mode-status" aria-checked="' +
      (nickModeEnabled ? "true" : "false") + '" data-action="toggle-nick-mode" data-focusable="true">' +
      '<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>' +
      '<span class="switch-label">' + (nickModeEnabled ? "On" : "Off") + '</span></button></div></section>' +
      '<section class="settings-panel"><p class="eyebrow">CONNECTIONS</p><h2>Servers and providers</h2>' +
      connectionRows + '<button class="button button--primary" data-action="add-connection" ' +
      'data-focusable="true">＋ Add connection</button>' +
      '<p class="privacy-note">Provider credentials remain in this TV app\'s local storage and are removed when no profile references them.</p></section>'
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
    if (!state.activeProfile) return;
    var enabled = state.activeProfile.nickMode !== true;
    try {
      state.activeProfile = state.profileStore.setNickMode(state.activeProfile.id, enabled);
      applyProfileBranding(state.activeProfile);
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

  function beginPlexLink() {
    clearInterval(state.pinTimer);
    var client = new Api.PlexClient();
    state.setupClient = client;
    state.setupAccount = null;
    state.setupAccountPersisted = false;
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
      client.identityToken = pin.authToken;
      state.setupAccount = {
        provider: "plex",
        name: "Plex account",
        token: pin.authToken
      };
      setText("plex-link-status", "Signed in. Loading Plex Home…");
      return loadPlexHomeUsers(client, state.setupAccount, false);
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

  function useLinkedPlexAccount(accountId) {
    var account = state.profileStore.getAccount(accountId);
    if (!account || account.provider !== "plex") {
      showProviderSetup(state.setupProfileId, new Error("That linked Plex account is unavailable."), state.setupReturnScreen);
      return;
    }
    var client = new Api.PlexClient({ accountToken: account.token, identityToken: account.token });
    loadPlexHomeUsers(client, account, true);
  }

  function loadPlexHomeUsers(client, account, persisted) {
    state.setupClient = client;
    state.setupAccount = account;
    state.setupAccountPersisted = persisted;
    setLoading("Loading Plex Home users…");
    return client.getHomeUsers().then(function (users) {
      if (!persisted) {
        var owner = users.filter(function (user) { return user.admin; })[0] || users[0];
        if (owner) {
          state.setupAccount.name = owner.title + " · Plex";
          state.setupAccount.username = owner.username || "";
        }
      }
      state.setupHomeUsers = users;
      renderPlexHomeUsers();
    }).catch(function (error) {
      showProviderSetup(state.setupProfileId, error, state.setupReturnScreen);
    });
  }

  function renderPlexHomeUsers(focusUuid) {
    byId("plex-home-list").innerHTML = state.setupHomeUsers.map(function (user, index) {
      var avatar = user.thumb
        ? '<img src="' + escapeHtml(user.thumb) + '" alt="">'
        : escapeHtml(profileInitials(user.title));
      return '<button class="home-user-card" data-home-user="' + index + '" data-home-user-id="' +
        escapeHtml(user.uuid) + '" data-focusable="true"><span class="home-user-avatar">' + avatar +
        '</span><strong>' + escapeHtml(user.title) + '</strong><small>' +
        (user.protected ? "PIN protected" : "Ready to use") + "</small></button>";
    }).join("");
    hide(byId("plex-home-error"));
    showScreen("plex-home");
    if (focusUuid) {
      scheduleNavigationRefresh({
        scope: byId("plex-home-screen"),
        attributes: { "data-home-user-id": focusUuid },
        preferAutofocus: false
      });
    }
  }

  function requestPlexPin(user, error, returnScreen) {
    if (state.pinResolver) state.pinResolver(null);
    state.pinReturnScreen = returnScreen || "activation";
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
      setLoading("Cancelling profile activation…");
      resolver(null);
      return;
    }
    if (state.pinReturnScreen === "plex-home") renderPlexHomeUsers(state.setupHomeUser && state.setupHomeUser.uuid);
    else renderProfilePicker();
  }

  function choosePlexHomeUser(index) {
    var user = state.setupHomeUsers[index];
    if (!user || !state.setupClient) return;
    state.setupHomeUser = user;
    if (user.protected) {
      promptSetupPlexPin(null);
      return;
    }
    activateSetupHomeUser("").catch(function (error) {
      var errorElement = byId("plex-home-error");
      errorElement.textContent = friendlyError(error);
      show(errorElement);
      renderPlexHomeUsers(user.uuid);
      show(errorElement);
    });
  }

  function promptSetupPlexPin(error) {
    requestPlexPin(state.setupHomeUser, error, "plex-home").then(function (pin) {
      if (pin === null) {
        renderPlexHomeUsers(state.setupHomeUser && state.setupHomeUser.uuid);
        return;
      }
      activateSetupHomeUser(pin).catch(function (switchError) {
        if (switchError && switchError.isPinError) promptSetupPlexPin(switchError);
        else {
          renderPlexHomeUsers(state.setupHomeUser && state.setupHomeUser.uuid);
          var errorElement = byId("plex-home-error");
          errorElement.textContent = friendlyError(switchError);
          show(errorElement);
        }
      });
    });
  }

  function switchSetupHomeUser(pin, retried) {
    var client = state.setupClient;
    return client.switchHomeUser(state.setupHomeUser.uuid, pin).then(function (switched) {
      state.setupIdentityToken = switched.token;
      return client.getServers(switched.token);
    }).catch(function (error) {
      if (!retried && error && (error.status === 401 || error.status === 403) && !error.isPinError) {
        return switchSetupHomeUser(pin, true);
      }
      throw error;
    });
  }

  function activateSetupHomeUser(pin) {
    setLoading("Finding servers for " + state.setupHomeUser.title + "…");
    return switchSetupHomeUser(pin, false).then(function (servers) {
      if (!servers.length) throw new Error("No Plex Media Server is available to this Home user.");
      state.setupServers = servers;
      if (servers.length === 1) return choosePlexServer(0);
      renderPlexServers();
      return true;
    });
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
    var client = state.setupClient;
    if (!server || !client || !state.setupHomeUser) return;
    client.connect(server);
    setLoading("Connecting to " + server.name + "…");
    client.getLibraries().then(function (libraries) {
      var account = state.setupAccount;
      if (!state.setupAccountPersisted) {
        account = state.profileStore.upsertAccount({
          provider: "plex",
          name: account.name || "Plex account",
          token: account.token,
          username: account.username || ""
        });
        state.setupAccount = account;
        state.setupAccountPersisted = true;
      }
      var binding = state.profileStore.bindConnection(state.setupProfileId, {
        accountId: account.id,
        provider: "plex",
        name: server.name,
        identityToken: state.setupIdentityToken || client.identityToken,
        homeUser: state.setupHomeUser,
        protected: state.setupHomeUser.protected,
        serverId: server.id,
        session: client.toSession()
      });
      state.profileStore.setDefaultConnection(state.setupProfileId, binding.id);
      enterActiveConnection(state.profileStore.getProfile(state.setupProfileId), binding, client, libraries);
    }).catch(function (error) {
      toast(friendlyError(error), 7000);
      renderPlexServers();
    });
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
        var account = state.profileStore.upsertAccount({
          provider: "jellyfin",
          name: (session.server && session.server.username) || username,
          token: session.token,
          baseUrl: session.baseUrl,
          userId: session.userId,
          server: session.server
        });
        var binding = state.profileStore.bindConnection(state.setupProfileId, {
          accountId: account.id,
          provider: "jellyfin",
          name: session.server && session.server.name || "Jellyfin",
          session: session
        });
        state.profileStore.setDefaultConnection(state.setupProfileId, binding.id);
        enterActiveConnection(state.profileStore.getProfile(state.setupProfileId), binding, client, libraries);
      });
    }).catch(function (error) {
      showScreen("jellyfin-login");
      errorElement.textContent = friendlyError(error);
      show(errorElement);
      focusFirst(byId("jellyfin-login-screen"));
    });
  }

  function enterActiveConnection(profile, binding, client, libraries) {
    if (state.player && state.player.teardown) state.player.teardown();
    state.activationRevision += 1;
    clearMediaNavigationState();
    state.client = client;
    state.activeProfile = profile;
    state.activeBinding = binding;
    state.libraries = libraries || [];
    state.pendingServers = client && client.servers ? client.servers.slice() : [];
    state.profileStore.touchConnection(profile.id, binding.id);
    state.activeProfile = state.profileStore.getProfile(profile.id);
    state.activeBinding = state.profileStore.getBinding(binding.id);
    applyProfileBranding(state.activeProfile);
    state.setupClient = null;
    state.setupAccount = null;
    state.setupHomeUser = null;
    state.setupServers = [];
    openBrowse();
  }

  function activateStoredConnection(profileId, bindingId, rollback) {
    var profile = state.profileStore.getProfile(profileId);
    var binding = state.profileStore.getBinding(bindingId);
    var account = binding && state.profileStore.getAccount(binding.accountId);
    var previous = rollback ? {
      profile: state.activeProfile,
      binding: state.activeBinding,
      client: state.client
    } : null;
    leaveActiveContext();
    applyProfileBranding(profile);
    var revision = state.activationRevision;
    setLoading("Opening " + (profile ? profile.name : "profile") + "…");
    Api.activateConnection(profile, binding, account, {
      requestPin: function (homeUser, error) { return requestPlexPin(homeUser, error, "activation"); }
    }).then(function (result) {
      if (revision !== state.activationRevision) return;
      if (!result.ok) {
        if (previous && previous.client) {
          state.client = previous.client;
          state.activeProfile = previous.profile;
          state.activeBinding = previous.binding;
          state.pendingServers = previous.client.servers ? previous.client.servers.slice() : [];
          applyProfileBranding(previous.profile);
          showScreen("browse");
          routeSettings();
          scheduleNavigationRefresh({
            scope: byId("content-body"),
            attributes: { "data-connection-switch": bindingId },
            preferAutofocus: false
          });
          if (!result.error.cancelled) toast("Could not switch connections: " + result.error.message, 7000);
          return;
        }
        renderProfilePicker(result.error.cancelled ? null : new Error(
          result.error.message + " Select the profile to retry, or use Manage profiles to remove and set it up again."
        ), profileId);
        return;
      }
      if (result.binding && binding.provider === "plex") {
        state.profileStore.updateBindingSession(binding.id, result.session, {
          identityToken: result.binding.identityToken,
          homeUser: result.binding.homeUser,
          serverId: result.binding.serverId
        });
        binding = state.profileStore.getBinding(binding.id);
      }
      enterActiveConnection(profile, binding, result.client, result.validation || []);
    });
  }

  function selectProfile(profileId) {
    var profile = state.profileStore.getProfile(profileId);
    if (!profile) {
      renderProfilePicker(new Error("That profile is no longer available."));
      return;
    }
    applyProfileBranding(profile);
    var binding = state.profileStore.chooseDefaultConnection(profileId);
    if (!binding) {
      leaveActiveContext();
      showProviderSetup(profileId, null, "profile-picker");
      return;
    }
    activateStoredConnection(profileId, binding.id, false);
  }

  function switchConnection(bindingId) {
    if (!state.activeProfile || state.activeBinding && state.activeBinding.id === bindingId) return;
    activateStoredConnection(state.activeProfile.id, bindingId, true);
  }

  function removeConnection(bindingId) {
    var binding = state.profileStore.getBinding(bindingId);
    if (!binding || !state.activeProfile || binding.profileId !== state.activeProfile.id) return;
    showConfirmation(
      "Remove " + binding.name + "?",
      "This removes the saved provider credential when no other profile connection uses it.",
      "Remove connection",
      function () {
        var wasActive = state.activeBinding && state.activeBinding.id === bindingId;
        state.profileStore.unbindConnection(state.activeProfile.id, bindingId);
        if (!wasActive) {
          showScreen("browse");
          routeSettings();
          return;
        }
        var profileId = state.activeProfile.id;
        var replacement = state.profileStore.chooseDefaultConnection(profileId);
        leaveActiveContext();
        if (replacement) activateStoredConnection(profileId, replacement.id, false);
        else showProviderSetup(profileId, null, "profile-picker");
      },
      "browse"
    );
  }

  function restoreProfiles() {
    var profileDocument = state.profileStore.migrateLegacy();
    var lastUsedProfile = profileDocument.lastProfileId
      ? state.profileStore.getProfile(profileDocument.lastProfileId)
      : null;
    applyProfileBranding(lastUsedProfile);
    renderProfilePicker();
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
    this.triedDirect = false;
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
    });
    this.html.addEventListener("ended", function () { if (self.playback) self.stop(true); });
    this.html.addEventListener("error", function () {
      if (self.playback) self._playbackFailed("The TV could not play this stream.");
    });
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
    return client.createPlayback(item).then(function (playback) {
      if (client !== state.client || contextRevision !== state.activationRevision) return;
      self.client = client;
      self.contextRevision = contextRevision;
      self.playback = playback;
      self.positionMs = playback.startMs || 0;
      self.durationMs = playback.durationMs || 0;
      self.paused = false;
      self.triedDirect = false;
      setText("player-title", playback.item.title);
      setText("player-subtitle", playback.item.subtitle || providerName());
      self.updateChrome();
      showScreen("player");
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
    this.timelineOffsetMs = this.triedDirect ? 0 : Number(this.playback && this.playback.startMs || 0);
    this.resumeSeekPending = this.triedDirect && this.playback && this.playback.startMs > 0;
    this.positionMs = Number(this.playback && this.playback.startMs || 0);
    this.updateChrome();
    if (window.webapis && window.webapis.avplay) this._openAvPlay(url);
    else this._openHtml(url);
  };

  PlayerController.prototype._openAvPlay = function (url) {
    var self = this;
    var player = window.webapis.avplay;
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
      try { player.setTimeoutForBuffering(30); } catch (_) { /* Not available on every model year. */ }
      try { player.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 5); } catch (_) { /* Optional. */ }
      try { player.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 2); } catch (_) { /* Optional. */ }
      player.setListener({
        onbufferingstart: function () { toast("Buffering…", 1200); },
        onbufferingcomplete: function () { self.showChrome(); },
        oncurrentplaytime: function (time) {
          if (self.resumeSeekPending) return;
          self.positionMs = self.timelineOffsetMs + (Number(time) || 0);
          self.updateChrome();
        },
        onstreamcompleted: function () { if (self.playback) self.stop(true); },
        onerror: function (eventType) {
          self._playbackFailed("Samsung AVPlay could not play this stream" +
            (eventType ? " (" + eventType + ")." : "."));
        }
      });
      player.prepareAsync(function () {
        try {
          var mediaDuration = Number(player.getDuration()) || 0;
          if (!self.durationMs && mediaDuration) self.durationMs = self.timelineOffsetMs + mediaDuration;
          if (self.triedDirect && self.playback.startMs > 0) {
            player.seekTo(self.playback.startMs, function () {
              self.resumeSeekPending = false;
              self.positionMs = self.playback.startMs;
              self.updateChrome();
              player.play();
            }, function () {
              self.resumeSeekPending = false;
              player.play();
            });
          } else {
            self.resumeSeekPending = false;
            player.play();
          }
          self.updateChrome();
        } catch (error) { self._playbackFailed(friendlyError(error)); }
      }, function (error) {
        self._playbackFailed("Samsung AVPlay could not prepare this stream" +
          (error ? " (" + friendlyError(error) + ")." : "."));
      });
    } catch (error) {
      this._playbackFailed(friendlyError(error));
    }
  };

  PlayerController.prototype._openHtml = function (url) {
    var self = this;
    this.usingAvPlay = false;
    hide(this.avObject);
    show(this.html);
    this.html.src = url;
    if (this.triedDirect && this.playback.startMs > 0) {
      var resumeAfterMetadata = function () {
        self.html.removeEventListener("loadedmetadata", resumeAfterMetadata);
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
    var promise = this.html.play();
    if (promise && promise.catch) promise.catch(function (error) { self._playbackFailed(friendlyError(error)); });
  };

  PlayerController.prototype._playbackFailed = function (message) {
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
    if (this.usingAvPlay && window.webapis && window.webapis.avplay) {
      try { window.webapis.avplay.stop(); } catch (_) { /* no-op */ }
      try { window.webapis.avplay.close(); } catch (_) { /* no-op */ }
    }
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
    if (this.client) this.client.reportProgress(this.playback, completed ? this.durationMs : this.positionMs, "stopped");
    this._closeMedia();
    this.playback = null;
    this.client = null;
    this.positionMs = 0;
    this.durationMs = 0;
    this.timelineOffsetMs = 0;
    this.resumeSeekPending = false;
    this.restoreScreen();
  };

  PlayerController.prototype.teardown = function () {
    clearInterval(this.progressTimer);
    clearTimeout(this.chromeTimer);
    if (this.playback && this.client) {
      this.client.reportProgress(this.playback, this.positionMs, "stopped");
    }
    if (this.playback) this._closeMedia();
    this.playback = null;
    this.client = null;
    this.positionMs = 0;
    this.durationMs = 0;
    this.timelineOffsetMs = 0;
    this.resumeSeekPending = false;
    this.paused = false;
  };

  PlayerController.prototype.updateChrome = function () {
    setText("player-current", formatTime(this.positionMs));
    setText("player-duration", formatTime(this.durationMs));
    var percent = this.durationMs ? Math.min(100, this.positionMs / this.durationMs * 100) : 0;
    byId("player-progress-fill").style.width = percent + "%";
  };

  PlayerController.prototype.showChrome = function () {
    var chrome = byId("player-chrome");
    chrome.classList.remove("is-hidden");
    clearTimeout(this.chromeTimer);
    this.chromeTimer = setTimeout(function () { chrome.classList.add("is-hidden"); }, 4500);
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
    if (state.screen === "profile-name") {
      if (state.profileFormMode === "rename") renderProfileManagement(state.profileFormTarget);
      else if (state.profileStore.getProfiles().length) renderProfilePicker();
      else exitApplication();
      return;
    }
    if (state.screen === "profile-manage") {
      if (state.activeProfile && state.client) {
        showScreen("browse");
        routeSettings();
      } else renderProfilePicker();
      return;
    }
    if (state.screen === "welcome") {
      if (state.setupReturnScreen === "browse" && state.activeProfile && state.client) {
        showScreen("browse");
        routeSettings();
      } else renderProfilePicker(null, state.setupProfileId);
      return;
    }
    if (state.screen === "plex-home") {
      showProviderSetup(state.setupProfileId, null, state.setupReturnScreen);
      showScreen("welcome");
      return;
    }
    if (state.screen === "server") {
      renderPlexHomeUsers(state.setupHomeUser && state.setupHomeUser.uuid);
      return;
    }
    if (state.screen === "plex-link" || state.screen === "jellyfin-login") {
      clearInterval(state.pinTimer);
      showProviderSetup(state.setupProfileId, null, state.setupReturnScreen);
      showScreen("welcome");
      return;
    }
    if (state.screen === "browse" && state.route !== "home") {
      routeHome();
      return;
    }
    if (state.screen === "profile-picker") {
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
      if ([13, 19, 415, 10252].indexOf(code) !== -1) state.player.toggle();
      else if (code === 37 || code === 412) state.player.seek(-30000);
      else if (code === 39 || code === 417) state.player.seek(30000);
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
      var route = target.getAttribute("data-route");
      var itemId = target.getAttribute("data-item");
      var libraryIndex = target.getAttribute("data-library");
      var serverIndex = target.getAttribute("data-server");
      var serverSwitchIndex = target.getAttribute("data-server-switch");
      var profileId = target.getAttribute("data-profile-id");
      var plexAccountId = target.getAttribute("data-plex-account-id");
      var homeUserIndex = target.getAttribute("data-home-user");
      var renameProfileId = target.getAttribute("data-profile-rename");
      var deleteProfileId = target.getAttribute("data-profile-delete");
      var connectionId = target.getAttribute("data-connection-switch");
      var removeConnectionId = target.getAttribute("data-connection-remove");
      var action = target.getAttribute("data-action");
      if (route) navigate(route);
      if (itemId !== null) activateItem(state.items[itemId], target.getAttribute("data-direct-play") === "true");
      if (libraryIndex !== null) openLibrary(Number(libraryIndex));
      if (serverIndex !== null) choosePlexServer(Number(serverIndex));
      if (serverSwitchIndex !== null) switchPlexServer(Number(serverSwitchIndex));
      if (profileId !== null) selectProfile(profileId);
      if (plexAccountId !== null) useLinkedPlexAccount(plexAccountId);
      if (homeUserIndex !== null) choosePlexHomeUser(Number(homeUserIndex));
      if (renameProfileId !== null) showProfileEditor(state.profileStore.getProfile(renameProfileId));
      if (deleteProfileId !== null) deleteProfile(deleteProfileId);
      if (connectionId !== null) switchConnection(connectionId);
      if (removeConnectionId !== null) removeConnection(removeConnectionId);
      if (action === "back") goBack();
      if (action === "new-profile") showProfileEditor(null);
      if (action === "manage-profiles") renderProfileManagement();
      if (action === "switch-profile") openProfilePicker();
      if (action === "toggle-nick-mode") toggleNickMode();
      if (action === "add-connection" && state.activeProfile) showProviderSetup(state.activeProfile.id, null, "browse");
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
    byId("plex-connect").addEventListener("click", beginPlexLink);
    byId("plex-link-retry").addEventListener("click", beginPlexLink);
    byId("jellyfin-connect").addEventListener("click", function () { showScreen("jellyfin-login"); });
    byId("jellyfin-form").addEventListener("submit", jellyfinLogin);
    byId("profile-name-form").addEventListener("submit", submitProfileName);
    byId("plex-pin-form").addEventListener("submit", submitPlexPin);
    byId("content-body").addEventListener("submit", function (event) {
      if (event.target && event.target.id === "search-form") {
        event.preventDefault();
        runSearch(byId("search-input").value);
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
    if (!Profiles || !Profiles.ProfileStore) throw new Error("Plezy TV profile store did not load.");
    state.profileStore = new Profiles.ProfileStore();
    state.navigation = new Navigation.NavigationIndex({ document: document, artworkLookAhead: 6 });
    state.repeatGate = new Navigation.RepeatGate(85);
    state.performanceDiagnostics = performanceDiagnosticsEnabled();
    state.player = new PlayerController();
    bindEvents();
    registerRemoteKeys();
    logRuntimeDimensions();
    updateClock();
    setInterval(updateClock, 30000);
    restoreProfiles();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
