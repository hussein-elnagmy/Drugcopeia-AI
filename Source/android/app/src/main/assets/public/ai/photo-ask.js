/*
 * Dawaya AI - asking with a photograph, read entirely on the device.
 *
 * The shipped model is a text-only instruction model, so a photograph can never be
 * "sent to the model". This module is the route that actually helps: it shrinks the
 * picture, reads whatever the pack itself carries (a barcode, then the printed text),
 * matches what it read against the medicine directory already on the device, and hands
 * the assistant those records as reference data. Whatever it read - and whatever it
 * could not read - is reported back so the interface can say which route was taken
 * and why, instead of leaving the reader guessing whether the photo was understood.
 *
 * Nothing here uploads anything: no network call, no remote service. The picture is
 * decoded in this page or by the operating system next to it.
 */
(function (global) {
  'use strict';

  const MAX_SIDE = 1024;
  const JPEG_QUALITY = 0.82;
  const MIN_BARCODE_DIGITS = 8;
  const MIN_OCR_NAME_SCORE = 0.6;

  let barcodeTable = null;
  let barcodeTableRequest = null;

  function normalise(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(value) {
    const words = normalise(value).split(' ').filter(Boolean);
    return words.map(word => (word === 'capsules' || word === 'capsule' ? 'cap'
      : word === 'tablets' || word === 'tablet' ? 'tab'
      : word === 'suspension' ? 'susp'
      : word === 'injection' ? 'inj' : word));
  }

  function digitsOf(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  /* The same table the home-page scanner uses, bundled with the app. */
  function loadBarcodeTable() {
    if (barcodeTable) return Promise.resolve(barcodeTable);
    if (!barcodeTableRequest) {
      barcodeTableRequest = fetch('assets/barcode-index.json', { cache: 'force-cache' })
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
          barcodeTable = data && data.codes ? data.codes : {};
          return barcodeTable;
        })
        .catch(() => {
          barcodeTableRequest = null;
          barcodeTable = {};
          return barcodeTable;
        });
    }
    return barcodeTableRequest;
  }

  function codeVariants(code) {
    const digits = digitsOf(code);
    if (!digits) return [];
    const list = [digits];
    if (digits.length === 13 && digits.charAt(0) === '0') list.push(digits.slice(1));
    if (digits.length === 12) list.push(`0${digits}`);
    return list;
  }

  function namesForCode(code, table) {
    for (const variant of codeVariants(code)) {
      const names = table[variant];
      if (Array.isArray(names) && names.length) return names;
    }
    return [];
  }

  /* A brand index over the rows already in memory, built once per dataset. */
  let brandIndex = null;
  let brandIndexSize = -1;

  function drugs() {
    const list = global.DawayaApp && global.DawayaApp.drugs;
    return Array.isArray(list) ? list : [];
  }

  function buildBrandIndex() {
    const rows = drugs();
    if (brandIndex && brandIndexSize === rows.length) return brandIndex;
    const index = new Map();
    rows.forEach(drug => {
      const names = [drug && drug.commercial_name_en, drug && drug.commercial_name_ar];
      names.forEach(name => {
        const first = tokens(name)[0];
        if (!first) return;
        if (!index.has(first)) index.set(first, []);
        const bucket = index.get(first);
        if (bucket.indexOf(drug) === -1) bucket.push(drug);
      });
    });
    brandIndex = index;
    brandIndexSize = rows.length;
    return index;
  }

  function numbersIn(list) {
    const found = [];
    list.forEach(token => {
      if (/\d/.test(token)) {
        const bare = token.replace(/\D/g, '');
        if (bare && found.indexOf(bare) === -1) found.push(bare);
      }
    });
    return found;
  }

  /*
   * Printed pack text is noisy: strengths, manufacturer, Arabic and Latin on the same
   * label, and the reader's own sentence on top. So a row only matches when the brand
   * word itself is present and most of the printed name is covered by the read text,
   * with strengths allowed to agree but never to disagree. A weak read is reported as a
   * weak read: guessing a medicine off a blurry photo is worse than saying nothing.
   */
  function matchName(text) {
    const rows = drugs();
    if (!rows.length) return null;
    const index = buildBrandIndex();
    const haystack = tokens(text);
    if (!haystack.length) return null;
    const present = new Set(haystack);
    const haystackNumbers = numbersIn(haystack);
    let best = null;
    let bestCoverage = 0;
    const pools = new Map();
    haystack.forEach(token => {
      if (pools.has(token)) return;
      const pool = index.get(token);
      if (pool && pool.length) pools.set(token, pool);
    });
    pools.forEach((pool, anchor) => {
      pool.forEach(drug => {
        [drug.commercial_name_en, drug.commercial_name_ar].forEach(candidate => {
          const words = tokens(candidate);
          if (!words.length || words[0] !== anchor) return;
          const distinct = new Set(words);
          const shared = [...distinct].filter(word => present.has(word));
          const numbers = numbersIn(words);
          if (haystackNumbers.length && numbers.length
            && !numbers.some(number => haystackNumbers.indexOf(number) !== -1)) return;
          /* Most Egyptian brands are a single word, so demanding two hits would throw away the
             common case; a one-word name has to be long enough not to be a stray label word.
             A longer name needs two of its words present to be picked. */
          if (distinct.size === 1) {
            if (anchor.length < 4) return;
          } else if (shared.length < 2 && !(numbers.length && haystackNumbers.length)) return;
          const coverage = shared.length / distinct.size;
          if (coverage > bestCoverage) {
            bestCoverage = coverage;
            best = drug;
          }
        });
      });
    });
    if (!best || bestCoverage < MIN_OCR_NAME_SCORE) return null;
    return { drug: best, score: Number(bestCoverage.toFixed(3)) };
  }

  function nameOf(drug) {
    if (!drug) return '';
    return String(drug.commercial_name_en || drug.commercial_name_ar || '').trim();
  }

  /* Shrink once, then reuse the same bitmap for every reader. */
  async function shrink(source) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(source);
    } catch (_) {
      bitmap = null;
    }
    if (!bitmap && typeof Image === 'function') {
      bitmap = await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = typeof source === 'string' ? source : URL.createObjectURL(source);
      });
    }
    if (!bitmap) return null;
    const width = Number(bitmap.width) || 0;
    const height = Number(bitmap.height) || 0;
    if (!width || !height) return null;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context2d = canvas.getContext('2d');
    if (!context2d) return { bitmap: null, width: canvas.width, height: canvas.height, source: bitmap };
    context2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    let shrunk = null;
    try {
      shrunk = await createImageBitmap(await (await fetch(dataUrl)).blob());
    } catch (_) {
      shrunk = null;
    }
    return { bitmap: shrunk, original: bitmap, width: canvas.width, height: canvas.height, dataUrl };
  }

  function base64Of(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    return comma >= 0 ? String(dataUrl).slice(comma + 1) : '';
  }

  async function detectWithNative(base64) {
    const native = global.DawayaNative;
    if (!native || typeof native.readPhoto !== 'function') return null;
    const result = await Promise.resolve(native.readPhoto({ image: base64 })).catch(() => null);
    if (!result || result.error) return null;
    return result;
  }

  async function detectWithBrowser(bitmap) {
    const Detector = global.BarcodeDetector;
    if (!bitmap || typeof Detector !== 'function') return null;
    let formats = null;
    try {
      formats = await Detector.getSupportedFormats();
    } catch (_) {
      formats = null;
    }
    const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code', 'data_matrix', 'pdf417']
      .filter(format => !Array.isArray(formats) || formats.indexOf(format) !== -1);
    if (!wanted.length) return null;
    const detector = new Detector({ formats: wanted });
    try {
      const found = await detector.detect(bitmap);
      return Array.isArray(found) ? found : [];
    } catch (_) {
      return [];
    }
  }

  /*
   * ask(image) ->
   * {
   *   route: 'barcode' | 'ocr' | 'unreadable' | 'unsupported',
   *   code, name, drug, codes: [], text, width, height,
   *   evidence: text for the reference block ('' when nothing was read),
   *   noteKey: which ui.* string explains the route to the reader
   * }
   */
  async function ask(image) {
    const shrunk = await shrink(image);
    if (!shrunk) {
      return { route: 'unsupported', code: '', name: '', drug: null, codes: [], text: '', evidence: '', noteKey: 'photoUnsupported', width: 0, height: 0 };
    }
    const table = await loadBarcodeTable();
    const native = await detectWithNative(base64Of(shrunk.dataUrl));
    const browser = native && Array.isArray(native.codes) && native.codes.length ? null : await detectWithBrowser(shrunk.bitmap);
    const codes = [];
    const pushCode = value => {
      const digits = digitsOf(value);
      if (digits.length >= MIN_BARCODE_DIGITS && codes.indexOf(digits) === -1) codes.push(digits);
    };
    if (native && Array.isArray(native.codes)) native.codes.forEach(item => pushCode(item && item.rawValue ? item.rawValue : item));
    (browser || []).forEach(item => pushCode(item && item.rawValue));
    const ocrText = native && typeof native.text === 'string' ? native.text : '';

    for (const code of codes) {
      const names = namesForCode(code, table);
      if (!names.length) continue;
      const hit = matchName(names[0]) || null;
      const label = hit ? nameOf(hit.drug) : names[0];
      const evidence = `Barcode read from the photograph: ${code}\n`
        + `The medicine directory on this device answers that barcode with: ${names.join(', ')}\n`
        + (hit ? `Matched record: ${nameOf(hit.drug)} - ${String(hit.drug.scientific_name || '').trim()}` : '');
      return {
        route: 'barcode', code, name: label, drug: hit ? hit.drug : null, codes, text: ocrText,
        evidence, noteKey: 'photoBarcode', width: shrunk.width, height: shrunk.height
      };
    }

    if (ocrText.trim()) {
      const hit = matchName(ocrText);
      if (hit) {
        const evidence = 'Text read from the photograph: ' + normalise(ocrText).slice(0, 300) + '\n'
          + 'Matched against the medicine directory on this device as: ' + nameOf(hit.drug);
        return {
          route: 'ocr', code: '', name: nameOf(hit.drug), drug: hit.drug, codes, text: ocrText,
          evidence, noteKey: 'photoText', width: shrunk.width, height: shrunk.height
        };
      }
      return {
        route: 'unreadable', code: '', name: '', drug: null, codes, text: ocrText,
        evidence: '', noteKey: 'photoNoMatch', width: shrunk.width, height: shrunk.height
      };
    }

    return {
      route: codes.length ? 'unreadable' : 'unsupported', code: '', name: '', drug: null, codes, text: '',
      evidence: '', noteKey: codes.length ? 'photoNoMatch' : 'photoNothing',
      width: shrunk.width, height: shrunk.height
    };
  }

  function canRead() {
    const native = global.DawayaNative;
    return Boolean((native && typeof native.readPhoto === 'function')
      || typeof global.BarcodeDetector === 'function');
  }

  global.DawayaAIPhoto = { ask, canRead, matchName, namesForCode, MAX_SIDE,
    internals: { normalise, tokens, codeVariants, digitsOf, base64Of, matchName, namesForCode } };
})(typeof window !== 'undefined' ? window : globalThis);
