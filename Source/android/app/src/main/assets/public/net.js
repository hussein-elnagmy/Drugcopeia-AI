(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.DawayaNet = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /*
   * The only network path in Dawaya.
   *
   * Every request goes through here. A request that is not explicitly
   * permitted by privacy.config.json (mirrored into
   * window.DAWAYA_PRIVACY_CONFIG by scripts/gen-privacy-config.py) never
   * reaches the wire. scripts/privacy-check.py fails the build if anything
   * calls fetch directly or names a host that is not allowlisted.
   *
   * Loading this file also replaces window.fetch with the gate, so a missed
   * call site is still blocked at runtime instead of quietly leaking.
   */

  var nativeFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
  var nativeRequest = typeof root.Request === 'function' ? root.Request : null;
  var OFFLINE_KEY = 'dawaya-offline-mode';
  var ALLOWED_HEADERS = { accept: 1, range: 1, 'cache-control': 1, 'content-type': 1 };
  var CACHE_CONTROL_VALUES = { 'no-cache': 1, 'no-store': 1 };
  /* The Windows assistant talks to its own loopback helper over POST with a JSON
     body, and that request needs this header. Pinned to one value so the header
     cannot carry anything else. */
  var CONTENT_TYPE_VALUES = { 'application/json': 1, 'application/json; charset=utf-8': 1 };

  function config() {
    var cfg = root.DAWAYA_PRIVACY_CONFIG;
    if (!cfg || !cfg.allowedHosts || !Array.isArray(cfg.allowedHosts)) return null;
    return cfg;
  }

  function requireConfig() {
    var cfg = config();
    if (!cfg) {
      throw PrivacyBlockedError('privacy-config-missing');
    }
    return cfg;
  }

  function storage() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }

  function PrivacyBlockedError(reason, detail) {
    var err = new Error('Privacy gate: ' + reason);
    err.name = 'PrivacyBlockedError';
    err.code = 'PRIVACY_BLOCKED';
    err.reason = reason;
    err.detail = detail || '';
    return err;
  }

  // The manual offline-mode switch was removed (r189): privacy comes from the
  // allow-list gate below, not from a toggle. Any flag a reader stored while
  // the switch existed is cleared so nobody stays blocked with no way back.
  // The bundled dataset still answers every search without a connection.
  function isOffline() {
    var cfg = config();
    var key = (cfg && cfg.offlineKey) || OFFLINE_KEY;
    var store = storage();
    if (store) {
      try { if (store.getItem(key) !== null) store.removeItem(key); } catch (_) {}
    }
    return false;
  }

  function setOffline(enabled) {
    notifyNativeOfflineMode(false);
    return false;
  }

  function notifyNativeOfflineMode(enabled) {
    var bridge = root.DawayaNative || root.windowDawayaShell || null;
    if (bridge && typeof bridge.setOfflineMode === 'function') {
      try { Promise.resolve(bridge.setOfflineMode(!!enabled)).catch(function () {}); } catch (_) {}
    }
  }

  function hostOf(url) {
    return String(url.hostname || '').toLowerCase().replace(/\.$/, '');
  }

  function hasForbiddenParam(url, rules) {
    var forbidden = rules.forbiddenUrlParameters || [];
    var keys = [];
    try { url.searchParams.forEach(function (_v, k) { keys.push(k.toLowerCase()); }); } catch (_) {}
    for (var i = 0; i < keys.length; i++) {
      if (forbidden.indexOf(keys[i]) >= 0) return keys[i];
    }
    return '';
  }

  // A host the app is known to have used for tracking-adjacent lookups stays
  // blocked even if someone adds it to allowedHosts by accident.
  function matchesOriginPattern(host, pattern) {
    var p = String(pattern).toLowerCase();
    if (p.slice(0, 2) === '*.') {
      var suffix = p.slice(1);
      return host.length > suffix.length && host.slice(-suffix.length) === suffix;
    }
    return host === p;
  }

  function bannedOrigin(url, rules) {
    var host = hostOf(url);
    var patterns = rules.bannedThirdPartyOrigins || [];
    for (var i = 0; i < patterns.length; i++) {
      if (matchesOriginPattern(host, patterns[i])) return patterns[i];
    }
    return '';
  }

  // Exact host match only. No suffix or wildcard matching: "notgithub.com"
  // must never be mistaken for a host that ends with an allowlisted name.
  function matchEntry(url, rules) {
    var host = hostOf(url);
    var entries = rules.allowedHosts || [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (String(entry.host).toLowerCase() !== host) continue;
      if (entry.localhost !== true) {
        if (url.protocol !== entry.scheme + ':') continue;
        var prefixes = entry.pathPrefixes || (entry.pathPrefix ? [entry.pathPrefix] : []);
        if (prefixes.length) {
          var under = false;
          for (var p = 0; p < prefixes.length && !under; p++) {
            if (prefixes[p] && url.pathname.indexOf(prefixes[p]) === 0) under = true;
          }
          if (!under) continue;
        }
      }
      return entry;
    }
    return null;
  }

  /*
   * check() is pure: it decides, it does not request. The native gates on
   * Android/macOS/iOS mirror the same rules, so a decision made here is the
   * decision the platform will make too.
   */
  function check(rawUrl, options) {
    var opts = options || {};
    var url;
    try { url = new URL(String(rawUrl), root.location ? root.location.href : 'http://localhost/'); }
    catch (_) { throw PrivacyBlockedError('unparseable-url'); }

    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'file:') {
      return { allowed: true, entry: null, local: true, url: url };
    }
    // Checked before the scheme test because the Capacitor shells serve the
    // bundle from capacitor://localhost and https://localhost.
    if (isBundledSameOrigin(url)) {
      return { allowed: true, entry: null, local: true, url: url };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw PrivacyBlockedError('unsupported-scheme', url.protocol);
    }

    var rules = requireConfig();
    if (bannedOrigin(url, rules)) {
      throw PrivacyBlockedError('host-banned', hostOf(url));
    }
    if (isOffline()) {
      throw PrivacyBlockedError('offline-mode');
    }
    if (url.username || url.password) {
      throw PrivacyBlockedError('url-credentials');
    }

    var entry = matchEntry(url, rules);
    if (!entry) throw PrivacyBlockedError('host-not-allowlisted', hostOf(url));

    var method = String(opts.method || 'GET').toUpperCase();
    if (Array.isArray(entry.methods) && entry.methods.indexOf(method) < 0) {
      throw PrivacyBlockedError('method-not-allowed', method);
    }
    var badParam = hasForbiddenParam(url, rules);
    if (badParam) throw PrivacyBlockedError('identifier-in-url', badParam);

    // A host that only ever answers because a person pressed a button must say
    // so; nothing may reach it on a timer. A host with userInitiatedOnly false
    // replaces that promise with a `scheduled` window written in
    // privacy.config.json, and offline mode still refuses it either way.
    if (entry.userInitiatedOnly === true && opts.userInitiated !== true) {
      throw PrivacyBlockedError('requires-user-initiation', entry.purpose || '');
    }
    return { allowed: true, entry: entry, url: url };
  }

  // Same-origin bundled assets are always fine — that is how the app loads
  // its own files, and it never leaves the device. Compared field by field:
  // custom schemes report origin "null", which must never match another host.
  function isBundledSameOrigin(url) {
    var here = root.location;
    if (!here || !here.protocol) return false;
    if (url.protocol !== here.protocol) return false;
    if (hostOf(url) !== hostOf(here)) return false;
    return String(url.port || '') === String(here.port || '');
  }

  /*
   * sanitize() strips everything that could identify a person or a device
   * before the request is built: custom headers, cookies, credentials,
   * referrer, and any header that is not on the allowlist.
   */
  function sanitize(options) {
    var rules = config() || {};
    var opts = Object.assign({}, options || {});
    var forbidden = (rules.forbiddenRequestHeaders || []).map(function (h) { return String(h).toLowerCase(); });
    var incoming = opts.headers;
    var clean = {};
    if (incoming) {
      var pairs = [];
      if (typeof incoming.forEach === 'function' && !(incoming instanceof Array)) {
        incoming.forEach(function (value, key) { pairs.push([key, value]); });
      } else if (incoming instanceof Array) {
        pairs = incoming;
      } else {
        Object.keys(incoming).forEach(function (key) { pairs.push([key, incoming[key]]); });
      }
      pairs.forEach(function (pair) {
        var key = String(pair[0]).toLowerCase();
        if (forbidden.indexOf(key) >= 0) return;
        if (!ALLOWED_HEADERS[key]) return;
        if (key === 'cache-control' && !CACHE_CONTROL_VALUES[String(pair[1]).toLowerCase()]) return;
        if (key === 'content-type' && !CONTENT_TYPE_VALUES[String(pair[1]).toLowerCase()]) return;
        clean[pair[0]] = pair[1];
      });
    }
    opts.headers = clean;
    opts.credentials = 'omit';
    opts.mode = opts.mode || 'cors';
    opts.referrer = '';
    opts.referrerPolicy = 'no-referrer';
    // redirect:'error' means an allowlisted host can never bounce us to one
    // that is not allowlisted.
    opts.redirect = 'error';
    opts.cache = opts.cache || 'default';
    return opts;
  }

  function envFetch() {
    if (nativeFetch) return nativeFetch;
    if (typeof root.fetch === 'function') return root.fetch.bind(root);
    throw PrivacyBlockedError('no-fetch-available');
  }

  function targetOf(input) {
    if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
    return input;
  }

  function request(rawUrl, options) {
    var target = targetOf(rawUrl);
    var opts = options || {};
    if (rawUrl && typeof rawUrl === 'object' && typeof rawUrl.url === 'string' && !opts.method) {
      opts = Object.assign({}, opts, { method: rawUrl.method });
    }
    var decision = check(target, opts);
    if (decision.local) {
      return envFetch()(target, sanitize(opts));
    }
    var finalUrl = decision.url.href;
    if (decision.entry && decision.entry.maxUserAgentLength) {
      // Browsers will not let us rewrite User-Agent; the native layers do, and
      // privacy-check.py asserts they stay minimal. Here we only assert that
      // we never add one ourselves.
      var headers = opts.headers || {};
      Object.keys(headers).forEach(function (key) {
        if (String(key).toLowerCase() === 'user-agent') {
          throw PrivacyBlockedError('user-agent-forbidden');
        }
      });
    }
    return envFetch()(finalUrl, sanitize(opts));
  }

  /*
   * resumeDownload() is the model and dataset path: chunked, verified, and
   * abortable. Range is the only non-trivial header it ever sends, and it
   * carries no identifier.
   */
  function resumeDownload(rawUrl, options, onProgress) {
    var opts = options || {};
    var entry = check(rawUrl, Object.assign({}, opts, { userInitiated: true })).entry;
    if (entry && entry.maxBytes && opts.expectedSize > entry.maxBytes) {
      throw PrivacyBlockedError('download-too-large', String(opts.expectedSize));
    }
    var chunk = Math.max(65536, Number(opts.chunkSizeBytes || 262144));
    var controller = new AbortController();
    var cancelled = false;
    controller.signal.addEventListener('abort', function () { cancelled = true; });
    var chunks = [];
    var received = 0;

    function pull(start) {
      if (cancelled) return Promise.resolve({ cancelled: true, bytes: received });
      var headers = { Accept: 'application/octet-stream' };
      if (start > 0) headers.Range = 'bytes=' + start + '-';
      return request(rawUrl, { method: 'GET', headers: headers, userInitiated: true })
        .then(function (response) {
          if (!response.ok && response.status !== 206) {
            throw PrivacyBlockedError('download-http-' + response.status);
          }
          if (response.status === 416 && start > 0) {
            return { done: true, bytes: received };
          }
          if (!response.body || typeof response.body.getReader !== 'function') {
            return response.arrayBuffer().then(function (buffer) {
              chunks.push(new Uint8Array(buffer));
              received += buffer.byteLength;
              if (onProgress) onProgress(received, Number(response.headers.get('x-total-size')) || 0);
              var range = response.headers.get('content-range');
              var total = range ? Number(String(range).split('/')[1]) : received;
              if (received >= total || !range) return { done: true, bytes: received };
              return pull(received);
            });
          }
          var reader = response.body.getReader();
          function read() {
            if (cancelled) return Promise.resolve({ cancelled: true });
            return reader.read().then(function (result) {
              if (result.done) return { done: true, bytes: received };
              chunks.push(result.value);
              received += result.value.byteLength;
              if (entry && entry.maxBytes && received > entry.maxBytes) {
                controller.abort();
                throw PrivacyBlockedError('download-exceeded-max-bytes');
              }
              if (onProgress) onProgress(received, 0);
              return read();
            });
          }
          return read().then(function (outcome) {
            if (outcome && outcome.done) return outcome;
            return pull(received);
          });
        });
    }

    return pull(Number(opts.resumeFrom || 0)).then(function () {
      if (cancelled) return { cancelled: true, bytes: 0 };
      var total = 0;
      chunks.forEach(function (part) { total += part.byteLength; });
      var out = new Uint8Array(total);
      var offset = 0;
      chunks.forEach(function (part) { out.set(part, offset); offset += part.byteLength; });
      return { bytes: out, received: total };
    });
  }

  /*
   * modelDownload() is the one door to the model hosts (privacy.config.json ->
   * modelDownload, mirrored onto DAWAYA_MODEL_DOWNLOAD by gen-privacy-config.py).
   * Those hosts are deliberately absent from allowedHosts: nothing reaches them
   * through request(), only through here, only when Offline mode is off and the
   * reader pressed Download, GET only, no credentials, no referrer, and no header
   * but Accept and a Range for resume. Redirects are followed by the browser:
   * huggingface.co answers with a redirect to its CDN, and the CSP connect-src
   * names both. Used by ai/wasm-bridge.js, the web/PWA runtime; the native
   * shells download in their own code under the same rules.
   */
  function modelEntry(url) {
    var model = root.DAWAYA_MODEL_DOWNLOAD;
    if (!model || !model.hosts) return null;
    var host = hostOf(url);
    for (var i = 0; i < model.hosts.length; i++) {
      var entry = model.hosts[i];
      if (entry.host && host === String(entry.host).toLowerCase()) return entry;
      if (entry.suffix) {
        var suffix = String(entry.suffix).toLowerCase();
        if (host.length > suffix.length && host.slice(-suffix.length) === suffix) return entry;
      }
    }
    return null;
  }

  function modelDownload(rawUrl, options) {
    var opts = options || {};
    var url;
    try { url = new URL(String(rawUrl), root.location ? root.location.href : 'http://localhost/'); }
    catch (_) { throw PrivacyBlockedError('unparseable-url'); }
    if (url.protocol !== 'https:') throw PrivacyBlockedError('unsupported-scheme', url.protocol);
    if (url.username || url.password) throw PrivacyBlockedError('url-credentials');
    if (isOffline()) throw PrivacyBlockedError('offline-mode');
    if (opts.userInitiated !== true) throw PrivacyBlockedError('requires-user-initiation', 'model download');
    if (!modelEntry(url)) throw PrivacyBlockedError('host-not-allowlisted', hostOf(url));
    var headers = { Accept: 'application/octet-stream' };
    if (opts.range && /^bytes=\d+-\d*$/.test(String(opts.range))) headers.Range = String(opts.range);
    return envFetch()(url.href, {
      method: 'GET',
      headers: headers,
      credentials: 'omit',
      mode: 'cors',
      referrer: '',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: opts.signal || null
    });
  }

  function sha256Hex(buffer) {
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(PrivacyBlockedError('no-subtle-crypto'));
    return root.crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
      var view = new Uint8Array(digest), hex = '';
      for (var i = 0; i < view.length; i++) hex += (view[i] < 16 ? '0' : '') + view[i].toString(16);
      return hex;
    });
  }

  function verifySha256(buffer, expectedHex) {
    if (!expectedHex) return Promise.resolve(true);
    return sha256Hex(buffer).then(function (actual) {
      return String(actual).toLowerCase() === String(expectedHex).toLowerCase();
    });
  }

  /*
   * Runtime guard. Replacing fetch means a call site that forgot to use
   * request() is still gated; blocking the other transports closes the paths
   * that could carry an identifier without ever touching fetch.
   */
  function blockedTransport(name) {
    return function () { throw PrivacyBlockedError('transport-blocked', name); };
  }

  function installGuard() {
    if (root.__dawayaFetchGuard) return root.__dawayaFetchGuard;
    var guard = function (input, init) { return request(input, init); };
    try { root.fetch = guard; } catch (_) {}
    try { root.XMLHttpRequest = blockedTransport('XMLHttpRequest'); } catch (_) {}
    try { root.WebSocket = blockedTransport('WebSocket'); } catch (_) {}
    try { root.EventSource = blockedTransport('EventSource'); } catch (_) {}
    try { root.RTCPeerConnection = blockedTransport('RTCPeerConnection'); } catch (_) {}
    try {
      if (root.navigator && typeof root.navigator.sendBeacon === 'function') {
        root.navigator.sendBeacon = blockedTransport('sendBeacon');
      }
    } catch (_) {}
    root.__dawayaFetchGuard = true;
    return true;
  }

  installGuard();

  // The native shells keep their own copy so they can block traffic before this file
  // runs. Push the persisted setting to them once the bridge is present, otherwise a
  // restart would leave the native gate on its default while the UI shows the saved one.
  if (typeof root.setTimeout === 'function') {
    root.setTimeout(function () { notifyNativeOfflineMode(isOffline()); }, 0);
  }

  return {
    OFFLINE_KEY: OFFLINE_KEY,
    PrivacyBlockedError: PrivacyBlockedError,
    isOffline: isOffline,
    setOffline: setOffline,
    check: check,
    sanitize: sanitize,
    request: request,
    resumeDownload: resumeDownload,
    modelDownload: modelDownload,
    sha256Hex: sha256Hex,
    verifySha256: verifySha256,
    installGuard: installGuard,
    allowlistedHosts: function () {
      var cfg = config();
      return cfg ? cfg.allowedHosts.map(function (entry) { return entry.host; }) : [];
    },
    summary: function () {
      var cfg = config();
      if (!cfg) return [];
      return cfg.allowedHosts.map(function (entry) {
        return { host: entry.host, purpose: entry.purpose || '', pathPrefixes: entry.pathPrefixes || [] };
      });
    }
  };
});
