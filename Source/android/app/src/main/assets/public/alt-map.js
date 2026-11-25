/* Drugcopeia: ingredient spelling map for the same-spec price comparison.
 *
 * Two product records are only compared when their active ingredients are the
 * same set after this map is applied. The map holds pure spelling or naming
 * differences for the SAME molecule (INN versus USAN or British names).
 * It never merges different salts or esters: "diclofenac potassium" and
 * "diclofenac sodium" stay different, because the strength then refers to a
 * different salt. A mismatch is therefore visible here and fixable here.
 *
 * Edit this file, bump the revision (scripts/set-revision.mjs) and rebuild.
 */
(function (root) {
  'use strict';
  var WORD_SYNONYMS = {
    SULFATE: 'SULPHATE',
    SULFATES: 'SULPHATE',
    SULPHATES: 'SULPHATE'
  };
  var INGREDIENT_SYNONYMS = {
    'ACETAMINOPHEN': 'PARACETAMOL',
    'CHLORPHENAMINE': 'CHLORPHENIRAMINE',
    'SALBUTAMOL': 'ALBUTEROL',
    'ADRENALINE': 'EPINEPHRINE',
    'NORADRENALINE': 'NOREPINEPHRINE',
    'LIGNOCAINE': 'LIDOCAINE',
    'FRUSEMIDE': 'FUROSEMIDE',
    'GLIBENCLAMIDE': 'GLYBURIDE',
    'PETHIDINE': 'MEPERIDINE',
    'GLYCERYL TRINITRATE': 'NITROGLYCERIN',
    'RIFAMPICIN': 'RIFAMPIN',
    'CICLOSPORIN': 'CYCLOSPORINE',
    'AMOXYCILLIN': 'AMOXICILLIN',
    'CEPHALEXIN': 'CEFALEXIN'
  };
  function normalizeIngredient(raw) {
    var s = String(raw || '').toUpperCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/[^A-Z0-9\s.\-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.split(' ').map(function (w) { return WORD_SYNONYMS[w] || w; }).join(' ');
    return INGREDIENT_SYNONYMS[s] || s;
  }
  root.DawayaAltMap = { normalizeIngredient: normalizeIngredient, INGREDIENT_SYNONYMS: INGREDIENT_SYNONYMS, WORD_SYNONYMS: WORD_SYNONYMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DawayaAltMap;
})(typeof window !== 'undefined' ? window : globalThis);
