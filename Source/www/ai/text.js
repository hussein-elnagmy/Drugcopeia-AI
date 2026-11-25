/*
 * Dawaya AI — text layer shared by retrieval and the safety guards.
 *
 * Every matcher in the assistant runs both the stored text and the query through
 * normalize(), so an Arabic keyword written with tashkeel, with أ or آ, with ى or ة
 * still matches input typed a different way. Fuzzy matching and the Arabic to Latin
 * fold cover Egyptian trade names, which are usually spelled phonetically.
 *
 * Exposed as DawayaAIText (window in the app, globalThis under the test runner).
 */
(function (global) {
  'use strict';

  const TASHKEEL = /[\u064B-\u0652\u0670\u0653-\u0655\u0640]/g;
  const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
  const DIGIT_MAP = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  const ARABIC_LETTER_FOLD = [
    [/[أإآٱ]/g, 'ا'],
    [/ؤ/g, 'و'],
    [/ئ/g, 'ي'],
    [/ى/g, 'ي'],
    [/ة/g, 'ه'],
    [/ک/g, 'ك']
  ];
  const PUNCTUATION = /[^\p{L}\p{N}]+/gu;
  const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF]/;

  /* Latin fold used when an Arabic-only name has to meet a Latin index. */
  const TRANSLITERATION = {
    ا: '', أ: 'a', إ: 'i', آ: 'aa', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
    د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
    ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
    ه: 'h', و: 'w', ي: 'y', ى: 'y', ء: '', ة: 'a', ئ: 'y', ؤ: 'w', ڤ: 'v', گ: 'g', پ: 'p', چ: 'ch'
  };

  /* Vowels a reader never writes; dropped before fuzzy comparison so "amol" and "amolol" behave. */
  const LATIN_NOISE = /[aeiouy]+/g;

  function stripTashkeel(value) {
    return String(value).replace(TASHKEEL, '');
  }

  function toAsciiDigits(value) {
    return String(value).replace(ARABIC_DIGITS, char => DIGIT_MAP[char] || char);
  }

  function foldArabicLetters(value) {
    let out = String(value);
    for (const [pattern, replacement] of ARABIC_LETTER_FOLD) out = out.replace(pattern, replacement);
    return out;
  }

  /* The one normalization every matcher uses: NFKC, tashkeel, letter folds, digits, case. */
  function normalize(value) {
    const text = String(value == null ? '' : value);
    let out = typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
    out = stripTashkeel(out);
    out = foldArabicLetters(out);
    out = toAsciiDigits(out);
    out = out.replace(/[،؛]/g, ',').replace(/[؟।]/g, ' ');
    out = out.toLowerCase();
    return out.replace(/\s+/g, ' ').trim();
  }

  /* Aggressive form for matching inside longer names: also drops non-letters. */
  function compact(value) {
    return normalize(value).replace(PUNCTUATION, '');
  }

  /* Consonant frame of a trade name: article dropped and long vowels removed, so "البنادول"
     and "بانادول" both read as "بندل". */
  function nameSkeleton(value) {
    return normalize(value).replace(/^ال/, '').replace(/[اوي]/g, '');
  }

  function tokenize(value) {
    const parts = normalize(value).split(PUNCTUATION);
    const tokens = [];
    for (const part of parts) {
      if (!part) continue;
      tokens.push(part);
      for (const variant of stemVariants(part)) {
        if (variant && variant !== part) tokens.push(variant);
      }
    }
    return tokens;
  }

  /* Extra surface forms of one token. They widen recall; BM25 keeps them cheap because rare stems carry little weight. */
  function stemVariants(token) {
    const out = [];
    if (token.length >= 5 && token.startsWith('ال') && ARABIC_RANGE.test(token)) out.push(token.slice(2));
    if (token.length >= 4 && ARABIC_RANGE.test(token)) {
      if (token.endsWith('ات')) out.push(token.slice(0, -2));
      if (token.endsWith('ين')) out.push(token.slice(0, -2));
      if (token.endsWith('ون')) out.push(token.slice(0, -2));
      if (token.endsWith('ها') && token.length >= 5) out.push(token.slice(0, -2));
      if (token.endsWith('ه') && token.length >= 5) out.push(token.slice(0, -1));
      if (token.endsWith('ا') && token.length >= 5) out.push(token.slice(0, -1));
    }
    if (token.length >= 5 && !ARABIC_RANGE.test(token)) {
      if (token.endsWith('s')) out.push(token.slice(0, -1));
      if (token.endsWith('es')) out.push(token.slice(0, -2));
      if (token.endsWith('ing')) out.push(token.slice(0, -3));
      if (token.endsWith('ed')) out.push(token.slice(0, -2));
    }
    return out;
  }

  function transliterate(value) {
    const text = foldArabicLetters(stripTashkeel(toAsciiDigits(value)));
    let out = '';
    for (const char of text) {
      if (TRANSLITERATION[char] !== undefined) out += TRANSLITERATION[char];
      else if (/[0-9]/.test(char)) out += char;
      else if (/\s|[.\-_]/.test(char)) out += ' ';
    }
    return out.toLowerCase().replace(/\s+/g, '').replace(/(.)\1{2,}/g, '$1$1');
  }

  function isArabic(value) {
    return ARABIC_RANGE.test(String(value || ''));
  }

  function arabicRatio(value) {
    const text = normalize(value).replace(/\s+/g, '');
    if (!text.length) return 0;
    let arabic = 0;
    for (const char of text) if (ARABIC_RANGE.test(char)) arabic += 1;
    return arabic / text.length;
  }

  function latinFold(value) {
    return normalize(value).replace(PUNCTUATION, '').replace(LATIN_NOISE, '');
  }

  /* Bounded Levenshtein: stops once the distance passes maxDistance so long names stay cheap. */
  function editDistance(left, right, maxDistance) {
    const a = String(left || ''), b = String(right || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const limit = maxDistance === undefined ? Math.max(a.length, b.length) : maxDistance;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowBest = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
        if (current[j] < rowBest) rowBest = current[j];
      }
      if (rowBest > limit) return limit + 1;
      previous = current;
    }
    const distance = previous[b.length];
    return distance > limit ? limit + 1 : distance;
  }

  /* Similarity in 0..1. Prefix-heavy because a truncated trade name ("panad") is the common case. */
  function fuzzyScore(query, candidate) {
    const a = String(query || ''), b = String(candidate || '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (b.startsWith(a) || a.startsWith(b)) {
      /* A three-letter prefix ("pan") matching a whole query ("panadl") is weaker evidence
         than the brand token that shares five letters with it, so the ratio carries weight. */
      const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
      return Math.min(1, 0.6 + ratio * 0.4);
    }
    const limit = Math.max(1, Math.ceil(Math.max(a.length, b.length) * 0.34));
    const distance = editDistance(a, b, limit);
    if (distance > limit) return 0;
    const best = 1 - distance / Math.max(a.length, b.length);
    return best < 0.55 ? 0 : best;
  }

  /* Latin vowels and the Arabic letters that stand in for them are dropped, because Arabic
     spelling omits short vowels: "بنادول" leaves "bndl" and "panadol" leaves "pndl". */
  const CONSONANT_NOISE = /[aeiouwy]/g;

  function consonants(value) {
    const folded = compact(transliterate(value) || value).replace(CONSONANT_NOISE, '');
    return folded.length >= 3 ? folded : compact(transliterate(value) || value);
  }

  /* One score for a query token against any stored name, including the Arabic-to-Latin fold. */
  function nameTokenScore(queryToken, storedToken) {
    const direct = fuzzyScore(queryToken, storedToken);
    if (direct === 1) return 1;
    if (isArabic(storedToken) !== isArabic(queryToken)) {
      return Math.max(direct, fuzzyScore(consonants(queryToken), consonants(storedToken)) * 0.95);
    }
    if (isArabic(queryToken)) {
      /* Long vowels are what readers vary most: "بنادول" is "بانادول", but "بينادول" is a
         different name, so the transliteration keeps و/ي instead of collapsing them away. */
      const ortho = fuzzyScore(compact(transliterate(queryToken)), compact(transliterate(storedToken)));
      return Math.max(direct, ortho);
    }
    return direct;
  }

  function matchPattern(pattern, text) {
    const raw = String(pattern == null ? '' : pattern);
    if (!raw) return false;
    const haystack = String(text == null ? '' : text);
    if (raw.startsWith('re:')) {
      try {
        return new RegExp(raw.slice(3), 'i').test(haystack);
      } catch (_) {
        return false;
      }
    }
    return normalize(haystack).includes(normalize(raw));
  }

  function matchAny(patterns, text) {
    for (const pattern of patterns || []) if (matchPattern(pattern, text)) return pattern;
    return null;
  }

  /* Number + unit pairs found in a text. The output guard compares these against the retrieved records.
     Arabic writes small counts as words ("قرصين مرتين"), and an answer in that form still makes a numeric
     claim, so the count words are folded into digits before extraction. */
  const VERBAL_NUMBERS = {
    'نص': 0.5, 'نصف': 0.5, 'واحد': 1, 'واحدة': 1, 'واحده': 1, 'وحدة': 1, 'اثنتين': 2, 'اتنين': 2, 'اثنين': 2,
    'تلاتة': 3, 'تلاث': 3, 'ثلاث': 3, 'ثلاثة': 3, 'اربعة': 4, 'أربعة': 4, 'خمسة': 5, 'ستة': 6, 'سبعة': 7,
    'تمانية': 8, 'ثمانية': 8, 'تسعة': 9, 'عشرة': 10, 'عشر': 10, 'مرتين': 2, 'مرة': 1, 'تلات': 3
  };
  const DUAL_UNIT_STEMS = ['قرص', 'حب', 'كبسول', 'ساعت', 'يوم', 'ليل', 'حقن', 'مل', 'جرام', 'لتر', 'نقط', 'علب', 'جرع', 'لاصق', 'بخاخ', 'تحميل', 'كيس', 'امبول', 'قطر', 'مرهم'];
  const DUAL_PATTERN = new RegExp(`(^|[^\\p{L}\\d])(${DUAL_UNIT_STEMS.join('|')})(تين|ين)(?=$|[^\\p{L}\\d])`, 'gu');
  const COUNT_WORD = Object.keys(VERBAL_NUMBERS)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  function foldVerbalNumbers(value) {
    const normalized = normalize(value);
    let out = normalized.replace(DUAL_PATTERN, (_all, edge, stem) => `${edge}2 ${stem} `);
    out = out.replace(new RegExp(`(^|[^\\p{L}\\d])(${COUNT_WORD})(?=$|[^\\p{L}\\d])`, 'gu'), (_all, edge, word) => `${edge}${VERBAL_NUMBERS[word]} `);
    return out.replace(/\s+/g, ' ').trim();
  }

  function numericClaims(text) {
    const source = foldVerbalNumbers(text).replace(/،/g, ',');
    const claims = [];
    const pattern = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|g|gram|grams|ml|l|iu|meq|mmol|tabs?|tablets?|capsules?|sachets?|suppositories|ampoules?|vials?|patches?|drops?|sprays?|ملجم|ميكروجرام|جرام|مل|لتر|وحدة دولية|وحدة|قرص|أقراص|كبسولة|كبسولات|كيس|اكياس|شراب|تحاميل|تحميلة|حقنة|أمبولة|لاصقة|بخاخة|نقطة|نقاط|ساعة|ساعات|يوم|أيام|يومين|أسبوع|أسابيع|شهر|شهور|سنه|سنة|درجه|درجة|مرات|%)?/g;
    let match;
    while ((match = pattern.exec(source))) {
      const value = match[1].replace(/,/g, '.');
      claims.push({
        raw: match[0].trim(),
        value: Number(value),
        unit: (match[2] || '').trim(),
        index: match.index
      });
    }
    return claims;
  }

  function extractDrugNames(text) {
    return normalize(text).split(PUNCTUATION).filter(token => token.length >= 3 && /[a-z\u0600-\u06ff]/.test(token));
  }

  function truncate(value, maxChars) {
    const text = String(value == null ? '' : value);
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  global.DawayaAIText = {
    normalize,
    compact,
    nameSkeleton,
    tokenize,
    stemVariants,
    transliterate,
    latinFold,
    isArabic,
    arabicRatio,
    stripTashkeel,
    foldArabicLetters,
    editDistance,
    fuzzyScore,
    nameTokenScore,
    matchPattern,
    matchAny,
    foldVerbalNumbers,
    numericClaims,
    extractDrugNames,
    truncate,
    ARABIC_RANGE
  };
})(typeof window !== 'undefined' ? window : globalThis);
