/*
 * Dawaya AI - model runtime bridge.
 *
 * One small surface over whatever runs llama.cpp on the device. Five transports are tried in
 * order, and the assistant keeps working when none is present:
 *   1. window.DawayaLLM            - injected by the native shells (iOS, Android, macOS, Windows)
 *   2. window.Capacitor.Plugins.DawayaLLM - the same native code reached as a Capacitor plugin
 *   3. POST http://127.0.0.1/__dawaya/llm  - the Windows launcher, which loops out to its embedded
 *                                            llama.cpp helper over loopback only
 *   4. window.DawayaAIWasmRuntime  - the web/PWA transport: wllama (llama.cpp compiled to
 *                                    WebAssembly, vendored in ai/vendor/wllama/) with the model
 *                                    stored in OPFS; ai/wasm-bridge.js implements it
 *   5. none                        - smart search mode, no generation at all
 * A test or benchmark harness can call useAdapter() to install its own runtime.
 *
 * Contract the native side implements:
 *   capabilities() -> {supported, backends:[], totalRamBytes, freeRamBytes, cores, storageBytes}
 *   status()       -> {state, fileName, sizeBytes, downloadedBytes, checksumVerified, path}
 *   download(opts) / pauseDownload(id) / resumeDownload(id) / cancelDownload(id)
 *   verifyDownload(id) -> {ok, sha256}
 *   importModel() -> {ok, fileName, sizeBytes}
 *   deleteModel() -> {ok}
 *   load(params) / unload()
 *   generate({prompt, params, requestId}) -> {text, tokens, milliseconds}
 *   cancelGeneration(requestId)
 * Streaming comes back as window.__dawayaLLMEvent({type, requestId, ...}) JSON.
 *
 * Exposed as DawayaAIRuntime.
 */
(function (global) {
  'use strict';

  const LISTENER_KEY = '__dawayaLLMEvent';
  const listeners = new Set();
  let adapter = null;
  let detected = null;

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('Dawaya AI runtime listener failed:', error);
      }
    }
  }

  /* Native shells call this with a JSON string or an object. */
  global[LISTENER_KEY] = payload => {
    let event = payload;
    if (typeof payload === 'string') {
      try {
        event = JSON.parse(payload);
      } catch (_) {
        return;
      }
    }
    emit(event || {});
  };

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /* A fresh runtime starts with no subscribers; a test harness that reloads the modules needs it. */
  function resetListeners() {
    listeners.clear();
  }

  function once(type, predicate) {
    return new Promise(resolve => {
      const stop = subscribe(event => {
        if (event.type !== type) return;
        if (predicate && !predicate(event)) return;
        stop();
        resolve(event);
      });
    });
  }

  function call(method, args) {
    const target = adapter;
    if (!target || typeof target[method] !== 'function') return Promise.reject(new Error(`runtime method ${method} is unavailable`));
    try {
      return Promise.resolve(target[method](args || {}));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /* ---------- transports ---------- */

  function globalAdapter() {
    const bridge = global.DawayaLLM || (global.DawayaNative && global.DawayaNative.llm) || null;
    if (!bridge || typeof bridge.generate !== 'function') return null;
    return { kind: 'native', bridge };
  }

  function capacitorAdapter() {
    const cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins && cap.Plugins.DawayaLLM;
    if (!plugin || typeof plugin.generate !== 'function') return null;
    return { kind: 'capacitor', bridge: plugin };
  }

  /* Windows: the Go launcher talks to its embedded helper and streams tokens on the same loopback socket. */
  function httpAdapter() {
    if (typeof global.fetch !== 'function') return null;
    if (global.location && !/^https?:$/.test(global.location.protocol)) return null;
    if (!global.location || (global.location.hostname !== '127.0.0.1' && global.location.hostname !== 'localhost')) return null;
    /* A plain dev server also listens on loopback: only the Windows launcher announces itself. */
    if (global.DawayaLLMTransport !== 'windows') return null;
    const base = '/__dawaya/llm';
    const post = (path, body) => global.fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(response => response.ok ? response.json() : Promise.reject(new Error(`llm ${path} failed: ${response.status}`)));
    const bridge = {
      capabilities: () => global.fetch(`${base}/capabilities`).then(r => r.ok ? r.json() : Promise.reject(new Error('no runtime'))),
      status: () => global.fetch(`${base}/status`).then(r => r.json()),
      download: options => post('/download', options),
      pauseDownload: options => post('/pause', options),
      resumeDownload: options => post('/resume', options),
      cancelDownload: options => post('/cancel', options),
      verifyDownload: options => post('/verify', options),
      importModel: () => post('/import', {}),
      deleteModel: () => post('/delete', {}),
      load: params => post('/load', params),
      unload: () => post('/unload', {}),
      generate: request => post('/generate', request),
      cancelGeneration: options => post('/cancelGeneration', options),
      /* The helper pushes tokens with server-sent events, which are relayed to the same hub. */
      watch: () => {
        /* EventSource is refused by the privacy gate (net.js blocks it as a transport), which
           left the page without any download or token events. A same-origin fetch stream carries
           the same server-sent events and is allowed; it reconnects if the socket drops. */
        let stopped = false;
        let controller = null;
        const pump = async () => {
          while (!stopped) {
            try {
              controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
              const response = await global.fetch(`${base}/stream`, {
                credentials: 'omit',
                cache: 'no-store',
                signal: controller ? controller.signal : undefined
              });
              if (!response.ok || !response.body) throw new Error('stream unavailable');
              const reader = response.body.getReader();
              const decoder = new global.TextDecoder();
              let buffer = '';
              for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let cut;
                while ((cut = buffer.indexOf('\n\n')) >= 0) {
                  const block = buffer.slice(0, cut);
                  buffer = buffer.slice(cut + 2);
                  for (const line of block.split('\n')) {
                    if (line.indexOf('data:') !== 0) continue;
                    try { emit(JSON.parse(line.slice(5).trim())); } catch (_) {}
                  }
                }
              }
            } catch (_) {}
            if (!stopped) await new Promise(resolve => global.setTimeout(resolve, 1500));
          }
        };
        pump();
        return () => {
          stopped = true;
          try { if (controller) controller.abort(); } catch (_) {}
        };
      }
    };
    return { kind: 'windows-http', bridge };
  }

  /* Web/PWA: llama.cpp compiled to WebAssembly. Lives in ai/wasm-bridge.js, which registers
     DawayaAIWasmRuntime; absent there, or where the browser lacks WebAssembly/OPFS, the
     assistant falls through to smart search exactly as before. */
  function wasmAdapter() {
    const factory = global.DawayaAIWasmRuntime;
    if (!factory || typeof factory.bridge !== 'function') return null;
    if (typeof factory.available === 'function' && !factory.available()) return null;
    let bridge = null;
    try {
      bridge = factory.bridge();
    } catch (_) {
      return null;
    }
    if (!bridge || typeof bridge.generate !== 'function') return null;
    return { kind: 'web-wasm', bridge };
  }

  function detect(force) {
    if (detected && !force) return detected;
    const candidates = [globalAdapter(), capacitorAdapter(), httpAdapter(), wasmAdapter()].filter(Boolean);
    for (const candidate of candidates) {
      if (typeof candidate.bridge.watch === 'function') {
        try {
          candidate.bridge.watch();
        } catch (_) {}
      }
    }
    detected = candidates[0] || null;
    adapter = detected ? detected.bridge : null;
    return detected;
  }

  function useAdapter(next) {
    detected = next ? { kind: 'injected', bridge: next } : null;
    adapter = next || null;
    return detected;
  }

  function available() {
    if (!adapter) detect();
    return Boolean(adapter && typeof adapter.generate === 'function');
  }

  /* ---------- the calls the assistant makes ---------- */

  async function capabilities() {
    if (!available()) return { supported: false, reason: 'no-runtime', backends: ['cpu'] };
    try {
      const value = await call('capabilities', {});
      return { backends: ['cpu'], totalRamBytes: 0, freeRamBytes: 0, cores: 0, storageBytes: 0, ...value };
    } catch (error) {
      return { supported: false, reason: 'capabilities-failed', error: String(error && error.message || error), backends: ['cpu'] };
    }
  }

  function webMemoryHint() {
    const deviceMemory = global.navigator && typeof global.navigator.deviceMemory === 'number' ? global.navigator.deviceMemory : null;
    const heap = global.performance && global.performance.memory && global.performance.memory.jsHeapSizeLimit ? global.performance.memory.jsHeapSizeLimit : null;
    return { deviceMemoryGb: deviceMemory, heapLimitBytes: heap };
  }

  function status() {
    if (!available()) return Promise.resolve({ state: 'no-runtime' });
    return call('status', {}).catch(() => ({ state: 'unknown' }));
  }

  function download(options) {
    return call('download', options).then(id => ({ id: id && id.id ? id.id : id }));
  }

  function pauseDownload(id) {
    return call('pauseDownload', { id });
  }

  function resumeDownload(id) {
    return call('resumeDownload', { id });
  }

  function cancelDownload(id) {
    return call('cancelDownload', { id });
  }

  function verify(id) {
    return call('verifyDownload', { id });
  }

  function importModel() {
    if (!adapter || typeof adapter.importModel !== 'function') return Promise.reject(new Error('import-unavailable'));
    return call('importModel', {});
  }

  function deleteModel() {
    return call('deleteModel', {});
  }

  function load(params) {
    return call('load', params);
  }

  function unload() {
    if (!adapter || typeof adapter.unload !== 'function') return Promise.resolve({ ok: true });
    return call('unload', {});
  }

  /*
   * Token streaming: generate() resolves with the full text, while every token arrives first on
   * the event hub so the chat can paint it as it is written. requestIds keep parallel calls apart.
   */
  function generate(request) {
    if (!available()) return Promise.reject(new Error('no-runtime'));
    const requestId = request.requestId || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const handlers = new Set();
    const stopWatch = subscribe(event => {
      if (event.requestId && event.requestId !== requestId) return;
      if (event.type === 'token' && request.onToken) request.onToken(String(event.token || event.text || ''));
      if (event.type === 'progress' && request.onProgress) request.onProgress(event);
    });
    return call('generate', { ...request, requestId })
      .then(result => {
        stopWatch();
        handlers.clear();
        const text = typeof result === 'string' ? result : String(result && result.text || '');
        return {
          text,
          tokens: result && result.tokens ? result.tokens : null,
          milliseconds: result && result.milliseconds ? result.milliseconds : null,
          /* A stopped run and a failed one both arrive as plain results, and the pipeline shows a
             different card for each, so the flags have to survive this wrapper. */
          cancelled: Boolean(result && typeof result === 'object' && result.cancelled),
          error: result && typeof result === 'object' ? result.error || null : null,
          requestId
        };
      })
      .catch(error => {
        stopWatch();
        throw error;
      });
  }

  function cancelGeneration(requestId) {
    if (!adapter || typeof adapter.cancelGeneration !== 'function') return Promise.resolve({ ok: false });
    return call('cancelGeneration', { requestId });
  }

  global.DawayaAIRuntime = {
    subscribe,
    resetListeners,
    once,
    emit,
    detect,
    useAdapter,
    available,
    capabilities,
    webMemoryHint,
    status,
    download,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    verify,
    importModel,
    deleteModel,
    load,
    unload,
    generate,
    cancelGeneration,
    get kind() {
      return detected ? detected.kind : 'none';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
