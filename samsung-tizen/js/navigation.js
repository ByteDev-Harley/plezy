(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlezyTVNavigation = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FOCUSABLE_SELECTOR = '[data-focusable="true"]:not([disabled])';
  var ARTWORK_ATTRIBUTE = "data-artwork-src";
  var DIRECTIONS = ["left", "right", "up", "down"];

  function toArray(value) {
    return Array.prototype.slice.call(value || []);
  }

  function hasClass(element, name) {
    return Boolean(element && element.classList && element.classList.contains(name));
  }

  function isDisabled(element) {
    return Boolean(element && (element.disabled || element.getAttribute("disabled") !== null));
  }

  function isFocusableCandidate(element) {
    if (!element || isDisabled(element) || hasClass(element, "hidden")) return false;
    return true;
  }

  function contains(root, element) {
    if (!root || !element) return false;
    if (root === element) return true;
    return Boolean(root.contains && root.contains(element));
  }

  function ancestor(element, predicate, stop) {
    var current = element;
    while (current && current !== stop) {
      if (predicate(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function ancestorByClass(element, name, stop) {
    return ancestor(element, function (candidate) { return hasClass(candidate, name); }, stop);
  }

  function copyRect(rect) {
    var left = Number(rect && rect.left) || 0;
    var top = Number(rect && rect.top) || 0;
    var width = Number(rect && rect.width);
    var height = Number(rect && rect.height);
    var right = Number(rect && rect.right);
    var bottom = Number(rect && rect.bottom);
    if (!isFinite(width)) width = isFinite(right) ? right - left : 0;
    if (!isFinite(height)) height = isFinite(bottom) ? bottom - top : 0;
    if (!isFinite(right)) right = left + width;
    if (!isFinite(bottom)) bottom = top + height;
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: width,
      height: height
    };
  }

  function centerX(rect) { return rect.left + rect.width / 2; }
  function centerY(rect) { return rect.top + rect.height / 2; }

  function directionScore(from, to, direction) {
    var dx = centerX(to) - centerX(from);
    var dy = centerY(to) - centerY(from);
    var primary;
    var secondary;
    if (direction === "left" && dx < -4) {
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (direction === "right" && dx > 4) {
      primary = dx;
      secondary = Math.abs(dy);
    } else if (direction === "up" && dy < -4) {
      primary = -dy;
      secondary = Math.abs(dx);
    } else if (direction === "down" && dy > 4) {
      primary = dy;
      secondary = Math.abs(dx);
    } else {
      return Infinity;
    }
    return primary + secondary * 2.4;
  }

  function nearest(entries, source, direction, filter) {
    var result = null;
    var bestScore = Infinity;
    entries.forEach(function (candidate) {
      if (candidate === source || (filter && !filter(candidate))) return;
      var score = directionScore(source.rect, candidate.rect, direction);
      if (score < bestScore) {
        result = candidate;
        bestScore = score;
      }
    });
    return result;
  }

  function RepeatGate(intervalMs, now) {
    this.intervalMs = Number(intervalMs) || 85;
    this.now = now || function () { return Date.now(); };
    this.down = {};
    this.lastAcceptedAt = {};
  }

  RepeatGate.prototype.accept = function (keyCode, browserRepeat) {
    var key = String(keyCode);
    var at = this.now();
    var nativeRepeatKnown = typeof browserRepeat === "boolean";
    var repeat = browserRepeat === true || (!nativeRepeatKnown && this.down[key] === true);
    this.down[key] = true;
    if (!repeat) {
      this.lastAcceptedAt[key] = at;
      return { accepted: true, repeat: false };
    }
    if (at - (this.lastAcceptedAt[key] || 0) < this.intervalMs) {
      return { accepted: false, repeat: true };
    }
    this.lastAcceptedAt[key] = at;
    return { accepted: true, repeat: true };
  };

  RepeatGate.prototype.release = function (keyCode) {
    var key = String(keyCode);
    delete this.down[key];
    delete this.lastAcceptedAt[key];
  };

  RepeatGate.prototype.releaseAll = function () {
    this.down = {};
    this.lastAcceptedAt = {};
  };

  function NavigationIndex(options) {
    options = options || {};
    this.document = options.document || (typeof document !== "undefined" ? document : null);
    this.artworkLookAhead = Number(options.artworkLookAhead);
    if (!isFinite(this.artworkLookAhead)) this.artworkLookAhead = 6;
    this.scrollMargin = Number(options.scrollMargin);
    if (!isFinite(this.scrollMargin)) this.scrollMargin = 12;
    this.root = null;
    this.entries = [];
    this.containers = [];
    this.viewports = [];
    this.entryByElement = typeof Map === "function" ? new Map() : null;
    this.lastContentElement = null;
  }

  NavigationIndex.prototype._cachedRect = function (element, cacheElements, cacheRects) {
    var index = cacheElements.indexOf(element);
    if (index !== -1) return cacheRects[index];
    var rect = copyRect(element.getBoundingClientRect());
    cacheElements.push(element);
    cacheRects.push(rect);
    return rect;
  };

  NavigationIndex.prototype._containerFor = function (element, root, cacheElements, cacheRects) {
    var containerElement = ancestor(element.parentElement, function (candidate) {
      return hasClass(candidate, "card-row") ||
        hasClass(candidate, "library-grid") ||
        hasClass(candidate, "server-grid") ||
        hasClass(candidate, "profile-grid") ||
        hasClass(candidate, "home-user-grid") ||
        hasClass(candidate, "choice-list") ||
        hasClass(candidate, "management-list") ||
        hasClass(candidate, "linked-account-list") ||
        hasClass(candidate, "provider-buttons") ||
        hasClass(candidate, "profile-picker-actions") ||
        hasClass(candidate, "confirm-actions") ||
        hasClass(candidate, "search-box") ||
        hasClass(candidate, "detail-actions") ||
        candidate.id === "nav-list" ||
        hasClass(candidate, "dialog-card");
    }, root.parentElement);
    if (!containerElement) containerElement = root;

    var existing = null;
    this.containers.some(function (container) {
      if (container.element === containerElement) {
        existing = container;
        return true;
      }
      return false;
    });
    if (existing) return existing;

    var type = "generic";
    var columns = 0;
    if (hasClass(containerElement, "card-row")) type = "shelf";
    else if (hasClass(containerElement, "library-grid")) { type = "grid"; columns = 6; }
    else if (hasClass(containerElement, "server-grid")) { type = "grid"; columns = 3; }
    else if (hasClass(containerElement, "profile-grid")) { type = "grid"; columns = 5; }
    else if (hasClass(containerElement, "home-user-grid")) { type = "grid"; columns = 4; }
    else if (containerElement.id === "nav-list") type = "sidebar";
    else if (hasClass(containerElement, "choice-list") || hasClass(containerElement, "management-list") || hasClass(containerElement, "linked-account-list")) type = "vertical";
    else if (hasClass(containerElement, "provider-buttons") || hasClass(containerElement, "profile-picker-actions") || hasClass(containerElement, "confirm-actions") || hasClass(containerElement, "search-box") || hasClass(containerElement, "detail-actions")) type = "horizontal";
    else if (hasClass(containerElement, "dialog-card")) type = "dialog";

    var created = {
      element: containerElement,
      type: type,
      columns: columns,
      entries: [],
      rect: this._cachedRect(containerElement, cacheElements, cacheRects)
    };
    this.containers.push(created);
    return created;
  };

  NavigationIndex.prototype._viewportFor = function (element, axis, root, cacheElements, cacheRects) {
    var viewportElement;
    if (axis === "x") {
      viewportElement = ancestorByClass(element.parentElement, "card-row", root.parentElement);
    } else {
      if (hasClass(element, "detail-back")) return null;
      viewportElement = ancestor(element.parentElement, function (candidate) {
        return hasClass(candidate, "content-body") ||
          hasClass(candidate, "detail-screen") ||
          hasClass(candidate, "choice-list") ||
          hasClass(candidate, "profile-grid") ||
          hasClass(candidate, "home-user-grid") ||
          hasClass(candidate, "linked-account-list") ||
          hasClass(candidate, "management-card");
      }, root.parentElement);
    }
    if (!viewportElement) return null;

    var existing = null;
    this.viewports.some(function (viewport) {
      if (viewport.element === viewportElement && viewport.axis === axis) {
        existing = viewport;
        return true;
      }
      return false;
    });
    if (existing) return existing;

    var created = {
      element: viewportElement,
      axis: axis,
      rect: this._cachedRect(viewportElement, cacheElements, cacheRects),
      initialScroll: axis === "x" ? (viewportElement.scrollLeft || 0) : (viewportElement.scrollTop || 0)
    };
    this.viewports.push(created);
    return created;
  };

  NavigationIndex.prototype._setEntry = function (element, entry) {
    if (this.entryByElement) this.entryByElement.set(element, entry);
  };

  NavigationIndex.prototype.entryFor = function (element) {
    if (!element) return null;
    if (this.entryByElement) return this.entryByElement.get(element) || null;
    for (var index = 0; index < this.entries.length; index += 1) {
      if (this.entries[index].element === element) return this.entries[index];
    }
    return null;
  };

  NavigationIndex.prototype.refresh = function (root) {
    this.root = root;
    this.entries = [];
    this.containers = [];
    this.viewports = [];
    this.entryByElement = typeof Map === "function" ? new Map() : null;
    var cacheElements = [];
    var cacheRects = [];
    var self = this;
    if (!root || !root.querySelectorAll) return this;

    toArray(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusableCandidate).forEach(function (element) {
      var elementRect = self._cachedRect(element, cacheElements, cacheRects);
      if (elementRect.width <= 0 || elementRect.height <= 0) return;
      var container = self._containerFor(element, root, cacheElements, cacheRects);
      var entry = {
        element: element,
        rect: elementRect,
        container: container,
        containerIndex: container.entries.length,
        neighbors: { left: null, right: null, up: null, down: null },
        horizontalViewport: self._viewportFor(element, "x", root, cacheElements, cacheRects),
        verticalViewport: self._viewportFor(element, "y", root, cacheElements, cacheRects),
        artwork: element.querySelector ? element.querySelector("img[" + ARTWORK_ATTRIBUTE + "]") : null
      };
      container.entries.push(entry);
      self.entries.push(entry);
      self._setEntry(element, entry);
    });

    if (this.lastContentElement && !this.entryFor(this.lastContentElement)) this.lastContentElement = null;
    this._buildSpatialNeighbors();
    this._buildContainerNeighbors();
    this._buildShelfTransitions();
    this._buildBrowseTransitions();
    this._buildDialogTransitions();
    this._buildDetailTransitions();
    this._loadInitialArtwork();
    return this;
  };

  NavigationIndex.prototype._buildSpatialNeighbors = function () {
    var entries = this.entries;
    entries.forEach(function (entry) {
      DIRECTIONS.forEach(function (direction) {
        entry.neighbors[direction] = nearest(entries, entry, direction);
      });
    });
  };

  NavigationIndex.prototype._buildContainerNeighbors = function () {
    this.containers.forEach(function (container) {
      var entries = container.entries;
      if (container.type === "shelf" || container.type === "horizontal") {
        entries.forEach(function (entry, index) {
          entry.neighbors.left = index > 0 ? entries[index - 1] : null;
          entry.neighbors.right = index < entries.length - 1 ? entries[index + 1] : null;
        });
      } else if (container.type === "grid") {
        entries.forEach(function (entry, index) {
          var columns = container.columns;
          if (index % columns !== 0) entry.neighbors.left = entries[index - 1];
          else if (columns === 6) entry.neighbors.left = null;
          if (index % columns !== columns - 1 && index < entries.length - 1) entry.neighbors.right = entries[index + 1];
          else if (columns === 6) entry.neighbors.right = null;
          if (index >= columns) entry.neighbors.up = entries[index - columns];
          if (index + columns < entries.length) entry.neighbors.down = entries[index + columns];
          else if (columns === 6) entry.neighbors.down = null;
        });
      } else if (container.type === "sidebar" || container.type === "vertical" || container.type === "dialog") {
        entries.slice().sort(function (left, right) {
          return centerY(left.rect) - centerY(right.rect) || centerX(left.rect) - centerX(right.rect);
        }).forEach(function (entry, index, ordered) {
          if (index > 0) entry.neighbors.up = ordered[index - 1];
          if (index < ordered.length - 1) entry.neighbors.down = ordered[index + 1];
        });
      }
    });
  };

  NavigationIndex.prototype._shelfScope = function (container) {
    return ancestor(container.element.parentElement, function (candidate) {
      return hasClass(candidate, "content-body") || hasClass(candidate, "detail-children");
    }, this.root ? this.root.parentElement : null) || this.root;
  };

  NavigationIndex.prototype._buildShelfTransitions = function () {
    var self = this;
    var shelves = this.containers.filter(function (container) { return container.type === "shelf"; });
    shelves.forEach(function (container) {
      var scope = self._shelfScope(container);
      var siblingShelves = shelves.filter(function (candidate) {
        return self._shelfScope(candidate) === scope;
      }).sort(function (left, right) {
        return centerY(left.rect) - centerY(right.rect);
      });
      var rowIndex = siblingShelves.indexOf(container);
      var previous = rowIndex > 0 ? siblingShelves[rowIndex - 1] : null;
      var next = rowIndex < siblingShelves.length - 1 ? siblingShelves[rowIndex + 1] : null;
      container.entries.forEach(function (entry, index) {
        entry.neighbors.up = previous && previous.entries.length
          ? previous.entries[Math.min(index, previous.entries.length - 1)]
          : null;
        entry.neighbors.down = next && next.entries.length
          ? next.entries[Math.min(index, next.entries.length - 1)]
          : null;
      });
    });
  };

  NavigationIndex.prototype._activeSidebarEntry = function () {
    var sidebar = null;
    this.containers.some(function (container) {
      if (container.type === "sidebar") {
        sidebar = container;
        return true;
      }
      return false;
    });
    if (!sidebar || !sidebar.entries.length) return null;
    var active = null;
    sidebar.entries.some(function (entry) {
      if (hasClass(entry.element, "is-active")) {
        active = entry;
        return true;
      }
      return false;
    });
    return active || sidebar.entries[0];
  };

  NavigationIndex.prototype._isBrowseContent = function (entry) {
    return Boolean(ancestorByClass(entry.element.parentElement, "content-body", this.root ? this.root.parentElement : null));
  };

  NavigationIndex.prototype._buildBrowseTransitions = function () {
    var self = this;
    var sidebarTarget = this._activeSidebarEntry();
    if (!sidebarTarget) return;
    var contentEntries = this.entries.filter(function (entry) { return self._isBrowseContent(entry); });
    if (!contentEntries.length) return;
    var firstContent = contentEntries.slice().sort(function (left, right) {
      return centerY(left.rect) - centerY(right.rect) || centerX(left.rect) - centerX(right.rect);
    })[0];

    this.containers.forEach(function (container) {
      if (container.type === "sidebar") {
        container.entries.forEach(function (entry) { entry.neighbors.right = firstContent; });
      }
    });
    contentEntries.forEach(function (entry) {
      var atLeftBoundary = entry.container.type === "shelf" && entry.containerIndex === 0;
      if (entry.container.type === "grid") {
        atLeftBoundary = entry.containerIndex % entry.container.columns === 0;
      }
      if (entry.container.type === "horizontal" || entry.container.type === "vertical" || entry.container.type === "dialog") {
        atLeftBoundary = entry.containerIndex === 0;
      }
      if (entry.container.type === "generic" && !entry.neighbors.left) atLeftBoundary = true;
      if (atLeftBoundary || entry.neighbors.left === sidebarTarget) entry.neighbors.left = sidebarTarget;
    });
  };

  NavigationIndex.prototype._buildDialogTransitions = function () {
    var self = this;
    var dialogs = [];
    this.entries.forEach(function (entry) {
      var dialog = ancestorByClass(entry.element, "dialog-card", self.root ? self.root.parentElement : null);
      if (dialog && dialogs.indexOf(dialog) === -1) dialogs.push(dialog);
    });
    dialogs.forEach(function (dialog) {
      var entries = self.entries.filter(function (entry) { return contains(dialog, entry.element); });
      var back = null;
      var remaining = [];
      entries.forEach(function (entry) {
        if (hasClass(entry.element, "back-button")) back = entry;
        else remaining.push(entry);
      });
      remaining.sort(function (left, right) {
        return centerY(left.rect) - centerY(right.rect) || centerX(left.rect) - centerX(right.rect);
      });
      if (back && remaining.length) {
        back.neighbors.down = remaining[0];
        back.neighbors.right = remaining[0];
        if (!remaining[0].neighbors.up || contains(dialog, remaining[0].neighbors.up.element)) {
          remaining[0].neighbors.up = back;
        }
      }
    });
  };

  NavigationIndex.prototype._buildDetailTransitions = function () {
    if (!this.root || this.root.id !== "detail-screen") return;
    var back = null;
    var play = null;
    var children = [];
    this.entries.forEach(function (entry) {
      if (hasClass(entry.element, "detail-back")) back = entry;
      else if (entry.element.id === "detail-play") play = entry;
      else if (ancestorByClass(entry.element.parentElement, "detail-children", null)) children.push(entry);
    });
    var primary = play || children[0] || null;
    if (back && primary) {
      back.neighbors.right = primary;
      back.neighbors.down = primary;
    }
    if (play && back) {
      play.neighbors.left = back;
      play.neighbors.up = back;
    }
    if (play && children.length) play.neighbors.down = children[0];
    if (children.length) {
      children[0].neighbors.left = play || back;
      var topContainer = children[0].container;
      topContainer.entries.forEach(function (entry) { entry.neighbors.up = play || back; });
    }
  };

  NavigationIndex.prototype.contains = function (element) {
    return Boolean(this.entryFor(element));
  };

  NavigationIndex.prototype.first = function (scope, preferAutofocus) {
    scope = scope || this.root;
    var candidates = this.entries.filter(function (entry) { return contains(scope, entry.element); });
    if (preferAutofocus) {
      for (var index = 0; index < candidates.length; index += 1) {
        if (candidates[index].element.getAttribute("data-autofocus") === "true") return candidates[index].element;
      }
    }
    return candidates.length ? candidates[0].element : null;
  };

  NavigationIndex.prototype.resolveFocus = function (request) {
    request = request || {};
    var scope = request.scope || this.root;
    if (request.element && this.entryFor(request.element) && contains(scope, request.element)) return request.element;
    var attributes = request.attributes || null;
    if (attributes) {
      for (var index = 0; index < this.entries.length; index += 1) {
        var entry = this.entries[index];
        if (!contains(scope, entry.element)) continue;
        var matches = true;
        Object.keys(attributes).forEach(function (name) {
          if (entry.element.getAttribute(name) !== attributes[name]) matches = false;
        });
        if (matches) return entry.element;
      }
    }
    return this.first(scope, request.preferAutofocus !== false);
  };

  NavigationIndex.prototype._effectiveRect = function (entry) {
    var rect = copyRect(entry.rect);
    if (entry.horizontalViewport) {
      var horizontalDelta = (entry.horizontalViewport.element.scrollLeft || 0) - entry.horizontalViewport.initialScroll;
      rect.left -= horizontalDelta;
      rect.right -= horizontalDelta;
    }
    if (entry.verticalViewport) {
      var verticalDelta = (entry.verticalViewport.element.scrollTop || 0) - entry.verticalViewport.initialScroll;
      rect.top -= verticalDelta;
      rect.bottom -= verticalDelta;
    }
    return rect;
  };

  NavigationIndex.prototype._entryIsVisible = function (entry) {
    var rect = this._effectiveRect(entry);
    var horizontal = entry.horizontalViewport ? entry.horizontalViewport.rect : null;
    var vertical = entry.verticalViewport ? entry.verticalViewport.rect : null;
    if (horizontal && (rect.right <= horizontal.left || rect.left >= horizontal.right)) return false;
    if (vertical && (rect.bottom <= vertical.top || rect.top >= vertical.bottom)) return false;
    return true;
  };

  NavigationIndex.prototype._loadEntryArtwork = function (entry) {
    var image = entry && entry.artwork;
    if (!image) return;
    var source = image.getAttribute(ARTWORK_ATTRIBUTE);
    if (!source) return;
    image.setAttribute("src", source);
    image.removeAttribute(ARTWORK_ATTRIBUTE);
  };

  NavigationIndex.prototype._loadArtworkAround = function (entry) {
    if (!entry || !entry.container) return;
    var entries = entry.container.entries;
    var start = Math.max(0, entry.containerIndex - this.artworkLookAhead);
    var end = Math.min(entries.length - 1, entry.containerIndex + this.artworkLookAhead);
    for (var index = start; index <= end; index += 1) this._loadEntryArtwork(entries[index]);
  };

  NavigationIndex.prototype._loadInitialArtwork = function () {
    var self = this;
    this.containers.forEach(function (container) {
      var visible = container.entries.filter(function (entry) { return self._entryIsVisible(entry); });
      if (!visible.length) return;
      var first = visible[0].containerIndex;
      var last = visible[visible.length - 1].containerIndex;
      var start = Math.max(0, first - self.artworkLookAhead);
      var end = Math.min(container.entries.length - 1, last + self.artworkLookAhead);
      for (var index = start; index <= end; index += 1) self._loadEntryArtwork(container.entries[index]);
    });
  };

  NavigationIndex.prototype._reveal = function (entry) {
    if (!entry) return;
    var margin = this.scrollMargin;
    var rect = this._effectiveRect(entry);
    if (entry.horizontalViewport) {
      var horizontal = entry.horizontalViewport;
      var horizontalDelta = 0;
      if (rect.left < horizontal.rect.left + margin) horizontalDelta = rect.left - horizontal.rect.left - margin;
      else if (rect.right > horizontal.rect.right - margin) horizontalDelta = rect.right - horizontal.rect.right + margin;
      if (horizontalDelta) horizontal.element.scrollLeft = Math.max(0, (horizontal.element.scrollLeft || 0) + horizontalDelta);
    }
    rect = this._effectiveRect(entry);
    if (entry.verticalViewport) {
      var vertical = entry.verticalViewport;
      var verticalDelta = 0;
      if (rect.top < vertical.rect.top + margin) verticalDelta = rect.top - vertical.rect.top - margin;
      else if (rect.bottom > vertical.rect.bottom - margin) verticalDelta = rect.bottom - vertical.rect.bottom + margin;
      if (verticalDelta) vertical.element.scrollTop = Math.max(0, (vertical.element.scrollTop || 0) + verticalDelta);
    }
  };

  NavigationIndex.prototype.focus = function (element) {
    var entry = this.entryFor(element);
    if (!entry) return false;
    try {
      element.focus({ preventScroll: true });
    } catch (_) {
      element.focus();
    }
    this._reveal(entry);
    this._loadArtworkAround(entry);
    if (this._isBrowseContent(entry)) this.lastContentElement = element;
    return true;
  };

  NavigationIndex.prototype.move = function (direction) {
    if (DIRECTIONS.indexOf(direction) === -1) return false;
    var active = this.document && this.document.activeElement;
    var entry = this.entryFor(active);
    if (!entry) return this.focus(this.first(this.root, true));
    var target = entry.neighbors[direction];
    if (entry.container.type === "sidebar" && direction === "right" && this.entryFor(this.lastContentElement)) {
      target = this.entryFor(this.lastContentElement);
    }
    return target ? this.focus(target.element) : false;
  };

  return {
    ARTWORK_ATTRIBUTE: ARTWORK_ATTRIBUTE,
    FOCUSABLE_SELECTOR: FOCUSABLE_SELECTOR,
    NavigationIndex: NavigationIndex,
    RepeatGate: RepeatGate
  };
}));
