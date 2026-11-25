/* Drugcopeia: same-spec product matching and price comparison (pure logic, no DOM).
 *
 * This is a price comparison of products that match EXACTLY on active
 * ingredient(s), strength(s), route, dosage form and release type. It is not
 * clinical substitution advice. Any record that cannot prove one of those five
 * fields is dropped (fail closed): it neither matches nor is matched.
 *
 * Source fields: scientific_name, route, commercial_name_en (strength, form,
 * release markers and pack size are read from the brand name, because the
 * dataset has no separate columns for them), price_egp.
 */
(function (root) {
  'use strict';
  var map = root.DawayaAltMap || (typeof require !== 'undefined' ? require('./alt-map.js') : null);

  var FORMS = [
    ['ORODISPERSIBLE TABLET', /ORO[\s-]?DISPERS|\bODT\b|ORODISP/],
    ['CHEWABLE TABLET', /\bCHEW/],
    ['EFFERVESCENT', /EFFERV|\bEFF\b/],
    ['SUPPOSITORY', /\bSUPPS?\b|SUPPOSITOR/],
    ['TABLET', /(?<![A-Z])TABS?(?![A-Z])|(?<![A-Z])TABLETS?(?![A-Z])|F\.?C\.?\s?TAB|\bLOZENGES?\b/],
    ['CAPSULE', /(?<![A-Z])CAPS?(?![A-Z])|(?<![A-Z])CAPSULES?(?![A-Z])/],
    ['SACHET', /\bSACHETS?\b|\bSACH\b/],
    ['AMPOULE', /\bAMPS?\b|\bAMPOULES?\b|AMPULES?/],
    ['VIAL', /\bVIALS?\b|\bVIAL\b|I\.?V\.?\s?VIAL/],
    ['PREFILLED SYRINGE', /PRE[\s-]?FILLED|\bSYRINGES?\b/],
    ['PEN', /\bPENS?\b/],
    ['INHALER', /\bINHALER\b|\bEVOHALER\b|\bTURBUHALER\b/],
    ['SPRAY', /\bSPRAY\b/],
    ['EYE DROPS', /EYE\s*DROPS?|OPHTH/],
    ['EAR DROPS', /EAR\s*DROPS?/],
    ['DROPS', /\bDROPS?\b/],
    ['SYRUP', /\bSYRUP\b|\bELIXIR\b/],
    ['SUSPENSION', /\bSUSP\b|SUSPENSION/],
    ['EMULSION', /\bEMULSION\b/],
    ['SOLUTION', /\bSOLUTION\b|\bSOL\b/],
    ['CREAM', /\bCREAM\b/],
    ['OINTMENT', /\bOINT\b|OINTMENT/],
    ['GEL', /\bGEL\b/],
    ['LOTION', /\bLOTION\b/],
    ['POWDER', /\bPOWDER\b|\bGRANULES?\b/],
    ['PATCH', /\bPATCH(ES)?\b/]
  ];
  var SEMI_LIQUID = { SYRUP: 1, SUSPENSION: 1, EMULSION: 1, SOLUTION: 1, CREAM: 1, OINTMENT: 1, GEL: 1, LOTION: 1, DROPS: 1, 'EYE DROPS': 1, 'EAR DROPS': 1, SPRAY: 1, POWDER: 1 };
  var COUNTABLE = { TABLET: 1, CAPSULE: 1, 'ORODISPERSIBLE TABLET': 1, 'CHEWABLE TABLET': 1, EFFERVESCENT: 1, SUPPOSITORY: 1, SACHET: 1, AMPOULE: 1, VIAL: 1, 'PREFILLED SYRINGE': 1, PEN: 1, PATCH: 1 };
  var RELEASE_MR = /EXT\.?\s?REL|\b(SR|XR|XL|ER|MR|CR|CRT|SRT|RETARD|PROLONGED|SUSTAINED|EXTENDED|DEPOT|OROS|MODIFIED|LONG[\s-]?ACTING|CONTROLLED|SLOW[\s-]?RELEASE|TIMED)\b/;
  var RELEASE_DR = /(?:^|\s)(?:E\.?C\.?)(?=\s|$)|\b(?:ENTERIC|GASTRO[\s-]?RESISTANT|DELAYED|DR)\b/;

  function cleanName(raw) {
    return ' ' + String(raw || '').toUpperCase()
      .replace(/\((N\/A|CANCELLED)\)/g, ' ')
      .replace(/[()]/g, ' ')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ') + ' ';
  }
  function isCancelled(raw) { return /\(CANCELLED\)/i.test(String(raw || '')); }
  function isNA(raw) { return /\(N\/A\)/i.test(String(raw || '')); }

  function detectForm(n) {
    for (var i = 0; i < FORMS.length; i++) if (FORMS[i][1].test(n)) return FORMS[i][0];
    return '';
  }
  function detectRelease(n) {
    if (RELEASE_MR.test(n)) return 'MODIFIED';
    if (RELEASE_DR.test(n)) return 'DELAYED';
    return 'IMMEDIATE';
  }
  function num(s) { return parseFloat(String(s).replace(',', '.')); }
  function fmt(v) { return String(Math.round(v * 10000) / 10000); }

  /* Returns {strengths:[...], volumes:[...]} or null parts. */
  function parseAmounts(n, form) {
    var strengths = [], volumes = [];
    var re = /(\d+(?:[.,]\d+)?)\s*(MG|MCG|UG|IU|MEQ|MMOL|UNITS?|GM|G|%|ML|L)\b(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ML|L|GM|G|DOSE|ACT|H|HR)\b)?/g;
    var m, text = n;
    while ((m = re.exec(text)) !== null) {
      var v = num(m[1]), unit = m[2], den = m[4], dv = m[3] ? num(m[3]) : 1;
      if (unit === '%') { strengths.push(fmt(v) + '%'); continue; }
      if (den) {
        if (unit === 'G' || unit === 'GM') { v = v * 1000; unit = 'MG'; }
        if (unit === 'UG') unit = 'MCG';
        strengths.push(fmt(v) + (unit.indexOf('UNIT') === 0 ? 'IU' : unit) + '/' + fmt(dv) + den.replace('HR', 'H').replace('GM', 'G'));
        continue;
      }
      if (unit === 'ML' || unit === 'L') { volumes.push(fmt(unit === 'L' ? v * 1000 : v) + 'ML'); continue; }
      if (unit === 'G' || unit === 'GM') {
        if (SEMI_LIQUID[form]) volumes.push(fmt(v) + 'G'); else strengths.push(fmt(v * 1000) + 'MG');
        continue;
      }
      if (unit === 'UG') unit = 'MCG';
      strengths.push(fmt(v) + (unit.indexOf('UNIT') === 0 ? 'IU' : unit));
    }
    return { strengths: strengths, volumes: volumes };
  }

  function parsePack(n, form) {
    var ambiguous = /\d+\s*[*xX]\s*\d+\s*(?:F\.?C\.?\s*)?(?:TABS?|TABLETS?|CAPS?|CAPSULES?|AMPS?|VIALS?|SACHETS?|SUPPS?)/.test(n);
    if (ambiguous) return { count: null, ambiguous: true };
    var m = n.match(/(\d+)\s*(?:(?:F\.?C\.?|FILM[\s-]?COATED|COATED|SCORED|ORO[\s-]?DISPERSIBLE|CHEWABLE|CHEW\.?|EFFERVESCENT|EFF\.?|E\.?C\.?|SR|XR|XL|ER|MR|EXT\.?|REL\.?|I\.?V\.?|I\.?M\.?|S\.?C\.?|[\/])\s*)*(?:TABS?|TABLETS?|CAPS?|CAPSULES?|AMPS?|AMPOULES?|VIALS?|SUPPS?|SUPPOSITORIES|SACHETS?|LOZENGES?|PATCH(?:ES)?|PENS?|SYRINGES?)(?![A-Z])/);
    return { count: m ? parseInt(m[1], 10) : null, ambiguous: false };
  }

  /* Parse one record. Returns {ok:false, reason} or {ok:true, ...spec}. */
  function parse(drug) {
    if (!drug || drug._custom) return { ok: false, reason: 'custom' };
    var rawName = String(drug.commercial_name_en || '');
    if (isCancelled(rawName)) return { ok: false, reason: 'cancelled' };
    var sci = String(drug.scientific_name || '');
    var ing = sci.split('+').map(map.normalizeIngredient).filter(Boolean);
    if (!ing.length) return { ok: false, reason: 'ingredient' };
    ing = ing.slice().sort();
    var route = String(drug.route || '').toUpperCase();
    if (!route || route === 'UNKNOWN') return { ok: false, reason: 'route' };
    var n = cleanName(rawName);
    var form = detectForm(n);
    if (!form) return { ok: false, reason: 'form' };
    var amounts = parseAmounts(n, form);
    if (!amounts.strengths.length) return { ok: false, reason: 'strength' };
    var pack = parsePack(n, form);
    var volKey = amounts.volumes.join(',');
    if (COUNTABLE[form] && pack.count === null && !volKey && !pack.ambiguous) {
      return { ok: false, reason: 'pack' };
    }
    if (SEMI_LIQUID[form] && !volKey) return { ok: false, reason: 'pack' };
    if (pack.ambiguous && !volKey) {
      /* "20*10 TABS": two numbers, meaning not verifiable. Allowed to match on the
         exact same text only, never turned into a per-unit price. */
    }
    var packKey = pack.ambiguous
      ? 'RAW:' + (n.match(/\d+\s*[*xX]\s*\d+/) || [''])[0].replace(/\s/g, '')
      : (pack.count === null ? '?' : String(pack.count)) + '|' + volKey;
    var price = Number(drug.price_egp);
    return {
      ok: true,
      ingredientKey: ing.join('+'),
      route: route,
      form: form,
      release: detectRelease(n),
      strengthKey: amounts.strengths.slice().sort().join(';'),
      strengths: amounts.strengths,
      packKey: packKey,
      count: pack.count,
      volumeKey: volKey,
      price: isFinite(price) && price > 0 ? price : null,
      notMarketed: isNA(rawName)
    };
  }
  function specKey(s) {
    return [s.ingredientKey, s.route, s.form, s.release, s.strengthKey].join('||');
  }

  function buildIndex(drugs) {
    var index = new Map(), specs = new Map();
    for (var i = 0; i < drugs.length; i++) {
      var d = drugs[i], s = parse(d);
      specs.set(d, s);
      if (!s.ok) continue;
      var k = specKey(s);
      var bucket = index.get(k);
      if (!bucket) { bucket = []; index.set(k, bucket); }
      bucket.push(d);
    }
    return { index: index, specs: specs };
  }

  /* Compare one drug with its same-spec group. Returns {status, rows[], ...}. */
  function compare(drug, built) {
    var spec = built.specs.get(drug) || parse(drug);
    if (!spec.ok) return { status: 'unparsed', reason: spec.reason, rows: [] };
    var group = built.index.get(specKey(spec)) || [];
    var rows = [];
    for (var i = 0; i < group.length; i++) {
      var other = group[i];
      if (other === drug) continue;
      var o = built.specs.get(other);
      var basis = null, label = '', value = null, same = false;
      if (spec.price !== null && o.price !== null) {
        if (o.packKey === spec.packKey) {
          basis = 'pack'; value = o.price; same = true;
        } else if (spec.count && o.count && o.volumeKey === spec.volumeKey && spec.packKey.indexOf('RAW:') !== 0 && o.packKey.indexOf('RAW:') !== 0) {
          basis = 'unit'; value = o.price / o.count;
        }
      }
      rows.push({ drug: other, spec: o, basis: basis, comparable: value, samePack: same });
    }
    var self = { basis: 'pack', value: spec.price };
    var selfUnit = spec.count && spec.price !== null ? spec.price / spec.count : null;
    rows.sort(function (a, b) {
      var av = a.basis === 'pack' ? a.comparable : (a.basis === 'unit' ? a.comparable * (spec.count || 1) : Infinity);
      var bv = b.basis === 'pack' ? b.comparable : (b.basis === 'unit' ? b.comparable * (spec.count || 1) : Infinity);
      return av - bv;
    });
    rows.forEach(function (r) {
      if (r.basis === 'pack' && spec.price !== null) r.saving = spec.price - r.comparable;
      else if (r.basis === 'unit' && selfUnit !== null) r.savingPerUnit = selfUnit - r.comparable;
    });
    return { status: rows.length ? 'ok' : 'none', spec: spec, rows: rows, self: self, selfUnit: selfUnit };
  }

  var api = { parse: parse, specKey: specKey, buildIndex: buildIndex, compare: compare, cleanName: cleanName };
  root.DawayaSameSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
