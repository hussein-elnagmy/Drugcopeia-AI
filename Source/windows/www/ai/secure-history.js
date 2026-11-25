(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.DawayaPrivacy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /*
   * Everything rule 4 and rule 5 demand of local data: redaction before
   * processing, encrypted at rest in the platform keystore, deletable one
   * conversation at a time or all at once, and cleared from memory when the
   * chat screen closes.
   *
   * Conversations are saved by default. The reader can turn saving off in
   * Privacy, which also erases what was already stored.
   *
   * It is deliberately a separate module from the chat pipeline so that the
   * pipeline cannot persist anything without going through here.
   */

  var HISTORY_KEY = 'dawaya-ai-chat-v1';
  var CUSTOM_DRUGS_KEY = 'dawaya-custom-drugs-v1';
  var REMINDERS_KEY = 'dawaya-reminders-v1';
  var REMINDERS_TAKEN_KEY = 'dawaya-reminder-taken-v1';
  var QUERY_HISTORY_KEY = 'dawaya-query-history';

  var MEMORY_KEY = 'dawaya-remember-queries';
  var AUTO_DELETE_KEY = 'dawaya-auto-delete-history';
  var HEALTH_KEYS = [HISTORY_KEY, QUERY_HISTORY_KEY, CUSTOM_DRUGS_KEY, REMINDERS_KEY, REMINDERS_TAKEN_KEY];

  function store() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }

  function flag(key, defaultValue) {
    var s = store();
    if (!s) return defaultValue;
    var value = null;
    try { value = s.getItem(key); } catch (_) { return defaultValue; }
    if (value === null) return defaultValue;
    return value === 'on' || value === 'true';
  }

  function setFlag(key, enabled) {
    var s = store();
    if (s) { try { s.setItem(key, enabled ? 'on' : 'off'); } catch (_) {} }
    return !!enabled;
  }

  function bridge() {
    return root.DawayaNative || root.DawayaShell || null;
  }

  function secureBackend() {
    var b = bridge();
    if (b && typeof b.secureRead === 'function' && typeof b.secureWrite === 'function' &&
        typeof b.secureAvailable === 'function') {
      return Promise.resolve(b.secureAvailable()).then(function (result) {
        if (result && (result.available === true || result.available === 'true')) {
          return { name: (result.backend || 'native-secure-store'), bridge: b };
        }
        return fallbackBackend();
      }).catch(function () { return fallbackBackend(); });
    }
    return Promise.resolve(fallbackBackend());
  }

  /*
   * Platforms with a hardware keystore (Android, iOS, macOS) encrypt with
   * AndroidKeyStore / the Keychain. Windows and the plain web build have no
   * keystore the app can reach, so a WebCrypto AES-GCM envelope is used and
   * the privacy screen states honestly that it is device-local encryption,
   * not hardware-backed. Plaintext is never an option.
   */
  var FALLBACK_BACKEND = { name: 'webcrypto-local', bridge: null };
  function fallbackBackend() { return FALLBACK_BACKEND; }

  function isHardwareBacked(name) {
    return name !== 'webcrypto-local';
  }

  var KEY_STORE_DB = 'dawaya-privacy-key';
  var KEY_STORE_OBJECT = 'keys';
  var KEY_RECORD = 'history-aes-gcm';

  function openKeyStore() {
    if (!root.indexedDB) return Promise.reject(new Error('no-indexeddb'));
    return new Promise(function (resolve, reject) {
      var request = root.indexedDB.open(KEY_STORE_DB, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(KEY_STORE_OBJECT)) {
          request.result.createObjectStore(KEY_STORE_OBJECT);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('indexeddb-unavailable')); };
    });
  }

  function getOrCreateEnvelopeKey() {
    return openKeyStore().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KEY_STORE_OBJECT, 'readwrite');
        var record = tx.objectStore(KEY_STORE_OBJECT).get(KEY_RECORD);
        record.onsuccess = function () {
          if (record.result) { resolve(record.result); return; }
          var generated = root.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          Promise.resolve(generated).then(function (key) {
            tx.objectStore(KEY_STORE_OBJECT).put(key, KEY_RECORD);
            tx.oncomplete = function () { resolve(key); };
            tx.onerror = function () { reject(tx.error || new Error('key-store-write-failed')); };
          }).catch(reject);
        };
        record.onerror = function () { reject(record.error || new Error('key-store-read-failed')); };
      });
    });
  }

  function encode(text) {
    return new TextEncoder().encode(String(text));
  }
  function decode(bytes) {
    return new TextDecoder().decode(bytes);
  }

  async function envelopeEncrypt(plaintext) {
    var key = await getOrCreateEnvelopeKey();
    var iv = root.crypto.getRandomValues(new Uint8Array(12));
    var body = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encode(plaintext));
    var merged = new Uint8Array(iv.length + body.byteLength);
    merged.set(iv, 0);
    merged.set(new Uint8Array(body), iv.length);
    return b64(merged);
  }

  async function envelopeDecrypt(cipherB64) {
    var key = await getOrCreateEnvelopeKey();
    var raw = unb64(cipherB64);
    var iv = raw.slice(0, 12), body = raw.slice(12);
    var plain = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, body);
    return decode(new Uint8Array(plain));
  }

  function b64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return root.btoa ? root.btoa(binary) : Buffer.from(bytes).toString('base64');
  }
  function unb64(text) {
    var binary = root.atob ? root.atob(text) : Buffer.from(text, 'base64').toString('binary');
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  var ENVELOPE_PREFIX = 'v1.webaesgcm.';

  /*
   * write() refuses any key that is not a health-data key, so a caller cannot
   * accidentally route settings through the encrypted store and lose them.
   */
  function assertSecureKey(key) {
    if (HEALTH_KEYS.indexOf(key) < 0) {
      var err = new Error('DawayaPrivacy: key is not allowlisted for secure storage: ' + key);
      err.code = 'SECURE_KEY_NOT_ALLOWLISTED';
      throw err;
    }
  }

  async function write(key, value) {
    assertSecureKey(key);
    var serialized = JSON.stringify(value === undefined ? null : value);
    var backend = await secureBackend();
    if (backend.bridge) {
      await backend.bridge.secureWrite({ key: key, value: serialized });
      return { stored: true, backend: backend.name, hardwareBacked: isHardwareBacked(backend.name) };
    }
    var sealed = ENVELOPE_PREFIX + await envelopeEncrypt(serialized);
    var s = store();
    if (s) { try { s.setItem(key, sealed); } catch (_) { return { stored: false, backend: 'quota' }; } }
    return { stored: true, backend: backend.name, hardwareBacked: false };
  }

  async function read(key) {
    assertSecureKey(key);
    var backend = await secureBackend();
    var raw = null;
    if (backend.bridge) {
      var result = await backend.bridge.secureRead({ key: key });
      raw = result && typeof result.value === 'string' ? result.value : null;
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    }
    var s = store();
    raw = s ? s.getItem(key) : null;
    if (!raw) return null;
    if (String(raw).indexOf(ENVELOPE_PREFIX) !== 0) {
      // Plaintext from an older build: encrypt on the way out and never keep
      // the readable copy.
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
      await migratePlaintext(key);
      return parsed;
    }
    try {
      var plain = await envelopeDecrypt(String(raw).slice(ENVELOPE_PREFIX.length));
      return JSON.parse(plain);
    } catch (_) {
      // An unreadable blob is dropped rather than kept in the clear.
      await clear(key);
      return null;
    }
  }

  async function migratePlaintext(key) {
    var s = store();
    if (!s) return false;
    var raw = s.getItem(key);
    if (!raw) return false;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { s.removeItem(key); return false; }
    var result = await write(key, parsed);
    /* The WebCrypto backend writes its envelope to this same localStorage key,
       so removing it here would delete what was just written. Only the native
       keystore backend leaves a plaintext copy behind to remove. */
    if (result && result.backend !== 'webcrypto-local') s.removeItem(key);
    return true;
  }

  async function clear(key) {
    assertSecureKey(key);
    var backend = await secureBackend();
    if (backend.bridge && typeof backend.bridge.secureClear === 'function') {
      try { await backend.bridge.secureClear({ key: key }); } catch (_) {}
    }
    var s = store();
    if (s) { try { s.removeItem(key); } catch (_) {} }
    return true;
  }

  /*
   * deleteEverything() is the "Delete all my data" button. It clears the
   * secure store, every plaintext setting, the HTTP caches, and asks the
   * native layer to remove downloaded files.
   */
  async function deleteEverything(options) {
    var opts = options || {};
    var keepUiSettings = opts.keepUiSettings === true;
    var report = { secure: [], plaintext: [], caches: [], files: false };
    var backend = await secureBackend();
    if (backend.bridge && typeof backend.bridge.secureClearAll === 'function') {
      try { await backend.bridge.secureClearAll(); report.secure.push('all'); } catch (_) {}
    }
    for (var i = 0; i < HEALTH_KEYS.length; i++) {
      await clear(HEALTH_KEYS[i]);
      report.secure.push(HEALTH_KEYS[i]);
    }
    var s = store();
    if (s) {
      var prefixKeys = [];
      for (var j = 0; j < s.length; j++) {
        var name = s.key(j);
        if (name && String(name).indexOf('dawaya-') === 0) prefixKeys.push(name);
      }
      prefixKeys.forEach(function (name) {
        if (keepUiSettings && !isHealthKey(name)) return;
        try { s.removeItem(name); report.plaintext.push(name); } catch (_) {}
      });
    }
    if (root.caches && typeof caches.keys === 'function') {
      var names = await caches.keys().catch(function () { return []; });
      await Promise.all(names.map(function (name) {
        return caches.delete(name).then(function () { report.caches.push(name); });
      })).catch(function () {});
    }
    if (backend.bridge && typeof backend.bridge.deleteAppData === 'function') {
      try { await backend.bridge.deleteAppData(); report.files = true; } catch (_) {}
    }
    sessions = [];
    currentId = null;
    loaded = false;
    loadPromise = null;
    return report;
  }

  function isHealthKey(name) { return HEALTH_KEYS.indexOf(name) >= 0; }

  /* ---------- chat history: conversations, not one flat transcript ---------- */

  var sessions = [];
  var currentId = null;
  var loaded = false;
  var loadPromise = null;

  function historyEnabled() { return flag(MEMORY_KEY, true); }
  function setHistoryEnabled(enabled) {
    var value = !!enabled;
    setFlag(MEMORY_KEY, value);
    if (!value) {
      sessions = [];
      currentId = null;
      loaded = true;
      loadPromise = null;
      /* Removed here as well as through clear(): the reader must never see a
         saved conversation after switching saving off, not even for a tick. */
      var s = store();
      if (s) { try { s.removeItem(HISTORY_KEY); } catch (_) {} }
      clear(HISTORY_KEY);
    }
    return value;
  }
  function autoDeleteEnabled() { return flag(AUTO_DELETE_KEY, false); }
  function setAutoDelete(enabled) { return setFlag(AUTO_DELETE_KEY, !!enabled); }

  function limits() {
    var cfg = root.DAWAYA_PRIVACY_CONFIG;
    return (cfg && cfg.history) || {};
  }
  function maxTurns() {
    var value = Number(limits().maxTurns);
    return Number.isFinite(value) && value > 0 ? value : 50;
  }
  function maxSessions() {
    var value = Number(limits().maxSessions);
    return Number.isFinite(value) && value > 0 ? value : 30;
  }
  /* iOS refuses a keychain item above 512 KB, so the stored snapshot is kept
     under this budget in UTF-8 bytes (Arabic is three bytes per character). */
  function maxBytes() {
    var value = Number(limits().maxBytes);
    return Number.isFinite(value) && value > 0 ? value : 400000;
  }

  function newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function titleOf(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  function normalizeTurn(turn) {
    if (!turn || typeof turn !== 'object') return null;
    var text = String(turn.text || '');
    if (!text) return null;
    return {
      role: turn.role === 'user' ? 'user' : 'assistant',
      text: text,
      at: Number(turn.at) || Date.now(),
      meta: turn.meta || null
    };
  }

  function firstUser(turns) {
    for (var i = 0; i < turns.length; i++) if (turns[i].role === 'user') return turns[i].text;
    return turns.length ? turns[0].text : '';
  }

  function byStart(left, right) { return left.startedAt - right.startedAt; }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var turns = (Array.isArray(raw.turns) ? raw.turns : []).map(normalizeTurn).filter(Boolean);
    if (!turns.length) return null;
    var startedAt = Number(raw.startedAt) || turns[0].at || Date.now();
    var updatedAt = Number(raw.updatedAt) || turns[turns.length - 1].at || startedAt;
    return {
      id: String(raw.id || newId()),
      startedAt: startedAt,
      updatedAt: updatedAt,
      title: String(raw.title || titleOf(firstUser(turns))),
      turns: turns.slice(-maxTurns())
    };
  }

  function normalizeStored(stored) {
    if (!stored) return [];
    /* Builds before 1.7.0 stored one flat array of turns under the same key. */
    if (Array.isArray(stored)) {
      var legacy = stored.map(normalizeTurn).filter(Boolean);
      if (!legacy.length) return [];
      return [{
        id: 'legacy-' + legacy[0].at,
        startedAt: legacy[0].at,
        updatedAt: legacy[legacy.length - 1].at,
        title: titleOf(firstUser(legacy)),
        turns: legacy.slice(-maxTurns())
      }];
    }
    var list = Array.isArray(stored.sessions) ? stored.sessions : [];
    return list.map(normalizeSession).filter(Boolean).sort(byStart);
  }

  function ensureLoaded() {
    if (loaded) return Promise.resolve(sessions.slice());
    if (loadPromise) return loadPromise;
    if (!historyEnabled()) {
      sessions = [];
      currentId = null;
      loaded = true;
      return Promise.resolve([]);
    }
    loadPromise = read(HISTORY_KEY).then(function (stored) {
      sessions = normalizeStored(stored);
      prune();
      currentId = sessions.length ? sessions[sessions.length - 1].id : null;
      loaded = true;
      loadPromise = null;
      return sessions.slice();
    }, function () {
      sessions = [];
      loaded = true;
      loadPromise = null;
      return [];
    });
    return loadPromise;
  }

  function find(id) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) return sessions[i];
    return null;
  }

  function currentSession() {
    var existing = currentId ? find(currentId) : null;
    if (existing) return existing;
    var now = Date.now();
    var session = { id: newId(), startedAt: now, updatedAt: now, title: '', turns: [] };
    sessions.push(session);
    currentId = session.id;
    return session;
  }

  function utf8Length(text) {
    var value = String(text);
    var bytes = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i += 1; }
      else bytes += 3;
    }
    return bytes;
  }

  function sizeOf() { return utf8Length(JSON.stringify(snapshot())); }

  function prune() {
    sessions.sort(byStart);
    var limit = maxSessions();
    while (sessions.length > limit) {
      var index = -1;
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id !== currentId && !sessions[i].turns.length) { index = i; break; }
      }
      if (index < 0) {
        for (var j = 0; j < sessions.length; j++) {
          if (sessions[j].id !== currentId) { index = j; break; }
        }
      }
      if (index < 0) break;
      sessions.splice(index, 1);
    }
    /* Keep the newest conversations inside the platform's item limit. Sessions
       go oldest-first; the active conversation only loses its oldest turns. */
    var budget = maxBytes();
    while (sessions.length > 1 && sizeOf() > budget) {
      sessions.splice(sessions[0].id === currentId ? 1 : 0, 1);
    }
    var only = sessions[0];
    while (only && only.turns.length > 4 && sizeOf() > budget) {
      only.turns.splice(0, Math.max(1, Math.ceil(only.turns.length / 4)));
      only.updatedAt = only.turns[only.turns.length - 1].at;
    }
  }

  function snapshot() {
    return {
      version: 2,
      sessions: sessions.map(function (session) {
        return {
          id: session.id,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          title: session.title,
          turns: session.turns.map(function (turn) {
            return { role: turn.role, text: turn.text, at: turn.at, meta: turn.meta };
          })
        };
      })
    };
  }

  async function persist() {
    if (!historyEnabled()) return { persisted: false, backend: 'none' };
    var result = await write(HISTORY_KEY, snapshot());
    return { persisted: result.stored, backend: result.backend, hardwareBacked: result.hardwareBacked };
  }

  /*
   * record() is the only way a turn becomes durable. With saving off, nothing
   * is kept anywhere: the chat screen holds the conversation for the length of
   * the visit and this module never sees it.
   */
  async function record(role, text, meta) {
    if (!historyEnabled()) return { persisted: false, backend: 'none' };
    await ensureLoaded();
    var body = String(text || '');
    if (!body) return { persisted: false, backend: 'none' };
    var session = currentSession();
    var turn = { role: String(role) === 'user' ? 'user' : 'assistant', text: body, at: Date.now(), meta: meta || null };
    session.turns.push(turn);
    if (session.turns.length > maxTurns()) session.turns.splice(0, session.turns.length - maxTurns());
    session.updatedAt = turn.at;
    if (turn.role === 'user' && !session.title) session.title = titleOf(turn.text);
    prune();
    return persist();
  }

  /* The turns of the active conversation, so the chat screen can show them. */
  async function load() {
    await ensureLoaded();
    var session = currentId ? find(currentId) : null;
    return session ? session.turns.slice() : [];
  }

  async function listSessions() {
    await ensureLoaded();
    if (!historyEnabled()) return [];
    return sessions
      .filter(function (session) { return session.turns.length > 0; })
      .slice()
      .sort(function (left, right) { return right.updatedAt - left.updatedAt; })
      .map(function (session) {
        return {
          id: session.id,
          title: session.title || titleOf(firstUser(session.turns)),
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          messages: session.turns.length
        };
      });
  }

  async function loadSession(id) {
    await ensureLoaded();
    var session = find(String(id));
    if (!session) return null;
    currentId = session.id;
    return session.turns.slice();
  }

  async function deleteSession(id) {
    await ensureLoaded();
    var target = String(id);
    var wasCurrent = currentId === target;
    var before = sessions.length;
    sessions = sessions.filter(function (session) { return session.id !== target; });
    if (wasCurrent) currentId = null;
    var deleted = sessions.length !== before;
    if (deleted) await persist();
    return { deleted: deleted, wasCurrent: wasCurrent };
  }

  async function beginNewSession() {
    await ensureLoaded();
    sessions = sessions.filter(function (session) { return session.turns.length > 0; });
    currentId = null;
    return currentId;
  }

  function context() {
    var session = currentId ? find(currentId) : null;
    return session ? session.turns.slice() : [];
  }

  /*
   * close() is called when the chat screen is dismissed. The conversation is
   * gone from memory either way; whether it survives on disk depends only on
   * the reader's own setting.
   */
  async function close() {
    var count = sessions.reduce(function (total, session) { return total + session.turns.length; }, 0);
    sessions = [];
    currentId = null;
    loaded = false;
    loadPromise = null;
    if (autoDeleteEnabled()) {
      await clear(HISTORY_KEY);
      return { wiped: true, turns: count };
    }
    return { wiped: false, turns: count };
  }

  async function clearHistory() {
    sessions = [];
    currentId = null;
    loaded = true;
    loadPromise = null;
    await clear(HISTORY_KEY);
    return true;
  }

  /* ---------- input guard ---------- */

  /*
   * Rule 5: the app must never ask who you are, and anything that looks like
   * an identifier is removed before the assistant sees the message. This runs
   * in the input path, not at save time, so the raw text is never persisted,
   * logged, or handed to the model.
   */
  var PATTERNS = [
    { kind: 'email', re: /[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, label: 'بريد إلكتروني', labelEn: 'email address' },
    // Egyptian national ID: 14 digits, starting with 2/3, with the date block embedded.
    { kind: 'national-id', re: /\b[23]\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{5}[\s-]?\d?\b/g, label: 'رقم قومي', labelEn: 'national ID' },
    { kind: 'phone', re: /(?:\+?\d{1,3}[\s-]?)?(?:0\d{1,2}[\s-]?)?\d{3}[\s-]?\d{3,4}\b(?!\s*(?:mg|mcg|ml|kg|days?|ساعات?|يوم|أيام))/gi, label: 'رقم هاتف', labelEn: 'phone number' },
    { kind: 'passport', re: /\b[A-Za-z]{1,2}\s?\d{6,9}\b/g, label: 'رقم جواز أو رقم توثيق', labelEn: 'passport or serial number' }
  ];

  var PLACEHOLDERS = {
    email: '[بريد محذوف]', 'national-id': '[رقم قومي محذوف]', phone: '[رقم هاتف محذوف]', passport: '[رقم محذوف]'
  };
  var PLACEHOLDERS_EN = {
    email: '[email removed]', 'national-id': '[national ID removed]', phone: '[phone removed]', passport: '[number removed]'
  };

  function redact(text, language) {
    var source = String(text || '');
    var found = [];
    var out = source;
    PATTERNS.forEach(function (pattern) {
      var matched = out.match(pattern.re);
      if (!matched || !matched.length) return;
      found.push(pattern.kind);
      var placeholder = (language === 'ar' ? PLACEHOLDERS : PLACEHOLDERS_EN)[pattern.kind];
      out = out.replace(pattern.re, function (hit) {
        // Dosages and prices are digits too. Only replace when the hit really
        // looks like an identifier: long digit runs, or an @, or a + prefix.
        if (pattern.kind === 'phone' && /^[\d\s-]{5,8}$/.test(hit.trim())) return hit;
        return placeholder;
      });
    });
    return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), removed: found, changed: out !== source };
  }

  function warning(found, language) {
    if (!found || !found.length) return '';
    var names = PATTERNS.filter(function (p) { return found.indexOf(p.kind) >= 0; });
    var list = language === 'ar'
      ? names.map(function (p) { return p.label; }).join('، ')
      : names.map(function (p) { return p.labelEn; }).join(', ');
    return language === 'ar'
      ? 'لأسباب خصوصية، حذف Dawaya تلقائيًا ما يشبه ' + list + ' قبل معالجة رسالتك. لا تكتب بياناتك الشخصية في المحادثة.'
      : 'For privacy, Dawaya automatically removed what looks like ' + list + ' before processing your message. Please do not type personal details into the chat.';
  }

  return {
    KEYS: {
      history: HISTORY_KEY, queries: QUERY_HISTORY_KEY, customDrugs: CUSTOM_DRUGS_KEY,
      reminders: REMINDERS_KEY, remindersTaken: REMINDERS_TAKEN_KEY,
      memoryFlag: MEMORY_KEY, autoDeleteFlag: AUTO_DELETE_KEY
    },
    secureBackend: secureBackend,
    isHardwareBacked: isHardwareBacked,
    write: write,
    read: read,
    clear: clear,
    migratePlaintext: migratePlaintext,
    deleteEverything: deleteEverything,
    historyEnabled: historyEnabled,
    setHistoryEnabled: setHistoryEnabled,
    autoDeleteEnabled: autoDeleteEnabled,
    setAutoDelete: setAutoDelete,
    record: record,
    load: load,
    listSessions: listSessions,
    loadSession: loadSession,
    deleteSession: deleteSession,
    beginNewSession: beginNewSession,
    context: context,
    close: close,
    clearHistory: clearHistory,
    redact: redact,
    warning: warning,
    patterns: PATTERNS
  };
});
