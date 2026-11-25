/*
 * Drugcopeia core — framework-free state, device adapters, and scheduling.
 *
 * Native shells expose a bridge before this file runs:
 *   iOS (WKWebView): window.webkit.messageHandlers.dawayaSpeech.postMessage({action,text,lang,rate})
 *                    window.webkit.messageHandlers.dawayaShare.postMessage({title,text,url})
 *   Android:         window.DawayaAndroid.speak(text,lang,rate) / stop()
 *                    window.DawayaAndroid.share(title,text,url)
 *   Native shells should call DawayaCore.speech.notify('end') when playback finishes.
 * Browsers fall back to SpeechSynthesis, Web Share, then clipboard.
 */
(function (global) {
  'use strict';

  const KEYS = {
    theme: 'dawaya-theme',
    typeScale: 'dawaya-type-scale',
    reminders: 'dawaya-reminders-v1',
    reminderTaken: 'dawaya-reminder-taken-v1'
  };
  const TYPE_STEPS = [0.9, 1, 1.1, 1.2, 1.3];
  const REMINDER_LIMIT = 20;
  const DUE_BEFORE = 15;
  const OVERDUE_AFTER = 60;

  const storage = {
    get(key, fallback = null) {
      try {
        const value = global.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        global.localStorage.setItem(key, String(value));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try {
        global.localStorage.removeItem(key);
      } catch (_) {}
    },
    json(key, fallback) {
      try {
        const raw = this.get(key, null);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    }
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseTime(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function minutesToTime(minutes) {
    const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
  }

  function defaultReminderTime(now = new Date()) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    return minutesToTime(Math.ceil((minutes + 30) / 15) * 15);
  }

  function minutesNow(date = new Date()) {
    return date.getHours() * 60 + date.getMinutes();
  }

  /* ---------- Platform and capability adapters ---------- */

  const nativeBridge = (() => {
    const native = global.DawayaNative || global.DawayaAndroid || null;
    const handlers = global.webkit && global.webkit.messageHandlers ? global.webkit.messageHandlers : null;
    return {
      speech: Boolean(native && typeof native.speak === 'function') || Boolean(handlers && handlers.dawayaSpeech),
      share: Boolean(native && typeof native.share === 'function') || Boolean(handlers && handlers.dawayaShare),
      speak(text, lang, rate) {
        try {
          if (native && typeof native.speak === 'function') {
            return native.speak(text, lang, rate) !== false;
          }
          if (handlers && handlers.dawayaSpeech) {
            handlers.dawayaSpeech.postMessage({ action: 'speak', text, lang, rate });
            return true;
          }
        } catch (error) {
          console.warn('Native speech bridge failed:', error);
        }
        return false;
      },
      stop() {
        try {
          if (native && typeof native.stop === 'function') native.stop();
          else if (handlers && handlers.dawayaSpeech) handlers.dawayaSpeech.postMessage({ action: 'stop' });
        } catch (error) {
          console.warn('Native speech stop failed:', error);
        }
      },
      share(data) {
        try {
          if (native && typeof native.share === 'function') return Promise.resolve(native.share(data.title, data.text, data.url));
          if (handlers && handlers.dawayaShare) {
            handlers.dawayaShare.postMessage(data);
            return Promise.resolve(true);
          }
        } catch (error) {
          console.warn('Native share bridge failed:', error);
        }
        return Promise.reject(new Error('Native share unavailable'));
      }
    };
  })();

  const userAgent = global.navigator ? global.navigator.userAgent : '';
  const touchMac = global.navigator && global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1;
  const platform = {
    kind: /iPad|iPhone|iPod/.test(userAgent) || touchMac ? 'ios'
      : /Android/i.test(userAgent) ? 'android'
        : 'desktop',
    native: nativeBridge.speech || nativeBridge.share,
    hasHover: Boolean(global.matchMedia && global.matchMedia('(hover:hover) and (pointer:fine)').matches),
    standalone: Boolean((global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || global.navigator.standalone),
    share: async ({ title = '', text = '', url = '' } = {}) => {
      const data = { title: String(title), text: String(text), url: String(url) };
      if (nativeBridge.share) {
        try {
          await nativeBridge.share(data);
          return 'native';
        } catch (_) {}
      }
      if (global.navigator && typeof global.navigator.share === 'function') {
        try {
          await global.navigator.share(data);
          return 'web';
        } catch (error) {
          if (error && error.name === 'AbortError') return 'cancelled';
        }
      }
      const fallbackText = [data.text, data.url].filter(Boolean).join('\n');
      try {
        await global.navigator.clipboard.writeText(fallbackText);
        return 'clipboard';
      } catch (_) {
        try {
          const field = global.document.createElement('textarea');
          field.value = fallbackText;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          global.document.body.append(field);
          field.select();
          const copied = global.document.execCommand('copy');
          field.remove();
          return copied ? 'clipboard' : 'failed';
        } catch (_) {
          return 'failed';
        }
      }
    }
  };

  function syncPlatformAttributes() {
    if (!global.document) return;
    const root = global.document.documentElement;
    root.dataset.platform = platform.kind;
    root.dataset.input = platform.hasHover ? 'pointer' : 'touch';
    root.dataset.native = String(platform.native);
    root.dataset.standalone = String(platform.standalone);
  }

  /* ---------- Theme controller ---------- */

  function createThemeController() {
    const media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
    const subscribers = new Set();
    const stored = storage.get(KEYS.theme, 'system');
    let preference = ['light', 'dark', 'system'].includes(stored) ? stored : 'system';

    const isDark = () => preference === 'dark' || (preference === 'system' && Boolean(media && media.matches));
    const notify = () => subscribers.forEach(listener => listener({ preference, dark: isDark() }));

    function setPreference(next, { persist = true } = {}) {
      if (!['light', 'dark', 'system'].includes(next)) return;
      preference = next;
      if (persist) storage.set(KEYS.theme, next);
      else storage.remove(KEYS.theme);
      notify();
    }

    if (media) {
      const onChange = () => { if (preference === 'system') notify(); };
      if (media.addEventListener) media.addEventListener('change', onChange);
      else if (media.addListener) media.addListener(onChange);
    }

    return {
      get preference() { return preference; },
      isDark,
      systemDark: () => Boolean(media && media.matches),
      setPreference,
      toggle: () => setPreference(isDark() ? 'light' : 'dark'),
      useSystem: () => setPreference('system', { persist: false }),
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    };
  }

  /* ---------- Global type scale ---------- */

  function createTypeScaleController() {
    const stored = Number(storage.get(KEYS.typeScale, 1));
    let value = TYPE_STEPS.reduce((closest, step) => Math.abs(step - stored) < Math.abs(closest - stored) ? step : closest, 1);
    const subscribers = new Set();
    const notify = () => subscribers.forEach(listener => listener(value));
    function set(next) {
      value = TYPE_STEPS.reduce((closest, step) => Math.abs(step - Number(next)) < Math.abs(closest - Number(next)) ? step : closest, 1);
      storage.set(KEYS.typeScale, value);
      notify();
    }
    return {
      steps: TYPE_STEPS.slice(),
      get() { return value; },
      percent: () => Math.round(value * 100),
      canDecrease: () => value > TYPE_STEPS[0],
      canIncrease: () => value < TYPE_STEPS[TYPE_STEPS.length - 1],
      increase: () => set(TYPE_STEPS[TYPE_STEPS.indexOf(value) + 1] || value),
      decrease: () => set(TYPE_STEPS[TYPE_STEPS.indexOf(value) - 1] || value),
      reset: () => set(1),
      set,
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    };
  }

  /* ---------- Speech adapter ---------- */

  function createSpeechController() {
    const synth = global.speechSynthesis || null;
    const subscribers = new Set();
    let active = false;
    let activeText = '';
    let utterance = null;

    function notify(type, detail = {}) {
      subscribers.forEach(listener => listener({ type, speaking: active, text: activeText, ...detail }));
    }

    function setActive(next, text = '') {
      active = next;
      activeText = next ? text : '';
    }

    function pickVoice(lang) {
      if (!synth || typeof synth.getVoices !== 'function') return null;
      const voices = synth.getVoices();
      if (!voices.length) return null;
      const wanted = String(lang).toLowerCase().slice(0, 2);
      return voices.find(voice => String(voice.lang).toLowerCase().replace('_', '-').startsWith(wanted)) || null;
    }

    function stop(silent = false) {
      if (nativeBridge.speech) nativeBridge.stop();
      if (synth) {
        try { synth.cancel(); } catch (_) {}
      }
      utterance = null;
      if (active) {
        setActive(false);
        if (!silent) notify('stop');
      }
    }

    function speak(text, { lang = 'en-US', rate = 0.95 } = {}) {
      const content = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
      if (!content) return false;
      stop(true);
      if (nativeBridge.speech && nativeBridge.speak(content, lang, rate)) {
        setActive(true, content);
        notify('start');
        return true;
      }
      if (!synth || typeof global.SpeechSynthesisUtterance !== 'function') {
        notify('unsupported');
        return false;
      }
      try {
        const item = new global.SpeechSynthesisUtterance(content);
        item.lang = lang;
        item.rate = rate;
        const voice = pickVoice(lang);
        if (voice) item.voice = voice;
        item.onstart = () => {
          setActive(true, content);
          notify('start');
        };
        item.onend = () => {
          setActive(false);
          notify('end');
        };
        item.onerror = event => {
          setActive(false);
          notify('error', { error: event.error || 'speech-error' });
        };
        utterance = item;
        synth.speak(item);
        return true;
      } catch (error) {
        console.warn('Speech synthesis failed:', error);
        notify('error', { error: 'speech-error' });
        return false;
      }
    }

    return {
      supported: Boolean(nativeBridge.speech || synth),
      get speaking() { return active; },
      speak,
      stop,
      notify: type => {
        const event = type || 'end';
        if (event === 'end' || event === 'stop' || event === 'error') setActive(false);
        notify(event);
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    };
  }

  /* ---------- Interaction data layer ---------- */

  const SEVERITY_RANK = { avoid: 0, major: 1, moderate: 2 };

  function rank(severity) {
    return SEVERITY_RANK[severity] ?? 3;
  }

  function findPair(aId, bId, library) {
    if (!aId || !bId || aId === bId || !Array.isArray(library)) return null;
    return library.find(item => (item.a === aId && item.b === bId) || (item.a === bId && item.b === aId)) || null;
  }

  function flagPairs(aIds, bIds, library) {
    const left = [...new Set(aIds || [])];
    const right = [...new Set(bIds || [])];
    const seen = new Set();
    const found = [];
    for (const aId of left) {
      for (const bId of right) {
        if (aId === bId) continue;
        const key = [aId, bId].sort().join('|');
        if (seen.has(key)) continue;
        const pair = findPair(aId, bId, library);
        if (!pair) continue;
        seen.add(key);
        found.push({ pair, aId, bId });
      }
    }
    return found.sort((leftPair, rightPair) => rank(leftPair.pair.severity) - rank(rightPair.pair.severity));
  }

  function worst(entries) {
    return (entries || []).reduce((current, entry) => {
      const severity = entry && entry.pair ? entry.pair.severity : entry;
      return severity && rank(severity) < rank(current) ? severity : current;
    }, 'moderate');
  }

  /* ---------- Reminder scheduling ---------- */

  function normalizeReminder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const time = parseTime(raw.time) === null ? '' : String(raw.time).trim();
    if (!name || !time) return null;
    return {
      id: String(raw.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`),
      name,
      dose: String(raw.dose || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      time,
      createdAt: String(raw.createdAt || new Date().toISOString())
    };
  }

  function sortReminders(items) {
    return items.slice().sort((left, right) => {
      const delta = parseTime(left.time) - parseTime(right.time);
      return delta || left.name.localeCompare(right.name);
    });
  }

  function buildSchedule(items, takenIds = new Set(), now = new Date()) {
    const today = localDateKey(now);
    const current = minutesNow(now);
    const entries = sortReminders(items.filter(item => item && parseTime(item.time) !== null)).map(item => {
      const minutes = parseTime(item.time);
      const taken = takenIds.has(item.id);
      let state = 'upcoming';
      if (taken) state = 'taken';
      else if (current > minutes + OVERDUE_AFTER) state = 'overdue';
      else if (current >= minutes - DUE_BEFORE) state = 'due';
      return { ...item, minutes, taken, state, minutesUntil: minutes - current };
    });
    const takenCount = entries.filter(entry => entry.taken).length;
    const pending = entries.filter(entry => !entry.taken && entry.state !== 'overdue');
    return {
      date: today,
      entries,
      total: entries.length,
      takenCount,
      pendingCount: entries.length - takenCount,
      progress: entries.length ? takenCount / entries.length : 0,
      nextId: pending.length ? pending[0].id : '',
      dueCount: entries.filter(entry => entry.state === 'due').length,
      overdueCount: entries.filter(entry => entry.state === 'overdue').length
    };
  }

  function nextDose(items, takenIds = new Set(), now = new Date()) {
    const current = minutesNow(now);
    const sorted = sortReminders(items);
    for (const item of sorted) {
      const minutes = parseTime(item.time);
      if (minutes === null || takenIds.has(item.id)) continue;
      if (minutes >= current) return { reminder: item, minutesUntil: minutes - current, dayOffset: 0 };
    }
    for (const item of sorted) {
      const minutes = parseTime(item.time);
      if (minutes === null || takenIds.has(item.id)) continue;
      return { reminder: item, minutesUntil: minutes + 1440 - current, dayOffset: 1 };
    }
    return null;
  }

  function pruneTaken(map, now = new Date()) {
    const today = localDateKey(now);
    const keys = Object.keys(map || {}).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key) && key <= today).sort().slice(-14);
    return Object.fromEntries(keys.map(key => [key, map[key]]));
  }

  function createReminderStore() {
    let items = (storage.json(KEYS.reminders, []) || []).map(normalizeReminder).filter(Boolean);
    let taken = pruneTaken(storage.json(KEYS.reminderTaken, {}) || {});
    const subscribers = new Set();
    const notify = () => subscribers.forEach(listener => listener(items));
    const save = () => {
      storage.set(KEYS.reminders, JSON.stringify(items));
      storage.set(KEYS.reminderTaken, JSON.stringify(taken));
    };

    return {
      list: () => items.slice(),
      add({ name, dose = '', time } = {}) {
        if (items.length >= REMINDER_LIMIT) return { ok: false, reason: 'limit' };
        const reminder = normalizeReminder({ name, dose, time });
        if (!reminder) return { ok: false, reason: 'invalid' };
        items = sortReminders([...items, reminder]);
        save();
        notify();
        return { ok: true, reminder };
      },
      remove(id) {
        const next = items.filter(item => item.id !== id);
        if (next.length === items.length) return false;
        items = next;
        save();
        notify();
        return true;
      },
      takenFor(date = new Date()) {
        return new Set(taken[localDateKey(date)] || []);
      },
      isTaken(id, date = new Date()) {
        return (taken[localDateKey(date)] || []).includes(id);
      },
      toggleTaken(id, date = new Date()) {
        const key = localDateKey(date);
        const current = new Set(taken[key] || []);
        const isNowTaken = !current.has(id);
        if (isNowTaken) current.add(id);
        else current.delete(id);
        taken = pruneTaken({ ...taken, [key]: [...current] }, date);
        save();
        notify();
        return isNowTaken;
      },
      schedule(date = new Date()) {
        return buildSchedule(items, this.takenFor(date), date);
      },
      next(date = new Date()) {
        return nextDose(items, this.takenFor(date), date);
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    };
  }

  /* A dose alert repeats on this ladder until it is confirmed taken. The native
     shells mirror these offsets, and 20 reminders x 3 slots stays inside the
     64 pending-notification ceiling iOS enforces per app. */
  const REMINDER_ESCALATION_MINUTES = [0, 10, 30];

  global.DawayaCore = {
    version: '1.0.0',
    storage,
    platform,
    theme: createThemeController(),
    typeScale: createTypeScaleController(),
    speech: createSpeechController(),
    interactions: { SEVERITY_RANK, rank, findPair, flagPairs, worst },
    reminders: {
      LIMIT: REMINDER_LIMIT,
      ESCALATION_MINUTES: REMINDER_ESCALATION_MINUTES,
      parseTime,
      minutesToTime,
      defaultTime: defaultReminderTime,
      localDateKey,
      buildSchedule,
      nextDose,
      createStore: createReminderStore
    }
  };
  syncPlatformAttributes();
})(window);
