(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlezyTVSubtitles = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORAGE_KEY = "plezy-tv-subtitles-v1";
  var MIN_SYNC_OFFSET_MS = -60000;
  var MAX_SYNC_OFFSET_MS = 60000;
  var SYNC_STEP_MS = 100;
  var BITMAP_CODECS = {
    pgs: true,
    pgssub: true,
    hdmv_pgs_subtitle: true,
    dvdsub: true,
    dvd_subtitle: true,
    vobsub: true,
    xsub: true,
    dvbsub: true,
    dvb_subtitle: true
  };
  var LANGUAGE_NAMES = {
    ar: "Arabic", ara: "Arabic",
    bg: "Bulgarian", bul: "Bulgarian",
    cs: "Czech", ces: "Czech", cze: "Czech",
    da: "Danish", dan: "Danish",
    de: "German", deu: "German", ger: "German",
    el: "Greek", ell: "Greek", gre: "Greek",
    en: "English", eng: "English",
    es: "Spanish", spa: "Spanish",
    fi: "Finnish", fin: "Finnish",
    fr: "French", fra: "French", fre: "French",
    he: "Hebrew", heb: "Hebrew",
    hi: "Hindi", hin: "Hindi",
    hu: "Hungarian", hun: "Hungarian",
    id: "Indonesian", ind: "Indonesian",
    it: "Italian", ita: "Italian",
    ja: "Japanese", jpn: "Japanese",
    ko: "Korean", kor: "Korean",
    nl: "Dutch", nld: "Dutch", dut: "Dutch",
    no: "Norwegian", nor: "Norwegian", nb: "Norwegian Bokmal", nob: "Norwegian Bokmal",
    pl: "Polish", pol: "Polish",
    pt: "Portuguese", por: "Portuguese",
    ro: "Romanian", ron: "Romanian", rum: "Romanian",
    ru: "Russian", rus: "Russian",
    sk: "Slovak", slk: "Slovak", slo: "Slovak",
    sv: "Swedish", swe: "Swedish",
    th: "Thai", tha: "Thai",
    tr: "Turkish", tur: "Turkish",
    uk: "Ukrainian", ukr: "Ukrainian",
    vi: "Vietnamese", vie: "Vietnamese",
    zh: "Chinese", zho: "Chinese", chi: "Chinese"
  };
  var ISO_639_3_TO_1 = {
    ara: "ar", bul: "bg", ces: "cs", cze: "cs", dan: "da", deu: "de", ger: "de",
    ell: "el", gre: "el", eng: "en", spa: "es", fin: "fi", fra: "fr", fre: "fr",
    heb: "he", hin: "hi", hun: "hu", ind: "id", ita: "it", jpn: "ja", kor: "ko",
    nld: "nl", dut: "nl", nor: "no", nob: "nb", pol: "pl", por: "pt", ron: "ro",
    rum: "ro", rus: "ru", slk: "sk", slo: "sk", swe: "sv", tha: "th", tur: "tr",
    ukr: "uk", vie: "vi", zho: "zh", chi: "zh"
  };
  var DEFAULT_APPEARANCE = {
    fontSize: 52,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineThickness: 3,
    backgroundColor: "#000000",
    backgroundOpacity: 0.55,
    bold: false,
    italic: false,
    verticalPosition: 84
  };

  function copy(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function array(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function flag(value) {
    return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
  }

  function finiteNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function integerOrNull(value) {
    if (value === "" || value === undefined || value === null) return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function canonicalLanguage(value) {
    var code = text(value).toLowerCase().replace(/_/g, "-").split("-")[0];
    return ISO_639_3_TO_1[code] || code;
  }

  function languageName(code, fallback) {
    code = text(code).toLowerCase().replace(/_/g, "-").split("-")[0];
    return text(fallback) || LANGUAGE_NAMES[code] || (code && code !== "und" ? code.toUpperCase() : "Unknown language");
  }

  function normalizeCodec(value) {
    return text(value).toLowerCase().replace(/[ -]+/g, "_");
  }

  function isBitmapSubtitle(trackOrCodec) {
    var codec = typeof trackOrCodec === "object" && trackOrCodec
      ? trackOrCodec.codec
      : trackOrCodec;
    return Boolean(BITMAP_CODECS[normalizeCodec(codec)]);
  }

  function normalizedTrack(raw, provider, fallbackIndex, defaultIndex) {
    raw = raw && typeof raw === "object" ? raw : {};
    var plex = provider === "plex";
    var rawIndex = plex ? raw.index : raw.Index;
    var index = integerOrNull(rawIndex);
    if (index === null) index = integerOrNull(fallbackIndex);
    var rawId = plex ? raw.id : (raw.Id === undefined ? raw.Index : raw.Id);
    if (rawId === undefined || rawId === null || rawId === "") rawId = index;
    var languageCode = canonicalLanguage(plex ? raw.languageCode : raw.Language);
    var language = text(plex ? raw.language : raw.DisplayLanguage);
    if (/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(language) && canonicalLanguage(language) === languageCode) language = "";
    if (!language) language = languageName(languageCode, "");
    var titleValue = plex
      ? (raw.title || raw.displayTitle)
      : (raw.Title || raw.DisplayTitle);
    var codec = normalizeCodec(plex ? (raw.codec || raw.format) : raw.Codec);
    var forced = flag(plex ? raw.forced : raw.IsForced);
    var hearingImpaired = flag(plex ? raw.hearingImpaired : raw.IsHearingImpaired);
    if (!hearingImpaired && /(?:^|\b)(?:sdh|cc|hearing impaired)(?:\b|$)/i.test(text(titleValue))) hearingImpaired = true;
    var selected = flag(plex ? raw.selected : raw.IsSelected);
    var isDefault = flag(plex ? (raw.default || raw.isDefault) : raw.IsDefault);
    if (!plex && defaultIndex !== undefined && defaultIndex !== null) {
      selected = Number(defaultIndex) === Number(index);
    } else if (!selected && isDefault) {
      selected = true;
    }
    var deliveryMethod = text(raw.DeliveryMethod).toLowerCase();
    var key = text(plex ? raw.key : raw.DeliveryUrl);
    var external = plex
      ? Boolean(key || flag(raw.external))
      : Boolean(flag(raw.IsExternal) || deliveryMethod === "external");
    var result = {
      id: text(rawId),
      index: index,
      languageCode: languageCode,
      language: language,
      title: text(titleValue),
      codec: codec,
      forced: forced,
      hearingImpaired: hearingImpaired,
      selected: selected,
      external: external
    };
    result.default = isDefault;
    result.key = key;
    result.deliveryUrl = text(raw.DeliveryUrl);
    result.sourceKey = text(raw.sourceKey);
    result.providerTitle = text(raw.providerTitle);
    result.bitmap = isBitmapSubtitle(codec);
    return result;
  }

  function plexPart(source) {
    if (!source) return {};
    if (Array.isArray(source)) return { Stream: source };
    if (source.MediaContainer) return plexPart(source.MediaContainer);
    if (source.Metadata) return plexPart(array(source.Metadata)[0]);
    if (source.Part) return array(source.Part)[0] || {};
    if (source.Media) return plexPart(array(source.Media)[0]);
    if (source.raw) return plexPart(source.raw);
    return source;
  }

  function normalizePlexSubtitleTracks(source) {
    var part = plexPart(source);
    var subtitleIndex = 0;
    return array(part.Stream || part.streams).filter(function (stream) {
      var kind = stream && (stream.streamType === undefined ? stream.StreamType : stream.streamType);
      return Number(kind) === 3 || String(kind || "").toLowerCase() === "subtitle";
    }).map(function (stream) {
      subtitleIndex += 1;
      return normalizedTrack(stream, "plex", subtitleIndex, null);
    });
  }

  function normalizePlexSubtitleTrack(raw, fallbackIndex) {
    return normalizedTrack(raw, "plex", fallbackIndex === undefined ? 1 : fallbackIndex, null);
  }

  function jellyfinSource(source) {
    if (!source) return {};
    if (Array.isArray(source)) return { MediaStreams: source };
    if (source.MediaSources) return array(source.MediaSources)[0] || {};
    if (source.raw) return jellyfinSource(source.raw);
    return source;
  }

  function normalizeJellyfinSubtitleTracks(source) {
    var mediaSource = jellyfinSource(source);
    var defaultIndex = mediaSource.DefaultSubtitleStreamIndex;
    var subtitleIndex = 0;
    return array(mediaSource.MediaStreams).filter(function (stream) {
      return text(stream && stream.Type).toLowerCase() === "subtitle";
    }).map(function (stream) {
      subtitleIndex += 1;
      return normalizedTrack(stream, "jellyfin", subtitleIndex, defaultIndex);
    });
  }

  function normalizeJellyfinSubtitleTrack(raw, fallbackIndex, defaultIndex) {
    return normalizedTrack(raw, "jellyfin", fallbackIndex === undefined ? 1 : fallbackIndex, defaultIndex);
  }

  function normalizeSubtitleTracks(provider, source) {
    return provider === "jellyfin" ? normalizeJellyfinSubtitleTracks(source) : normalizePlexSubtitleTracks(source);
  }

  var OFF_TRACK = {
    id: "off",
    index: -1,
    languageCode: "",
    language: "",
    title: "Off",
    codec: "",
    forced: false,
    hearingImpaired: false,
    selected: false,
    external: false,
    off: true
  };

  function isOffSelection(selection) {
    return selection === null || selection === false || selection === -1 || selection === "-1" ||
      selection === "off" || selection === "none" || Boolean(selection && (selection.off === true || selection.id === "off"));
  }

  function sameId(left, right) {
    return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
  }

  function semanticSelection(track) {
    if (isOffSelection(track)) return { off: true };
    track = track || {};
    return {
      off: false,
      languageCode: canonicalLanguage(track.languageCode || track.language),
      forced: Boolean(track.forced),
      hearingImpaired: Boolean(track.hearingImpaired)
    };
  }

  function matchSubtitleTrack(tracks, preference, options) {
    tracks = array(tracks);
    options = options || {};
    if (!preference || isOffSelection(preference)) return null;
    var exactId = preference.exactTrackId;
    if (exactId === undefined || exactId === null || exactId === "") exactId = preference.id;
    if (exactId !== undefined && exactId !== null && exactId !== "") {
      var exact = null;
      tracks.some(function (track) {
        if (!sameId(track.id, exactId)) return false;
        exact = track;
        return true;
      });
      if (exact) return exact;
      if (options.exactOnly) return null;
    }
    var wantedCode = canonicalLanguage(preference.languageCode || preference.language);
    if (!wantedCode) return null;
    var strict = null;
    tracks.some(function (track) {
      if (canonicalLanguage(track.languageCode || track.language) !== wantedCode) return false;
      if (Boolean(track.forced) !== Boolean(preference.forced)) return false;
      if (Boolean(track.hearingImpaired) !== Boolean(preference.hearingImpaired)) return false;
      strict = track;
      return true;
    });
    return strict;
  }

  function subtitleTrackLabel(track) {
    if (isOffSelection(track)) return "Off";
    track = track || {};
    var language = languageName(track.languageCode, track.language);
    var titleValue = text(track.title);
    var parts = [language];
    if (titleValue && titleValue.toLowerCase() !== language.toLowerCase()) parts.push(titleValue);
    if (track.forced) parts.push("Forced");
    if (track.hearingImpaired) parts.push("SDH/CC");
    if (track.external) parts.push("External");
    if (track.codec) parts.push(String(track.codec).toUpperCase());
    return parts.join(" · ");
  }

  function subtitleDeliveryFor(track) {
    if (isOffSelection(track)) return "off";
    if (isBitmapSubtitle(track)) return "burned";
    return track && track.external ? "external" : "native";
  }

  function normalizeHexColor(value, fallback) {
    var color = text(value).toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(color)) return color;
    return fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeAppearance(value) {
    value = value && typeof value === "object" ? value : {};
    return {
      fontSize: Math.round(clamp(finiteNumber(value.fontSize, DEFAULT_APPEARANCE.fontSize), 24, 96)),
      textColor: normalizeHexColor(value.textColor, DEFAULT_APPEARANCE.textColor),
      outlineColor: normalizeHexColor(value.outlineColor, DEFAULT_APPEARANCE.outlineColor),
      outlineThickness: Math.round(clamp(finiteNumber(value.outlineThickness, DEFAULT_APPEARANCE.outlineThickness), 0, 8)),
      backgroundColor: normalizeHexColor(value.backgroundColor, DEFAULT_APPEARANCE.backgroundColor),
      backgroundOpacity: Math.round(clamp(finiteNumber(value.backgroundOpacity, DEFAULT_APPEARANCE.backgroundOpacity), 0, 1) * 100) / 100,
      bold: value.bold === true,
      italic: value.italic === true,
      verticalPosition: Math.round(clamp(finiteNumber(value.verticalPosition, DEFAULT_APPEARANCE.verticalPosition), 50, 94))
    };
  }

  function clampSyncOffset(value) {
    var offset = finiteNumber(value, 0);
    offset = Math.round(offset / SYNC_STEP_MS) * SYNC_STEP_MS;
    return clamp(offset, MIN_SYNC_OFFSET_MS, MAX_SYNC_OFFSET_MS);
  }

  function emptyDocument() {
    return {
      version: 1,
      globalSelection: null,
      searchLanguage: "en",
      appearance: copy(DEFAULT_APPEARANCE),
      syncOffsetMs: 0,
      titles: {}
    };
  }

  function normalizeSavedSelection(value) {
    if (!value || typeof value !== "object") return null;
    if (value.off === true) return { off: true };
    var code = canonicalLanguage(value.languageCode || value.language);
    if (!code) return null;
    return {
      off: false,
      languageCode: code,
      forced: Boolean(value.forced),
      hearingImpaired: Boolean(value.hearingImpaired)
    };
  }

  function normalizeDocument(value) {
    var result = emptyDocument();
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    result.globalSelection = normalizeSavedSelection(value.globalSelection);
    var searchLanguage = canonicalLanguage(value.searchLanguage);
    result.searchLanguage = searchLanguage || "en";
    result.appearance = normalizeAppearance(value.appearance);
    result.syncOffsetMs = clampSyncOffset(value.syncOffsetMs);
    if (value.titles && typeof value.titles === "object" && !Array.isArray(value.titles)) {
      Object.keys(value.titles).forEach(function (key) {
        var row = value.titles[key];
        if (!row || typeof row !== "object") return;
        var selection = normalizeSavedSelection(row.selection);
        if (!selection) return;
        result.titles[key] = {
          selection: selection,
          itemId: text(row.itemId),
          exactTrackId: text(row.exactTrackId)
        };
      });
    }
    return result;
  }

  function storageOrDefault(candidate) {
    if (candidate && typeof candidate.getItem === "function") return candidate;
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (_) { /* Storage may be unavailable in a browser preview. */ }
    return null;
  }

  function contextIdentity(context) {
    return text(context && (context.identityId || context.identityKey)) || "anonymous";
  }

  function contextServer(context) {
    return text(context && (context.connectionId || context.serverKey || context.serverId || context.baseUrl)) || "server";
  }

  function seriesKey(context) {
    context = context || {};
    var item = context.item || {};
    var raw = item.raw || context.raw || {};
    if (String(item.type || context.type).toLowerCase() === "episode") {
      return text(context.seriesKey || raw.grandparentRatingKey || raw.grandparentKey || raw.SeriesId || raw.SeriesName) || text(item.id || context.itemId);
    }
    return text(context.titleKey || item.id || context.itemId || item.key);
  }

  function subtitleTitleScopeKey(context) {
    context = context || {};
    var provider = text(context.provider) || "provider";
    var type = String((context.item && context.item.type) || context.type || "item").toLowerCase();
    var scopeType = type === "episode" ? "series" : "item";
    return [contextIdentity(context), contextServer(context), provider, scopeType, seriesKey(context)].map(function (part) {
      return encodeURIComponent(part);
    }).join("|");
  }

  function SubtitlePreferenceStore(options) {
    if (options && typeof options.getItem === "function") options = { storage: options };
    options = options || {};
    this.storage = storageOrDefault(options.storage);
    this.key = options.key || STORAGE_KEY;
    this.document = emptyDocument();
    var raw = null;
    try { raw = this.storage ? this.storage.getItem(this.key) : null; } catch (_) { raw = null; }
    if (raw) {
      try { this.document = normalizeDocument(JSON.parse(raw)); } catch (_) { this.document = emptyDocument(); }
    }
  }

  SubtitlePreferenceStore.prototype._persist = function () {
    try {
      if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.document));
    } catch (_) { /* Subtitle preferences must never interrupt playback. */ }
  };

  SubtitlePreferenceStore.prototype.getAppearance = function () {
    return copy(this.document.appearance);
  };

  SubtitlePreferenceStore.prototype.setAppearance = function (changes) {
    var merged = copy(this.document.appearance) || {};
    Object.keys(changes || {}).forEach(function (key) { merged[key] = changes[key]; });
    this.document.appearance = normalizeAppearance(merged);
    this._persist();
    return this.getAppearance();
  };

  SubtitlePreferenceStore.prototype.resetAppearance = function () {
    this.document.appearance = copy(DEFAULT_APPEARANCE);
    this._persist();
    return this.getAppearance();
  };

  SubtitlePreferenceStore.prototype.getSyncOffset = function () {
    return this.document.syncOffsetMs;
  };

  SubtitlePreferenceStore.prototype.setSyncOffset = function (value) {
    this.document.syncOffsetMs = clampSyncOffset(value);
    this._persist();
    return this.document.syncOffsetMs;
  };

  SubtitlePreferenceStore.prototype.getSearchLanguage = function () {
    return this.document.searchLanguage || "en";
  };

  SubtitlePreferenceStore.prototype.setSearchLanguage = function (value) {
    var code = canonicalLanguage(value);
    this.document.searchLanguage = code || "en";
    this._persist();
    return this.document.searchLanguage;
  };

  SubtitlePreferenceStore.prototype.rememberSelection = function (context, track) {
    var semantic = semanticSelection(track);
    this.document.globalSelection = copy(semantic);
    var key = subtitleTitleScopeKey(context);
    var item = context && context.item || {};
    this.document.titles[key] = {
      selection: copy(semantic),
      itemId: text(item.id || (context && context.itemId)),
      exactTrackId: semantic.off ? "" : text(track && track.id)
    };
    this._persist();
    return copy(this.document.titles[key]);
  };

  SubtitlePreferenceStore.prototype.clearTitleSelection = function (context) {
    delete this.document.titles[subtitleTitleScopeKey(context)];
    this._persist();
  };

  SubtitlePreferenceStore.prototype.resolveSelection = function (context, tracks, serverSelection) {
    tracks = array(tracks);
    var row = this.document.titles[subtitleTitleScopeKey(context)];
    var item = context && context.item || {};
    var itemId = text(item.id || (context && context.itemId));
    if (row) {
      if (row.selection.off) return copy(OFF_TRACK);
      if (row.itemId && row.itemId === itemId && row.exactTrackId) {
        var exact = matchSubtitleTrack(tracks, { exactTrackId: row.exactTrackId }, { exactOnly: true });
        if (exact) return exact;
      }
      var titleMatch = matchSubtitleTrack(tracks, row.selection);
      if (titleMatch) return titleMatch;
    }
    var globalSelection = this.document.globalSelection;
    if (globalSelection) {
      if (globalSelection.off) return copy(OFF_TRACK);
      var globalMatch = matchSubtitleTrack(tracks, globalSelection);
      if (globalMatch) return globalMatch;
    }
    if (serverSelection !== undefined && serverSelection !== null) {
      if (isOffSelection(serverSelection)) return copy(OFF_TRACK);
      var serverMatch = matchSubtitleTrack(tracks, serverSelection);
      if (serverMatch) return serverMatch;
    }
    var selected = null;
    tracks.some(function (track) {
      if (!track.selected) return false;
      selected = track;
      return true;
    });
    if (selected) return selected;
    tracks.some(function (track) {
      if (!track.default) return false;
      selected = track;
      return true;
    });
    if (selected) return selected;
    tracks.some(function (track) {
      if (!track.forced) return false;
      selected = track;
      return true;
    });
    return selected || copy(OFF_TRACK);
  };

  SubtitlePreferenceStore.prototype.resolve = SubtitlePreferenceStore.prototype.resolveSelection;
  SubtitlePreferenceStore.prototype.remember = SubtitlePreferenceStore.prototype.rememberSelection;
  SubtitlePreferenceStore.prototype.getStyle = SubtitlePreferenceStore.prototype.getAppearance;
  SubtitlePreferenceStore.prototype.setStyle = SubtitlePreferenceStore.prototype.setAppearance;
  SubtitlePreferenceStore.prototype.resetStyle = SubtitlePreferenceStore.prototype.resetAppearance;

  function createSubtitlePreferenceStore(options) {
    return new SubtitlePreferenceStore(options);
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
        var valueCode = parseInt(code, 16);
        return valueCode > 0 && valueCode <= 0x10ffff ? String.fromCodePoint(valueCode) : "";
      })
      .replace(/&#([0-9]+);/g, function (_, code) {
        var valueCode = parseInt(code, 10);
        return valueCode > 0 && valueCode <= 0x10ffff ? String.fromCodePoint(valueCode) : "";
      });
  }

  function cleanCueSource(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .replace(/\\N/gi, "\n")
      .replace(/\\h/gi, " ")
      .replace(/\{\\[^}]*\}/g, "");
  }

  function parseCueMarkup(value) {
    var source = cleanCueSource(value);
    var runs = [];
    var state = { bold: false, italic: false, underline: false };
    var stack = [];
    var position = 0;
    var pattern = /<[^>]*>/g;
    var match;

    function append(rawText) {
      var decoded = decodeEntities(rawText);
      if (!decoded) return;
      var last = runs[runs.length - 1];
      if (last && last.bold === state.bold && last.italic === state.italic && last.underline === state.underline) {
        last.text += decoded;
      } else {
        runs.push({
          text: decoded,
          bold: state.bold,
          italic: state.italic,
          underline: state.underline
        });
      }
    }

    function openStyle(kind) {
      stack.push({ kind: kind, state: { bold: state.bold, italic: state.italic, underline: state.underline } });
      if (kind === "b") state.bold = true;
      if (kind === "i") state.italic = true;
      if (kind === "u") state.underline = true;
    }

    function closeStyle(kind) {
      for (var index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].kind !== kind) continue;
        state = stack[index].state;
        stack = stack.slice(0, index);
        return;
      }
    }

    while ((match = pattern.exec(source))) {
      append(source.slice(position, match.index));
      var token = match[0];
      var nameMatch = token.match(/^<\s*(\/?)\s*([a-z0-9]+)/i);
      if (nameMatch) {
        var closing = Boolean(nameMatch[1]);
        var name = nameMatch[2].toLowerCase();
        if (name === "br") append("\n");
        else if (name === "b" || name === "strong") closing ? closeStyle("b") : openStyle("b");
        else if (name === "i" || name === "em") closing ? closeStyle("i") : openStyle("i");
        else if (name === "u") closing ? closeStyle("u") : openStyle("u");
      }
      position = pattern.lastIndex;
    }
    append(source.slice(position));
    return runs;
  }

  function sanitizeCueText(value) {
    return parseCueMarkup(value).map(function (run) { return run.text; }).join("");
  }

  function parseCueTimestamp(value) {
    var match = String(value || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/);
    if (!match) return null;
    var hours = Number(match[1] || 0);
    var minutes = Number(match[2] || 0);
    var seconds = Number(match[3] || 0);
    var fraction = String(match[4] || "");
    while (fraction.length < 3) fraction += "0";
    if (minutes > 59 || seconds > 59) return null;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction.slice(0, 3) || 0);
  }

  function parseSrtOrVttCues(value) {
    var source = String(value === undefined || value === null ? "" : value)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
    var lines = source.split("\n");
    var cues = [];
    var index = 0;
    while (index < lines.length) {
      var line = lines[index].trim();
      if (!line || /^WEBVTT(?:\s|$)/i.test(line)) { index += 1; continue; }
      if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(line)) {
        index += 1;
        while (index < lines.length && lines[index].trim()) index += 1;
        continue;
      }
      if (line.indexOf("-->") === -1 && index + 1 < lines.length && lines[index + 1].indexOf("-->") !== -1) {
        index += 1;
        line = lines[index].trim();
      }
      if (line.indexOf("-->") === -1) { index += 1; continue; }
      var timing = line.split("-->");
      var start = parseCueTimestamp(timing[0]);
      var endToken = String(timing[1] || "").trim().split(/\s+/)[0];
      var end = parseCueTimestamp(endToken);
      index += 1;
      var cueLines = [];
      while (index < lines.length && lines[index].trim()) {
        cueLines.push(lines[index]);
        index += 1;
      }
      if (start !== null && end !== null && end >= start) {
        cues.push({ startMs: start, endMs: end, text: cueLines.join("\n") });
      }
    }
    return cues;
  }

  function parseAssTimestamp(value) {
    var match = String(value || "").trim().match(/^(\d+):(\d{1,2}):(\d{2})(?:[.](\d{1,3}))?$/);
    if (!match) return null;
    var fraction = String(match[4] || "");
    while (fraction.length < 3) fraction += "0";
    return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(fraction.slice(0, 3) || 0);
  }

  function parseAssCues(value) {
    var lines = String(value === undefined || value === null ? "" : value).replace(/\r\n?/g, "\n").split("\n");
    var fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
    var cues = [];
    lines.forEach(function (line) {
      var format = line.match(/^\s*Format\s*:\s*(.+)$/i);
      if (format) {
        fields = format[1].split(",").map(function (field) { return field.trim().toLowerCase(); });
        return;
      }
      var dialogue = line.match(/^\s*Dialogue\s*:\s*(.+)$/i);
      if (!dialogue) return;
      var values = dialogue[1].split(",");
      if (values.length < fields.length) return;
      if (values.length > fields.length) {
        values = values.slice(0, fields.length - 1).concat([values.slice(fields.length - 1).join(",")]);
      }
      var row = {};
      fields.forEach(function (field, index) { row[field] = values[index] || ""; });
      var start = parseAssTimestamp(row.start);
      var end = parseAssTimestamp(row.end);
      if (start === null || end === null || end < start) return;
      cues.push({ startMs: start, endMs: end, text: row.text || "" });
    });
    return cues;
  }

  function parseSubtitleCues(value, codec) {
    codec = normalizeCodec(codec);
    return codec === "ass" || codec === "ssa" ? parseAssCues(value) : parseSrtOrVttCues(value);
  }

  function cueTiming(startMs, endMs, offsetMs) {
    var start = finiteNumber(startMs, 0) + clampSyncOffset(offsetMs);
    var end = finiteNumber(endMs, start) + clampSyncOffset(offsetMs);
    return {
      startMs: Math.max(0, start),
      endMs: Math.max(Math.max(0, start), end)
    };
  }

  function cueIsActive(cue, positionMs, offsetMs) {
    cue = cue || {};
    var queryPosition = finiteNumber(positionMs, 0) - clampSyncOffset(offsetMs);
    var start = finiteNumber(cue.startMs, finiteNumber(cue.startTime, 0) * 1000);
    var end = finiteNumber(cue.endMs, finiteNumber(cue.endTime, start / 1000) * 1000);
    return queryPosition >= start && queryPosition < end;
  }

  function CueScheduler(options) {
    options = options || {};
    this.setTimer = options.setTimeout || setTimeout;
    this.clearTimer = options.clearTimeout || clearTimeout;
    this.timer = null;
    this.revision = 0;
  }

  CueScheduler.prototype.cancel = function () {
    this.revision += 1;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    return this.revision;
  };

  CueScheduler.prototype.showFor = function (durationMs, show, hide) {
    var revision = this.cancel();
    if (typeof show === "function") show();
    var duration = clamp(finiteNumber(durationMs, 0), 0, 120000);
    if (duration <= 0 || typeof hide !== "function") return revision;
    var self = this;
    this.timer = this.setTimer(function () {
      if (revision !== self.revision) return;
      self.timer = null;
      hide();
    }, duration);
    return revision;
  };

  CueScheduler.prototype.isCurrent = function (revision) {
    return revision === this.revision;
  };

  function playerFocusTransition(mode, direction, rowIndex) {
    mode = mode || "transport";
    rowIndex = Number(rowIndex) === 1 ? 1 : 0;
    if (mode === "transport") {
      if (direction === "down") return { mode: "row", rowIndex: rowIndex, action: "focus-row" };
      if (direction === "left") return { mode: mode, rowIndex: rowIndex, action: "seek-back" };
      if (direction === "right") return { mode: mode, rowIndex: rowIndex, action: "seek-forward" };
      return { mode: mode, rowIndex: rowIndex, action: "show-chrome" };
    }
    if (mode === "row") {
      if (direction === "up") return { mode: "transport", rowIndex: rowIndex, action: "leave-row" };
      if (direction === "left") rowIndex = Math.max(0, rowIndex - 1);
      if (direction === "right") rowIndex = Math.min(1, rowIndex + 1);
      return { mode: "row", rowIndex: rowIndex, action: "focus-row" };
    }
    return { mode: mode, rowIndex: rowIndex, action: mode === "panel" ? "move-panel" : "show-chrome" };
  }

  function hexToRgba(value, opacity) {
    var color = normalizeHexColor(value, "#000000");
    return "rgba(" + parseInt(color.slice(1, 3), 16) + "," + parseInt(color.slice(3, 5), 16) + "," +
      parseInt(color.slice(5, 7), 16) + "," + clamp(finiteNumber(opacity, 1), 0, 1) + ")";
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    MIN_SYNC_OFFSET_MS: MIN_SYNC_OFFSET_MS,
    MAX_SYNC_OFFSET_MS: MAX_SYNC_OFFSET_MS,
    SYNC_STEP_MS: SYNC_STEP_MS,
    DEFAULT_APPEARANCE: copy(DEFAULT_APPEARANCE),
    OFF_TRACK: copy(OFF_TRACK),
    SubtitlePreferenceStore: SubtitlePreferenceStore,
    PreferenceStore: SubtitlePreferenceStore,
    createSubtitlePreferenceStore: createSubtitlePreferenceStore,
    CueScheduler: CueScheduler,
    normalizeSubtitleTracks: normalizeSubtitleTracks,
    normalizePlexSubtitleTrack: normalizePlexSubtitleTrack,
    normalizePlexSubtitleTracks: normalizePlexSubtitleTracks,
    normalizePlexTracks: normalizePlexSubtitleTracks,
    normalizeJellyfinSubtitleTrack: normalizeJellyfinSubtitleTrack,
    normalizeJellyfinSubtitleTracks: normalizeJellyfinSubtitleTracks,
    normalizeJellyfinTracks: normalizeJellyfinSubtitleTracks,
    matchSubtitleTrack: matchSubtitleTrack,
    matchTrack: matchSubtitleTrack,
    subtitleTrackLabel: subtitleTrackLabel,
    labelSubtitleTrack: subtitleTrackLabel,
    trackLabel: subtitleTrackLabel,
    subtitleDeliveryFor: subtitleDeliveryFor,
    isBitmapSubtitle: isBitmapSubtitle,
    isOffSelection: isOffSelection,
    canonicalLanguage: canonicalLanguage,
    languageName: languageName,
    semanticSelection: semanticSelection,
    subtitleTitleScopeKey: subtitleTitleScopeKey,
    normalizeAppearance: normalizeAppearance,
    clampSyncOffset: clampSyncOffset,
    clampSubtitleOffset: clampSyncOffset,
    normalizeSyncOffset: clampSyncOffset,
    parseCueMarkup: parseCueMarkup,
    parseCueTimestamp: parseCueTimestamp,
    parseSubtitleCues: parseSubtitleCues,
    parseCues: parseSubtitleCues,
    sanitizeCueText: sanitizeCueText,
    sanitizeSubtitleCue: sanitizeCueText,
    cueTiming: cueTiming,
    cueIsActive: cueIsActive,
    playerFocusTransition: playerFocusTransition,
    hexToRgba: hexToRgba
  };
}));
