/*
 * Dawaya AI - model lifecycle: capability check, one-time download, checksum verification,
 * manual import, lazy load and release.
 *
 * The model is downloaded once into the app's private storage and never fetched again unless the
 * user deletes it or a newer model.version is configured. A file whose SHA-256 does not match the
 * value in assets/ai/model-config.json is deleted and the state goes back to not-downloaded.
 *
 * Exposed as DawayaAIModel.
 */
(function (global) {
  'use strict';

  const runtime = () => global.DawayaAIRuntime;
  const MB = 1024 * 1024;

  const STATES = {
    NO_RUNTIME: 'no-runtime',
    UNSUPPORTED: 'unsupported',
    NOT_DOWNLOADED: 'not-downloaded',
    DOWNLOADING: 'downloading',
    PAUSED: 'paused',
    VERIFYING: 'verifying',
    READY_TO_LOAD: 'ready-to-load',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error'
  };

  let config = null;
  let settings = null;
  let storage = null;
  let state = STATES.NOT_DOWNLOADED;
  let downloadId = null;
  let lastError = null;
  let device = null;
  let loaded = false;
  const progressListeners = new Set();
  const stateListeners = new Set();

  /* options.model is the whole model-config.json, not its model entry: the device thresholds, the
     generation profiles and the storage keys live beside that entry. A caller handing over only the
     entry loses all three silently - no device ever gets the lean profile, the free-memory floor is
     skipped, the stored download is treated as an old version and deleted at every start, and
     loading throws on the missing fileName. So a half config is refused out loud. */
  function configure(options) {
    if (options.model && !options.model.model) {
      throw new Error('DawayaAIModel.configure takes the whole model-config.json, not its model entry');
    }
    config = options.model || config;
    settings = options.generation || settings;
    storage = options.storage || storage;
    return api;
  }

  function stored() {
    if (!storage) return {};
    const key = (config && config.paths && config.paths.stateKey) || 'dawaya-ai-model-state-v1';
    return storage.json(key, {}) || {};
  }

  function persist(patch) {
    if (!storage) return;
    const key = (config && config.paths && config.paths.stateKey) || 'dawaya-ai-model-state-v1';
    const next = { ...stored(), ...patch, modelVersion: config && config.model ? config.model.version : 0 };
    storage.set(key, JSON.stringify(next));
  }

  function setState(next, detail) {
    if (state !== next) {
      state = next;
      if (detail && detail.error) lastError = String(detail.error);
      for (const listener of stateListeners) {
        try {
          listener({ state, lastError, device, detail: detail || null });
        } catch (error) {
          console.warn('Dawaya AI state listener failed:', error);
        }
      }
    }
    return state;
  }

  function onState(listener) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  function onProgress(listener) {
    progressListeners.add(listener);
    return () => progressListeners.delete(listener);
  }

  /* ---------- device capability ---------- */

  function bytesToMb(value) {
    return Math.round(Number(value || 0) / MB);
  }

  /*
   * A device under model-config.device.minRamMB never loads the LLM; the assistant answers from
   * smart search and a card instead. RAM reported by the native runtime wins, then the web hint,
   * then "unknown", which is treated as weak rather than guessed up.
   */
  async function assessDevice(force) {
    if (device && !force) return device;
    const thresholds = (config && config.device) || { minRamMB: 2600 };
    const caps = await runtime().capabilities();
    const hint = runtime().webMemoryHint();
    const reportedMb = caps && caps.totalRamBytes ? bytesToMb(caps.totalRamBytes) : 0;
    const webMb = hint.deviceMemoryGb ? hint.deviceMemoryGb * 1024 : 0;
    const ramMb = Math.max(reportedMb, webMb);
    const next = {
      ramMb: ramMb || null,
      ramKnown: Boolean(ramMb),
      freeMb: caps && caps.freeRamBytes ? bytesToMb(caps.freeRamBytes) : null,
      cores: caps && caps.cores ? caps.cores : (global.navigator && global.navigator.hardwareConcurrency) || null,
      backends: (caps && caps.backends) || [],
      storageMb: caps && caps.storageBytes ? bytesToMb(caps.storageBytes) : null,
      runtimeSupported: Boolean(caps && caps.supported),
      reason: caps && caps.reason ? caps.reason : '',
      minRamMb: thresholds.minRamMB,
      supported: Boolean(caps && caps.supported) && ramMb >= Number(thresholds.minRamMB || 0)
    };
    if (!next.ramKnown) {
      next.supported = Boolean(caps && caps.supported);
    }
    if (next.cores && thresholds.minCores && next.cores < thresholds.minCores) next.weakCores = true;
    device = next;
    return device;
  }

  /* ---------- initialization ---------- */

  /*
   * Order: is there a runtime at all, is the device strong enough, does the model already exist
   * and pass verification. A stored download for an older model.version is dropped so an updated
   * config re-downloads, and nothing re-downloads on its own.
   */
  async function initialize() {
    if (!runtime().available()) {
      setState(STATES.NO_RUNTIME);
      return { state: STATES.NO_RUNTIME, device: await assessDevice(true).catch(() => null) };
    }
    const assessment = await assessDevice(true);
    if (!assessment.supported) {
      setState(STATES.UNSUPPORTED);
      return { state: STATES.UNSUPPORTED, device: assessment };
    }
    const record = stored();
    const currentVersion = config && config.model ? Number(config.model.version) || 1 : 1;
    if (record.deleted || Number(record.modelVersion || 0) !== currentVersion) {
      if (Number(record.modelVersion || 0) !== currentVersion && record.downloaded) {
        await runtime().deleteModel().catch(() => {});
      }
      persist({ downloaded: false, checksumVerified: false, deleted: false });
      setState(STATES.NOT_DOWNLOADED);
      return { state: STATES.NOT_DOWNLOADED, device: assessment };
    }
    if (record.downloaded && record.checksumVerified) {
      /* The record can outlive the file (an OS cleanup, a restore on another
         device), so the shell is asked whether the bytes are really there. */
      const live = await runtime().status().catch(() => null);
      if (live && live.present === false) {
        persist({ downloaded: false, checksumVerified: false });
        setState(STATES.NOT_DOWNLOADED);
        return { state: STATES.NOT_DOWNLOADED, device: assessment };
      }
      setState(STATES.READY_TO_LOAD);
      return { state: STATES.READY_TO_LOAD, device: assessment };
    }
    if (record.downloaded) {
      setState(STATES.VERIFYING);
      const verified = await verifyChecksum();
      setState(verified ? STATES.READY_TO_LOAD : STATES.NOT_DOWNLOADED);
      return { state, device: assessment };
    }
    const live = await runtime().status().catch(() => ({ state: 'unknown' }));
    if (live && live.state === 'downloading') {
      downloadId = live.id || null;
      setState(STATES.DOWNLOADING);
    } else if (live && live.state === 'paused') {
      downloadId = live.id || null;
      setState(STATES.PAUSED);
    } else if (live && live.sizeBytes && live.checksumVerified) {
      persist({ downloaded: true, checksumVerified: true });
      setState(STATES.READY_TO_LOAD);
    } else {
      setState(STATES.NOT_DOWNLOADED);
    }
    return { state, device: assessment };
  }

  /* ---------- download ---------- */

  function downloadOptions(extra) {
    const model = (config && config.model) || {};
    /* Native shells fetch the GitHub release copy (reachable where the Hugging Face CDN is
       not); the browser build needs CORS, which only Hugging Face sends. */
    const rt = global.DawayaAIRuntime;
    const web = rt && rt.kind === 'web-wasm';
    return {
      url: web && model.webUrl ? model.webUrl : model.url,
      mirrorUrls: model.mirrorUrls,
      fileName: model.fileName,
      sha256: model.sha256,
      sizeBytes: model.sizeBytes,
      ...extra
    };
  }

  async function startDownload(options) {
    const opts = options || {};
    if (!runtime().available()) {
      setState(STATES.NO_RUNTIME, { error: 'no-runtime' });
      return { ok: false, state: state };
    }
    const assessment = await assessDevice();
    if (!assessment.supported) {
      setState(STATES.UNSUPPORTED);
      return { ok: false, state: STATES.UNSUPPORTED, device: assessment };
    }
    setState(STATES.DOWNLOADING);
    try {
      const result = await runtime().download(downloadOptions({
        cellular: Boolean(opts.cellular),
        wifiOnly: opts.cellular !== true
      }));
      downloadId = result && result.id ? result.id : downloadId;
      watchNativeProgress();
      persist({ downloading: true, downloaded: false, checksumVerified: false, deleted: false });
      return { ok: true, id: downloadId };
    } catch (error) {
      const reason = String(error && error.message || error);
      lastError = reason;
      setState(STATES.ERROR, { error: reason });
      return { ok: false, state: STATES.ERROR, error: reason };
    }
  }

  let watching = false;
  function watchNativeProgress() {
    if (watching) return;
    watching = true;
    runtime().subscribe(event => {
      if (!event || !event.type) return;
      if (event.type === 'download-progress') {
        const total = Number(event.totalBytes || (config && config.model && config.model.sizeBytes)) || 0;
        const done = Number(event.downloadedBytes || 0);
        const payload = {
          state: STATES.DOWNLOADING,
          downloadedBytes: done,
          totalBytes: total,
          percent: total ? Math.min(99.5, Math.round((done / total) * 1000) / 10) : 0,
          bytesPerSecond: Number(event.bytesPerSecond || 0),
          id: event.id || downloadId
        };
        for (const listener of progressListeners) listener(payload);
      }
      if (event.type === 'download-paused') setState(STATES.PAUSED);
      if (event.type === 'download-completed') onDownloadFinished(event);
      if (event.type === 'download-error') {
        lastError = String(event.error || 'download-error');
        setState(STATES.ERROR, { error: lastError });
        for (const listener of progressListeners) listener({ state: STATES.ERROR, error: lastError });
      }
      if (event.type === 'checksum-failed') onChecksumFailed(event);
    });
  }

  async function onDownloadFinished(event) {
    persist({ downloaded: true, sizeBytes: Number(event && event.sizeBytes || 0) });
    setState(STATES.VERIFYING);
    const ok = await verifyChecksum(event);
    if (!ok) {
      setState(STATES.NOT_DOWNLOADED, { error: 'checksum-failed' });
      return;
    }
    setState(STATES.READY_TO_LOAD);
  }

  async function onChecksumFailed(event) {
    persist({ downloaded: false, checksumVerified: false, checksumFailed: true });
    lastError = 'checksum-failed';
    setState(STATES.NOT_DOWNLOADED, { error: 'checksum-failed', event });
  }

  /* Verification is native (the file never crosses into JS), and a mismatch deletes the file. */
  async function verifyChecksum(event) {
    try {
      const result = await runtime().verify(event && event.id ? event.id : downloadId);
      const ok = Boolean(result && result.ok);
      if (ok) {
        persist({ downloaded: true, checksumVerified: true, checksum: result.sha256 || '' });
      } else {
        /* The bytes are not the bytes this build was configured for: drop the file so a later
           download starts clean instead of loading a model nobody verified. */
        persist({ downloaded: false, checksumVerified: false, checksumFailed: true });
        await runtime().deleteModel().catch(() => {});
        lastError = 'checksum-failed';
      }
      for (const listener of progressListeners) listener({ state: ok ? STATES.READY_TO_LOAD : STATES.NOT_DOWNLOADED, verified: ok });
      return ok;
    } catch (error) {
      persist({ downloaded: false, checksumVerified: false });
      lastError = String(error && error.message || error);
      setState(STATES.ERROR, { error: lastError });
      return false;
    }
  }

  async function pauseDownload() {
    try {
      await runtime().pauseDownload(downloadId);
      setState(STATES.PAUSED);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  async function resumeDownload() {
    try {
      const result = await runtime().resumeDownload(downloadId);
      downloadId = (result && result.id) || downloadId;
      setState(STATES.DOWNLOADING);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  async function cancelDownload() {
    try {
      await runtime().cancelDownload(downloadId);
      downloadId = null;
      persist({ downloaded: false, checksumVerified: false, downloading: false });
      setState(STATES.NOT_DOWNLOADED);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  async function importFromDevice() {
    setState(STATES.VERIFYING);
    try {
      const result = await runtime().importModel();
      if (!result || !result.ok) throw new Error((result && result.error) || 'import-failed');
      persist({ downloaded: true, checksumVerified: Boolean(result.checksumVerified), imported: true, sizeBytes: Number(result.sizeBytes || 0) });
      if (result.checksumVerified === false) {
        setState(STATES.NOT_DOWNLOADED, { error: 'checksum-failed' });
        return { ok: false, error: 'checksum-failed' };
      }
      setState(STATES.READY_TO_LOAD);
      return { ok: true, fileName: result.fileName };
    } catch (error) {
      lastError = String(error && error.message || error);
      setState(STATES.ERROR, { error: lastError });
      return { ok: false, error: lastError };
    }
  }

  async function removeModel() {
    try {
      await runtime().deleteModel();
    } catch (_) {}
    loaded = false;
    persist({ downloaded: false, checksumVerified: false, deleted: true, downloading: false });
    setState(STATES.NOT_DOWNLOADED);
    return { ok: true };
  }

  /* ---------- generation parameters and loading ---------- */

  /* A device that clears minRamMB but not recommendedRamMB - every phone with 4 GB of
     memory or less, which is most of them - gets the low-memory profile: same model
     file, half the context and a shorter answer, which is what actually keeps it
     inside the memory the OS leaves the app. */
  function usesLowMemoryProfile() {
    const limits = (config && config.device) || {};
    const ramMb = device && Number(device.ramMb);
    const recommended = Number(limits.recommendedRamMB || 0);
    if (!ramMb || !recommended) return false;
    return ramMb < recommended;
  }

  function generationParams(overrides) {
    const base = (config && config.generation) || {};
    const lean = usesLowMemoryProfile() && base.lowMemory ? base.lowMemory : {};
    const cores = device && device.cores
      ? device.cores
      : (global.navigator && global.navigator.hardwareConcurrency) || 0;
    const threads = overrides && overrides.threads
      ? Number(overrides.threads)
      : Math.max(Number(base.n_threads_floor) || 1, cores > 1 ? cores - 1 : 1);
    return {
      n_ctx: Number(overrides && overrides.n_ctx) || Number(lean.n_ctx) || Number(base.n_ctx) || 2048,
      n_threads: threads,
      temperature: Number(base.temperature) || 0.1,
      top_k: Number(base.top_k) || 40,
      top_p: Number.isFinite(Number(base.top_p)) ? Number(base.top_p) : 0.9,
      repeat_penalty: Number(base.repeat_penalty) || 1.1,
      n_predict: Number(overrides && overrides.n_predict) || Number(lean.n_predict_max_new_tokens) || Number(base.n_predict_max_new_tokens) || 300,
      n_batch: Number(lean.batch_size) || Number(base.batch_size) || 128,
      use_mmap: base.use_mmap !== false,
      use_mlock: Boolean(base.use_mlock),
      gpu_layers: base.gpu_layers === 'auto' ? -1 : Number(base.gpu_layers || 0),
      unicode_decoder: base.unicode_decoder !== false,
      lowMemory: usesLowMemoryProfile(),
      overrides: overrides || null
    };
  }

  function classifyParams() {
    const base = (config && config.generation) || {};
    const classify = base.classify || {};
    const lean = usesLowMemoryProfile() && base.lowMemory && base.lowMemory.classify ? base.lowMemory.classify : {};
    return {
      n_ctx: Number(lean.n_ctx) || Number(base.n_ctx) || 2048,
      n_threads: generationParams().n_threads,
      temperature: Number(classify.temperature || 0),
      top_p: Number.isFinite(Number(classify.top_p)) ? Number(classify.top_p) : 1,
      repeat_penalty: Number(classify.repeat_penalty || 1),
      n_predict: Number(lean.n_predict_max_new_tokens) || Number(classify.n_predict_max_new_tokens) || 32,
      use_mmap: true
    };
  }

  /* Lazy load: the model is only brought in when a question actually needs an answer. */
  async function ensureLoaded(overrides) {
    if (loaded) return { ok: true, already: true };
    if (!runtime().available()) return { ok: false, error: 'no-runtime' };
    const assessment = await assessDevice();
    if (!assessment.supported) {
      setState(STATES.UNSUPPORTED);
      return { ok: false, error: 'unsupported-device' };
    }
    const record = stored();
    if (!record.downloaded || !record.checksumVerified) {
      setState(STATES.NOT_DOWNLOADED);
      return { ok: false, error: 'model-missing' };
    }
    /* A lean device is allowed to start closer to the memory line: it loads half the
       context, so the headroom the full profile needs is not the headroom it needs. */
    const limits = (config && config.device) || {};
    const leanFloor = usesLowMemoryProfile() ? Number(limits.lowMemoryMinFreeRamMBAtLoad || 0) : 0;
    const freeFloor = leanFloor || Number(limits.minFreeRamMBAtLoad || 0);
    if (assessment.freeMb !== null && assessment.freeMb < freeFloor) {
      setState(STATES.ERROR, { error: 'low-memory' });
      return { ok: false, error: 'low-memory' };
    }
    setState(STATES.LOADING);
    try {
      const result = await runtime().load({
        fileName: config.model.fileName,
        sha256: config.model.sha256,
        params: generationParams(overrides)
      });
      loaded = Boolean(!result || result.ok !== false);
      if (!loaded) {
        lastError = String((result && result.error) || 'load-failed');
        setState(STATES.ERROR, { error: lastError });
        return { ok: false, error: lastError };
      }
      setState(STATES.READY);
      return { ok: true };
    } catch (error) {
      loaded = false;
      lastError = String(error && error.message || error);
      setState(STATES.ERROR, { error: lastError });
      return { ok: false, error: lastError };
    }
  }

  async function release(reason) {
    if (!loaded) return { ok: true, already: true };
    loaded = false;
    const result = await runtime().unload().catch(() => ({ ok: false }));
    if (stored().downloaded) setState(STATES.READY_TO_LOAD);
    for (const listener of progressListeners) listener({ state: STATES.READY_TO_LOAD, released: reason || 'manual' });
    return result;
  }

  /* Background and memory pressure drop the model, never the downloaded file. */
  function attachLifecycle() {
    if (!global.document) return () => {};
    const onVisibility = () => {
      const base = (config && config.generation) || {};
      if (global.document.visibilityState === 'hidden' && base.unloadOnBackground !== false) release('background');
    };
    const onMemory = event => {
      const base = (config && config.generation) || {};
      if (base.unloadUnderMemoryPressure !== false) release(event && event.level ? `memory:${event.level}` : 'memory-pressure');
    };
    const onPressure = global.navigator && global.navigator.storage && typeof global.navigator.storage.addEventListener === 'function'
      ? () => onMemory({ level: 'critical' })
      : null;
    global.document.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('memory-warning', onMemory);
    if (onPressure) global.navigator.storage.addEventListener('estimate', onPressure);
    return () => {
      global.document.removeEventListener('visibilitychange', onVisibility);
      global.removeEventListener('memory-warning', onMemory);
      if (onPressure) global.navigator.storage.removeEventListener('estimate', onPressure);
    };
  }

  /* Loading is the slowest part of the whole assistant, and a lazy load makes the
     reader pay for it inside their first question. This brings the model in once
     the app has settled instead - but only when the file is already on the device
     and already verified, so a warm-up can never start a download, and it never
     touches the state when it has nothing to do. The same device assessment, the
     free-memory gate and the memory-pressure unload that guard a normal load all
     still apply, because this calls that load. */
  async function warmUp() {
    if (loaded) return { ok: true, already: true };
    const base = (config && config.generation) || {};
    if (base.warmUpOnLaunch === false) return { ok: false, error: 'disabled' };
    if (!runtime().available()) return { ok: false, error: 'no-runtime' };
    const record = stored();
    if (!record.downloaded || !record.checksumVerified) return { ok: false, error: 'model-missing' };
    /* Settle first: the app is still drawing its own first screen, and a model
       load competing with that is the one thing a warm-up must not cost. */
    const delay = Math.max(0, Number(base.warmUpDelayMs ?? 2500));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (loaded) return { ok: true, already: true };
    try {
      return await ensureLoaded();
    } catch (_) {
      return { ok: false, error: 'warm-up-failed' };
    }
  }

  const api = {
    STATES,
    configure,
    initialize,
    refresh: initialize,
    assessDevice,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    verifyChecksum,
    importFromDevice,
    removeModel,
    ensureLoaded,
    warmUp,
    release,
    attachLifecycle,
    generationParams,
    classifyParams,
    onState,
    onProgress,
    get state() {
      return state;
    },
    get loaded() {
      return loaded;
    },
    get lastError() {
      return lastError;
    },
    get device() {
      return device;
    },
    get record() {
      return stored();
    }
  };
  global.DawayaAIModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
