"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var Navigation = require("../js/navigation.js");

function rect(left, top, width, height) {
  return {
    left: left,
    top: top,
    right: left + width,
    bottom: top + height,
    width: width,
    height: height
  };
}

function FakeDocument() {
  this.activeElement = null;
  this.geometryReads = 0;
  this.selectorReads = 0;
  this.scrollIntoViewCalls = 0;
}

function FakeElement(document, options) {
  options = options || {};
  this.ownerDocument = document;
  this.id = options.id || "";
  this.parentElement = null;
  this.children = [];
  this.attributes = {};
  this.disabled = Boolean(options.disabled);
  this.offsetParent = options.visible === false ? null : {};
  this.scrollLeft = 0;
  this.scrollTop = 0;
  this._rect = options.rect || rect(0, 0, 100, 60);
  this._classes = (options.classes || []).slice();
  this.lastFocusOptions = null;
  if (options.focusable) this.attributes["data-focusable"] = "true";
  Object.keys(options.attributes || {}).forEach(function (name) {
    this.attributes[name] = String(options.attributes[name]);
  }, this);
  this.classList = {
    contains: function (name) { return this._classes.indexOf(name) !== -1; }.bind(this)
  };
}

FakeElement.prototype.append = function (child) {
  child.parentElement = this;
  this.children.push(child);
  return child;
};

FakeElement.prototype.contains = function (candidate) {
  if (candidate === this) return true;
  return this.children.some(function (child) { return child.contains(candidate); });
};

FakeElement.prototype.getBoundingClientRect = function () {
  this.ownerDocument.geometryReads += 1;
  return this._rect;
};

FakeElement.prototype.getAttribute = function (name) {
  if (name === "disabled" && this.disabled) return "";
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};

FakeElement.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
};

FakeElement.prototype.removeAttribute = function (name) {
  delete this.attributes[name];
};

FakeElement.prototype.focus = function (options) {
  this.lastFocusOptions = options;
  this.ownerDocument.activeElement = this;
};

FakeElement.prototype.scrollIntoView = function () {
  this.ownerDocument.scrollIntoViewCalls += 1;
};

FakeElement.prototype._descendants = function () {
  var result = [];
  this.children.forEach(function (child) {
    result.push(child);
    result = result.concat(child._descendants());
  });
  return result;
};

FakeElement.prototype.querySelectorAll = function (selector) {
  this.ownerDocument.selectorReads += 1;
  if (selector !== Navigation.FOCUSABLE_SELECTOR) throw new Error("Unexpected selector: " + selector);
  return this._descendants().filter(function (element) {
    return element.getAttribute("data-focusable") === "true" && !element.disabled;
  });
};

FakeElement.prototype.querySelector = function (selector) {
  if (selector !== "img[" + Navigation.ARTWORK_ATTRIBUTE + "]") {
    throw new Error("Unexpected selector: " + selector);
  }
  return this._descendants().filter(function (element) {
    return element.getAttribute(Navigation.ARTWORK_ATTRIBUTE) !== null;
  })[0] || null;
};

function element(document, parent, options) {
  var created = new FakeElement(document, options);
  if (parent) parent.append(created);
  return created;
}

function focusable(document, parent, left, top, attributes, classes) {
  return element(document, parent, {
    focusable: true,
    attributes: attributes,
    classes: classes,
    rect: rect(left, top, 100, 80)
  });
}

function browseWithShelves() {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", classes: ["screen"], rect: rect(0, 0, 1000, 800) });
  var nav = element(document, root, { id: "nav-list", rect: rect(0, 100, 180, 500) });
  var navHome = focusable(document, nav, 20, 160, { "data-route": "home" }, ["nav-item", "is-active"]);
  var navLibraries = focusable(document, nav, 20, 260, { "data-route": "libraries" }, ["nav-item"]);
  var content = element(document, root, { classes: ["content-body"], rect: rect(200, 100, 760, 650) });
  var firstRow = element(document, content, { classes: ["card-row"], rect: rect(220, 150, 600, 240) });
  var firstCards = [
    focusable(document, firstRow, 230, 180, { "data-item": "a" }, ["media-card"]),
    focusable(document, firstRow, 350, 180, { "data-item": "b" }, ["media-card"]),
    focusable(document, firstRow, 470, 180, { "data-item": "c" }, ["media-card"])
  ];
  var secondRow = element(document, content, { classes: ["card-row"], rect: rect(220, 440, 600, 240) });
  var secondCards = [
    focusable(document, secondRow, 230, 470, { "data-item": "d" }, ["media-card"]),
    focusable(document, secondRow, 350, 470, { "data-item": "e" }, ["media-card"])
  ];
  return {
    document: document,
    root: root,
    navHome: navHome,
    navLibraries: navLibraries,
    firstCards: firstCards,
    secondCards: secondCards,
    firstRow: firstRow
  };
}

test("shelves, sidebar transitions, and boundaries use cached neighbors", function () {
  var fixture = browseWithShelves();
  var index = new Navigation.NavigationIndex({ document: fixture.document });
  index.refresh(fixture.root);
  var readsAfterRefresh = fixture.document.geometryReads;
  var selectorsAfterRefresh = fixture.document.selectorReads;

  fixture.navHome.focus();
  assert.equal(index.move("right"), true);
  assert.equal(fixture.document.activeElement, fixture.firstCards[0]);
  assert.equal(index.move("right"), true);
  assert.equal(fixture.document.activeElement, fixture.firstCards[1]);
  assert.equal(index.move("down"), true);
  assert.equal(fixture.document.activeElement, fixture.secondCards[1]);
  assert.equal(index.move("left"), true);
  assert.equal(fixture.document.activeElement, fixture.secondCards[0]);
  assert.equal(index.move("left"), true);
  assert.equal(fixture.document.activeElement, fixture.navHome);
  assert.equal(index.move("right"), true, "sidebar restores the last content focus");
  assert.equal(fixture.document.activeElement, fixture.secondCards[0]);

  fixture.firstCards[2].focus();
  assert.equal(index.move("right"), false);
  assert.equal(fixture.document.activeElement, fixture.firstCards[2]);
  assert.equal(fixture.document.geometryReads, readsAfterRefresh, "ordinary moves perform no geometry reads");
  assert.equal(fixture.document.selectorReads, selectorsAfterRefresh, "ordinary moves perform no selector scans");
  assert.equal(fixture.document.scrollIntoViewCalls, 0);
  assert.deepEqual(fixture.firstCards[0].lastFocusOptions, { preventScroll: true });
});

test("six-column grids navigate by row and preserve right/down boundaries", function () {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", rect: rect(0, 0, 1200, 900) });
  var nav = element(document, root, { id: "nav-list", rect: rect(0, 100, 180, 600) });
  var navItem = focusable(document, nav, 20, 200, { "data-route": "libraries" }, ["nav-item", "is-active"]);
  var content = element(document, root, { classes: ["content-body"], rect: rect(200, 100, 950, 750) });
  var grid = element(document, content, { classes: ["library-grid"], rect: rect(220, 140, 900, 650) });
  var cards = [];
  for (var cardIndex = 0; cardIndex < 14; cardIndex += 1) {
    cards.push(focusable(
      document,
      grid,
      230 + (cardIndex % 6) * 140,
      160 + Math.floor(cardIndex / 6) * 180,
      { "data-item": String(cardIndex) },
      ["media-card"]
    ));
  }
  var index = new Navigation.NavigationIndex({ document: document });
  index.refresh(root);

  cards[0].focus();
  assert.equal(index.move("down"), true);
  assert.equal(document.activeElement, cards[6]);
  assert.equal(index.move("down"), true);
  assert.equal(document.activeElement, cards[12]);
  assert.equal(index.move("down"), false);
  assert.equal(document.activeElement, cards[12]);
  cards[5].focus();
  assert.equal(index.move("right"), false);
  assert.equal(document.activeElement, cards[5]);
  cards[6].focus();
  assert.equal(index.move("left"), true);
  assert.equal(document.activeElement, navItem);
});

test("left edge of a search form transitions to the active sidebar route", function () {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", rect: rect(0, 0, 1000, 700) });
  var nav = element(document, root, { id: "nav-list", rect: rect(0, 100, 180, 500) });
  var searchRoute = focusable(document, nav, 20, 250, { "data-route": "search" }, ["nav-item", "is-active"]);
  var content = element(document, root, { classes: ["content-body"], rect: rect(200, 100, 750, 550) });
  var form = element(document, content, { classes: ["search-box"], rect: rect(230, 170, 650, 90) });
  var input = focusable(document, form, 240, 180, { id: "search-input" }, []);
  var submit = focusable(document, form, 700, 180, { id: "search-submit" }, ["button"]);
  var index = new Navigation.NavigationIndex({ document: document });
  index.refresh(root);

  input.focus();
  assert.equal(index.move("left"), true);
  assert.equal(document.activeElement, searchRoute);
  assert.equal(index.move("right"), true);
  assert.equal(document.activeElement, input);
  assert.equal(index.move("right"), true);
  assert.equal(document.activeElement, submit);
});

test("dialog and detail transitions are explicit", function () {
  var document = new FakeDocument();
  var dialogScreen = element(document, null, { id: "jellyfin-login-screen", rect: rect(0, 0, 1000, 800) });
  var dialog = element(document, dialogScreen, { classes: ["dialog-card"], rect: rect(200, 80, 600, 650) });
  var back = focusable(document, dialog, 230, 110, { "data-action": "back" }, ["back-button"]);
  var url = focusable(document, dialog, 300, 250, { id: "url" }, []);
  var user = focusable(document, dialog, 300, 360, { id: "user" }, []);
  var submit = focusable(document, dialog, 300, 500, { id: "submit" }, ["button"]);
  var dialogIndex = new Navigation.NavigationIndex({ document: document });
  dialogIndex.refresh(dialogScreen);
  back.focus();
  dialogIndex.move("down");
  assert.equal(document.activeElement, url);
  dialogIndex.move("down");
  assert.equal(document.activeElement, user);
  dialogIndex.move("down");
  assert.equal(document.activeElement, submit);

  document = new FakeDocument();
  var detail = element(document, null, { id: "detail-screen", classes: ["detail-screen"], rect: rect(0, 0, 1200, 800) });
  var detailBack = focusable(document, detail, 40, 40, { "data-action": "back" }, ["detail-back"]);
  detailBack.offsetParent = null; // Fixed-position controls report no offsetParent in Chromium.
  var actions = element(document, detail, { classes: ["detail-actions"], rect: rect(100, 300, 300, 100) });
  var play = focusable(document, actions, 110, 310, { "data-autofocus": "true" }, ["button"]);
  play.id = "detail-play";
  var children = element(document, detail, { classes: ["detail-children"], rect: rect(90, 480, 900, 260) });
  var row = element(document, children, { classes: ["card-row"], rect: rect(100, 500, 800, 220) });
  var child = focusable(document, row, 110, 520, { "data-item": "episode" }, ["media-card"]);
  var detailIndex = new Navigation.NavigationIndex({ document: document });
  detailIndex.refresh(detail);
  detailBack.focus();
  detailIndex.move("down");
  assert.equal(document.activeElement, play);
  detailIndex.move("down");
  assert.equal(document.activeElement, child);
  detailIndex.move("up");
  assert.equal(document.activeElement, play);
  detailIndex.move("left");
  assert.equal(document.activeElement, detailBack);
});

test("focus restoration resolves item and action attributes after a refresh", function () {
  var fixture = browseWithShelves();
  var index = new Navigation.NavigationIndex({ document: fixture.document });
  index.refresh(fixture.root);
  var restored = index.resolveFocus({
    scope: fixture.root,
    attributes: { "data-item": "e" },
    preferAutofocus: false
  });
  assert.equal(restored, fixture.secondCards[1]);
  assert.equal(index.focus(restored), true);
  assert.equal(fixture.document.activeElement, fixture.secondCards[1]);
});

test("conditional scrolling only changes a viewport when the target is outside it", function () {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", rect: rect(0, 0, 700, 500) });
  var content = element(document, root, { classes: ["content-body"], rect: rect(180, 50, 480, 400) });
  var row = element(document, content, { classes: ["card-row"], rect: rect(200, 100, 300, 220) });
  var cards = [];
  for (var cardIndex = 0; cardIndex < 5; cardIndex += 1) {
    cards.push(focusable(document, row, 210 + cardIndex * 110, 120, { "data-item": String(cardIndex) }, ["media-card"]));
  }
  var index = new Navigation.NavigationIndex({ document: document, scrollMargin: 10 });
  index.refresh(root);
  cards[0].focus();
  index.move("right");
  assert.equal(row.scrollLeft, 0, "fully visible card does not trigger scrolling");
  index.move("right");
  assert.ok(row.scrollLeft > 0, "offscreen edge scrolls immediately into the cached viewport");
  assert.equal(document.scrollIntoViewCalls, 0);
});

test("artwork loads for visible cards and advances by a bounded look-ahead window", function () {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", rect: rect(0, 0, 800, 500) });
  var content = element(document, root, { classes: ["content-body"], rect: rect(0, 0, 700, 450) });
  var row = element(document, content, { classes: ["card-row"], rect: rect(0, 80, 250, 220) });
  var cards = [];
  var images = [];
  for (var cardIndex = 0; cardIndex < 10; cardIndex += 1) {
    var card = focusable(document, row, cardIndex * 110, 100, { "data-item": String(cardIndex) }, ["media-card"]);
    cards.push(card);
    images.push(element(document, card, {
      attributes: { "data-artwork-src": "https://images.test/" + cardIndex + ".jpg" },
      rect: rect(cardIndex * 110, 100, 100, 80)
    }));
  }
  var index = new Navigation.NavigationIndex({ document: document, artworkLookAhead: 2 });
  index.refresh(root);
  assert.equal(images[0].getAttribute("src"), "https://images.test/0.jpg");
  assert.equal(images[4].getAttribute("src"), "https://images.test/4.jpg");
  assert.equal(images[5].getAttribute("src"), null, "far artwork remains dormant");

  index.focus(cards[3]);
  assert.equal(images[5].getAttribute("src"), "https://images.test/5.jpg");
  assert.equal(images[6].getAttribute("src"), null);
  index.move("right");
  assert.equal(images[6].getAttribute("src"), "https://images.test/6.jpg");
});

test("repeat gate never drops initial presses and only limits a held key", function () {
  var now = 0;
  var gate = new Navigation.RepeatGate(85, function () { return now; });
  for (var press = 0; press < 10; press += 1) {
    assert.deepEqual(gate.accept(39, false), { accepted: true, repeat: false });
    gate.release(39);
    now += 20;
  }

  assert.deepEqual(gate.accept(37, false), { accepted: true, repeat: false });
  now += 10;
  assert.deepEqual(gate.accept(37, false), { accepted: true, repeat: false }, "native non-repeat keydowns stay initial");

  assert.deepEqual(gate.accept(40, false), { accepted: true, repeat: false });
  now += 40;
  assert.deepEqual(gate.accept(40, true), { accepted: false, repeat: true });
  now += 45;
  assert.deepEqual(gate.accept(40, true), { accepted: true, repeat: true });
  gate.release(40);
  now += 1;
  assert.deepEqual(gate.accept(40, false), { accepted: true, repeat: false });

  gate.releaseAll();
  assert.deepEqual(gate.accept(38), { accepted: true, repeat: false });
  now += 20;
  assert.deepEqual(gate.accept(38), { accepted: false, repeat: true }, "engines without event.repeat use keyup state");
});

test("ten normal-speed initial presses produce ten valid focus moves", function () {
  var document = new FakeDocument();
  var root = element(document, null, { id: "browse-screen", rect: rect(0, 0, 1600, 500) });
  var content = element(document, root, { classes: ["content-body"], rect: rect(0, 0, 1500, 450) });
  var row = element(document, content, { classes: ["card-row"], rect: rect(0, 80, 1400, 250) });
  var cards = [];
  for (var cardIndex = 0; cardIndex < 11; cardIndex += 1) {
    cards.push(focusable(document, row, 10 + cardIndex * 120, 100, { "data-item": String(cardIndex) }, ["media-card"]));
  }
  var index = new Navigation.NavigationIndex({ document: document });
  var gate = new Navigation.RepeatGate(85);
  index.refresh(root);
  cards[0].focus();
  for (var press = 0; press < 10; press += 1) {
    assert.equal(gate.accept(39, false).accepted, true);
    assert.equal(index.move("right"), true);
    gate.release(39);
  }
  assert.equal(document.activeElement, cards[10]);
});
