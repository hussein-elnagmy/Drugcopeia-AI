/*
 * Dawaya iOS shell bridge.
 *
 * Injected into the bundled web app by scripts/sync-web.sh. It connects the
 * existing web UI to the native Capacitor plugin (text to speech, sharing,
 * appearance, downloads, reminder notifications, the Keychain-backed secure
 * store and the Offline mode switch). On a plain web server this file detects
 * that Capacitor is absent and exits without side effects.
 *
 * Privacy note: the camera and the microphone open only on an explicit tap.
 * The camera sheet decodes barcodes in-process with AVFoundation; the voice
 * sheet uses SFSpeechRecognizer. Dawaya stores neither the frame nor the audio
 * and sends neither anywhere. Product photographs are the one deliberate
 * exception to the closed list of remote hosts: pressing that button opens a
 * system browser view over the page and asks for the medicine's brand and
 * manufacturer by name, so the search engine sees the query and the reader's
 * own browser session — the same as opening the link in Safari or Chrome by
 * hand. Dawaya adds no referrer, no cookie of its own and no identifier beyond
 * the words it searched for, and Offline mode closes the button along with every
 * other remote page.
 */
(function () {
  'use strict';

  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  const PLUGIN_NAME = 'DawayaShell';
  const REMINDER_KEY = 'dawaya-reminders-v1';
  const TAKEN_KEY = 'dawaya-reminder-taken-v1';
  const MAX_REMINDERS = 20;

  function plugin() {
    try {
      return cap.Plugins && cap.Plugins[PLUGIN_NAME] ? cap.Plugins[PLUGIN_NAME] : null;
    } catch (_) {
      return null;
    }
  }

  function headerSupports(method) {
    const headers = cap.PluginHeaders;
    if (!Array.isArray(headers)) return false;
    const header = headers.find(item => item && item.name === PLUGIN_NAME);
    return Boolean(header && Array.isArray(header.methods) && header.methods.some(item => item && item.name === method));
  }

  // A plugin registered from native code after the bridge exported its
  // headers is still reachable through `Capacitor.nativePromise`, even though
  // it is missing from `PluginHeaders` and from the exported JS shim.
  function supports(method) {
    const target = plugin();
    if (target && typeof target[method] === 'function') return true;
    if (headerSupports(method)) return true;
    return typeof cap.nativePromise === 'function';
  }

  function call(method, options) {
    if (!supports(method)) return Promise.resolve(null);
    const target = plugin();
    if (target && typeof target[method] === 'function') {
      try {
        const result = target[method](options || {});
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            console.warn(`[Dawaya] Native ${method} failed`, error);
            return null;
          });
        }
        return Promise.resolve(result);
      } catch (error) {
        console.warn(`[Dawaya] Native ${method} failed`, error);
        return Promise.resolve(null);
      }
    }
    if (typeof cap.nativePromise === 'function') {
      try {
        return Promise.resolve(cap.nativePromise(PLUGIN_NAME, method, options || {})).catch(error => {
          console.warn(`[Dawaya] Native ${method} failed`, error);
          return null;
        });
      } catch (error) {
        console.warn(`[Dawaya] Native ${method} failed`, error);
        return Promise.resolve(null);
      }
    }
    return Promise.resolve(null);
  }

  document.documentElement.setAttribute('data-native-shell', 'ios');

  /* ---------- Appearance and status bar ---------- */

  let appearanceSignature = '';
  let lastLanguage = '';

  function readAppearance() {
    const root = document.documentElement;
    const preference = ['light', 'dark', 'system'].includes(root.dataset.themePreference) ? root.dataset.themePreference : 'system';
    return {
      theme: root.dataset.theme === 'dark' ? 'dark' : 'light',
      preference,
      language: String(root.lang || '').toLowerCase().startsWith('ar') ? 'ar' : 'en'
    };
  }

  function syncAppearance(force) {
    const appearance = readAppearance();
    const signature = `${appearance.theme}|${appearance.preference}|${appearance.language}`;
    const languageChanged = appearance.language !== lastLanguage;
    lastLanguage = appearance.language;
    if (!force && signature === appearanceSignature) return;
    appearanceSignature = signature;
    call('setAppearance', appearance);
    // Deferred: the reminder state below is declared later in this file, and
    // this initial call runs before those declarations are initialized.
    if (languageChanged) setTimeout(() => scheduleReminderSync(false, 250), 0);
  }

  if (window.MutationObserver) {
    new MutationObserver(() => syncAppearance(false)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-preference', 'lang', 'dir']
    });
  }
  window.addEventListener('pageshow', () => syncAppearance(false));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAppearance(false);
  });
  syncAppearance(true);

  /* ---------- Native readiness signal ---------- */

  let readySent = false;
  let readyAttempts = 0;
  let appDataSettled = false;

  // app.js emits this once the initial medicine index has loaded (or failed).
  // Waiting for it keeps the native splash up until the first screen has data.
  document.addEventListener('dawaya:dataset-updated', () => {
    appDataSettled = true;
  }, { once: true });

  function sendReady() {
    if (readySent) return;
    if (!supports('ready')) {
      readyAttempts += 1;
      if (readyAttempts <= 12) setTimeout(sendReady, 400);
      return;
    }
    readySent = true;
    syncAppearance(true);
    call('ready', {});
  }

  function scheduleReady() {
    const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      const started = Date.now();
      const waitForData = () => {
        if (appDataSettled || Date.now() - started > 6000) setTimeout(sendReady, 200);
        else setTimeout(waitForData, 120);
      };
      waitForData();
    }));
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle, { once: true });
    // Never let a stalled network fetch keep the native loading screen forever.
    setTimeout(sendReady, 15000);
  }
  scheduleReady();

  /* ---------- Speech, sharing, and generated files ---------- */

  const nativeBridge = {};

  if (supports('speak')) {
    nativeBridge.speak = function (text, lang, rate) {
      const content = String(text || '').replace(/\s+/g, ' ').trim();
      if (!content) return false;
      call('speak', {
        text: content.slice(0, 4000),
        lang: String(lang || 'en-US'),
        rate: Number(rate) || 0.95
      });
      return true;
    };
    nativeBridge.stop = function () {
      call('stopSpeaking', {});
    };
  }

  if (supports('share')) {
    nativeBridge.share = function (title, text, url) {
      return call('share', {
        title: String(title || ''),
        text: String(text || ''),
        url: String(url || '')
      }).then(result => {
        if (!result) throw new Error('Native share unavailable');
        return 'native';
      });
    };
  }

  if (supports('saveFile')) {
    nativeBridge.saveFile = function (filename, base64, mimeType) {
      return call('saveFile', {
        filename: String(filename || 'dawaya-file'),
        base64: String(base64 || ''),
        mimeType: String(mimeType || 'application/octet-stream')
      });
    };
  }

  if (supports('presentDrugDetail')) {
    nativeBridge.presentDrugDetail = function (drug) {
      if (!drug || typeof drug !== 'object') return Promise.resolve(null);
      return call('presentDrugDetail', { drug });
    };
  }

  if (supports('presentWebPage')) {
    // The name is kept for the web UI, but nothing is presented in-app any more:
    // the native layer hands a remote link to the operating system's browser and
    // refuses it entirely while Offline mode is on.
    nativeBridge.openWebPage = function (url) {
      const href = String(url || '');
      if (!/^https?:\/\//i.test(href)) return Promise.resolve(null);
      return call('presentWebPage', { url: href });
    };
  }

  if (supports('presentInAppBrowser')) {
    // Every link the reader taps — news, a reference, a source, a pack photograph — opens in
    // a system browser view over the page they came from, with a button that hands the same
    // address to the device's own browser. The native layer refuses the request while Offline
    // mode is on, exactly like the external-link path.
    nativeBridge.openInAppBrowser = function (url, language) {
      const href = String(url || '');
      if (!/^https?:\/\//i.test(href)) return Promise.resolve({ presented: false, target: 'blocked' });
      return call('presentInAppBrowser', { url: href, language: String(language || '') });
    };
  }

  if (supports('openMail')) {
    nativeBridge.openMail = function (to, subject, body) {
      // Resolves true when the draft left the app into the user's own hands:
      // either the mail app opened, or the message was copied to the clipboard
      // (the native layer tells the user which). There is no web compose
      // fallback any more — a mail.google.com URL would carry the whole message.
      return call('openMail', {
        to: String(to || ''),
        subject: String(subject || ''),
        body: String(body || '')
      }).then(result => Boolean(result && (result.opened || result.copied)));
    };
  }

  /* ---------- Keychain-backed secure storage ---------- */

  // Health content the user typed (query history, custom drugs, reminders) must
  // never sit in plaintext localStorage. The native side only accepts the keys
  // listed in privacy.config.json under storage.secureOnlyKeys and rejects any
  // other key, so a wrong call fails loudly instead of silently writing
  // plaintext.
  if (supports('secureAvailable')) {
    nativeBridge.secureAvailable = function () {
      return call('secureAvailable', {}).then(result => ({
        available: Boolean(result && result.available),
        backend: (result && result.backend) || 'ios-keychain'
      }));
    };
  }

  if (supports('secureRead')) {
    nativeBridge.secureRead = function (key) {
      return call('secureRead', { key: String(key || '') }).then(result => {
        if (!result) return null;
        return typeof result.value === 'string' ? result.value : '';
      });
    };
  }

  if (supports('secureWrite')) {
    nativeBridge.secureWrite = function (key, value) {
      return call('secureWrite', { key: String(key || ''), value: String(value || '') })
        .then(result => Boolean(result && result.stored));
    };
  }

  if (supports('secureClear')) {
    nativeBridge.secureClear = function (key) {
      return call('secureClear', { key: String(key || '') })
        .then(result => Boolean(result && result.cleared));
    };
  }

  if (supports('secureClearAll')) {
    nativeBridge.secureClearAll = function () {
      return call('secureClearAll', {}).then(result => Boolean(result && result.cleared));
    };
  }

  /* ---------- Box-code scanning and voice search ---------- */

  if (supports('scanCode')) {
    nativeBridge.scanCode = function (options) {
      return call('scanCode', { language: options && options.language === 'ar' ? 'ar' : 'en' });
    };
  }

  if (supports('readPhoto')) {
    nativeBridge.readPhoto = function (options) {
      const image = options && options.image ? String(options.image) : '';
      if (!image) return Promise.resolve({ error: 'no-image', codes: [], text: '' });
      return call('readPhoto', { image });
    };
  }

  if (supports('startVoiceSearch')) {
    nativeBridge.startVoiceSearch = function (options) {
      const language = options && options.language ? String(options.language) : 'en-US';
      return call('startVoiceSearch', { language });
    };
  }

  if (supports('stopVoiceSearch')) {
    nativeBridge.stopVoiceSearch = function () {
      return call('stopVoiceSearch', {});
    };
  }

  /* ---------- Offline mode ---------- */

  // Closes the native navigation gate for every non-bundled load. The web app
  // owns the persisted setting; the shell only needs to know which way it is set.
  if (supports('setOfflineMode')) {
    nativeBridge.setOfflineMode = function (enabled) {
      return call('setOfflineMode', { enabled: Boolean(enabled) })
        .then(result => Boolean(result && result.applied));
    };
  }

  if (Object.keys(nativeBridge).length) {
    window.DawayaNative = Object.freeze(nativeBridge);
  }

  /* ---------- Reminder notifications ---------- */

  let lastReminderSignature = '';
  let reminderSyncTimer = 0;
  let reminderRequestsPermission = false;

  /* Taken doses are keyed by local date, so "confirmed today" is exactly the
     set stored under today's key. The shells drop the 10- and 30-minute
     follow-ups for a reminder in that set and keep its daily alert, so nothing
     pings again for a dose the reader already acknowledged. */
  function takenToday() {
    try {
      const map = JSON.parse(window.localStorage.getItem(TAKEN_KEY) || '{}');
      const now = new Date();
      const pad = value => String(value).padStart(2, '0');
      const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return Array.isArray(map[key]) ? map[key].map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function collectReminders() {
    try {
      const raw = window.localStorage.getItem(REMINDER_KEY);
      if (!raw) return [];
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) return [];
      const taken = new Set(takenToday());
      return items.slice(0, MAX_REMINDERS).map(item => ({
        id: String(item && item.id || '').slice(0, 80),
        name: String(item && item.name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        dose: String(item && item.dose || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        time: String(item && item.time || '').trim(),
        taken: taken.has(String(item && item.id || ''))
      })).filter(item => item.id && item.name && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time));
    } catch (_) {
      return [];
    }
  }

  // Permission should be requested when the user actually adds a reminder,
  // never when they delete one. Compare IDs against the last known list rather
  // than treating every write to the reminders key as an opt-in.
  const knownReminderIds = new Set(collectReminders().map(item => item.id));

  function noteReminderChange() {
    const reminders = collectReminders();
    const added = reminders.some(item => !knownReminderIds.has(item.id));
    knownReminderIds.clear();
    reminders.forEach(item => knownReminderIds.add(item.id));
    scheduleReminderSync(added);
  }

  function scheduleReminderSync(requestAuthorization, delay) {
    if (!supports('syncReminders')) return;
    reminderRequestsPermission = reminderRequestsPermission || Boolean(requestAuthorization);
    if (reminderSyncTimer) clearTimeout(reminderSyncTimer);
    reminderSyncTimer = setTimeout(() => {
      reminderSyncTimer = 0;
      const reminders = collectReminders();
      const language = readAppearance().language;
      const requestAuthorizationNow = reminderRequestsPermission && reminders.length > 0;
      reminderRequestsPermission = false;
      const signature = JSON.stringify({ reminders, language, requestAuthorizationNow });
      if (signature === lastReminderSignature) return;
      lastReminderSignature = signature;
      call('syncReminders', {
        reminders,
        language,
        requestAuthorization: requestAuthorizationNow
      });
    }, Number.isFinite(delay) ? delay : 350);
  }

  try {
    const storageProto = window.Storage && window.Storage.prototype;
    const watched = key => key === REMINDER_KEY || key === TAKEN_KEY;
    if (storageProto && typeof storageProto.setItem === 'function') {
      const originalSetItem = storageProto.setItem;
      const originalRemoveItem = storageProto.removeItem;
      storageProto.setItem = function (key, value) {
        const result = originalSetItem.apply(this, arguments);
        if (watched(key) && this === window.localStorage) noteReminderChange();
        return result;
      };
      storageProto.removeItem = function (key) {
        const result = originalRemoveItem.apply(this, arguments);
        if (watched(key) && this === window.localStorage) noteReminderChange();
        return result;
      };
    }
  } catch (error) {
    console.warn('[Dawaya] Could not watch reminder changes', error);
  }

  scheduleReminderSync(false, 1200);
  /* The web view survives backgrounding, so a launch-time sync alone would keep
     yesterday's taken set alive after the reader returns the next day. */
  window.addEventListener('pageshow', () => scheduleReminderSync(false, 400));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleReminderSync(false, 400);
  });

  /* ---------- Blob/data downloads ---------- */

  function readBlobAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        const comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1) : '');
      };
      reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
      reader.readAsDataURL(blob);
    });
  }

  if (supports('saveFile')) {
    // Saves an in-app export straight to the device. The handler is restricted to
    // `blob:` and `data:` hrefs, which are already in this page's own memory: a
    // remote `http(s)` download link returns before anything is fetched, so this
    // listener can never turn a tap into a request to a third-party host.
    document.addEventListener('click', event => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[download]') : null;
      if (!anchor) return;
      const href = String(anchor.href || '');
      if (!/^(blob:|data:)/i.test(href)) return;
      event.preventDefault();
      const suggestedName = anchor.getAttribute('download') || 'dawaya-download';

      if (/^data:/i.test(href)) {
        const comma = href.indexOf(',');
        if (comma < 0) return;
        const meta = href.slice(5, comma);
        const payload = href.slice(comma + 1);
        const base64 = /;base64/i.test(meta) ? payload : '';
        if (!base64) return;
        const mimeType = meta.split(';')[0] || 'application/octet-stream';
        call('saveFile', { filename: suggestedName, base64, mimeType });
        return;
      }

      // Re-checked so the only URL this fetch can ever see is a local blob.
      if (!/^blob:/i.test(href)) return;
      fetch(href).then(response => response.blob()).then(blob => {
        return readBlobAsBase64(blob).then(base64 => {
          call('saveFile', {
            filename: suggestedName,
            base64,
            mimeType: blob.type || 'application/octet-stream'
          });
        });
      }).catch(error => {
        console.warn('[Dawaya] Could not prepare the download', error);
      });
    }, true);
  }

  /* ---------- Connectivity events from the native monitor ---------- */

  window.__dawayaConnectivityEvent = function (state) {
    const online = state === true || state === 'online';
    try {
      window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    } catch (_) {}
  };
})();
