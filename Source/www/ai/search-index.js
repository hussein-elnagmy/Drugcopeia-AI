/*
 * Dawaya AI - full-text index used by the offline retrieval step.
 *
 * Same contract as SQLite FTS5: a tokenizer, an inverted index, per-field weights and BM25
 * ranking. tools/ai/build_knowledge_index.py builds a real FTS5 table for the shipped
 * documents and exports the JSON this file reads, so the two are checked against each other
 * instead of drifting apart. The runtime stays dependency-free: no WebAssembly SQLite inside
 * a 4 GB WebView.
 *
 * Exposed as DawayaAISearchIndex.
 */
(function (global) {
  'use strict';

  const T = () => global.DawayaAIText;
  const SEP = '@';
  /* Form and price words sit in thousands of trade names ("NET PRICE", "30 TABLETS"), so they
     are never treated as the rare brand token that decides ranking. */
  const NAME_NOISE = new Set([
    'price', 'prices', 'net', 'hospital', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps',
    'capsule', 'capsules', 'syrup', 'cream', 'gel', 'drop', 'drops', 'spray', 'sachet', 'sachets',
    'vial', 'amp', 'ampoule', 'supp', 'film', 'coated', 'oral', 'infusion', 'injection', 'susp',
    'suspension', 'lotion', 'ointment', 'solution', 'powder', 'unit', 'units', 'er', 'sr', 'xr'
  ]);

  const DEFAULTS = {
    k1: 1.2,
    b: 0.75,
    minFuzzyScore: 0.62,
    fuzzy: true,
    phoneticScore: 0.8,
    nameBoostWeight: 24,
    nameBoostMaxDf: 250
  };

  function createIndex(options) {
    const settings = { ...DEFAULTS, ...(options || {}) };
    const fieldSpecs = (settings.fields || []).map(field => ({
      name: String(field.name),
      weight: Number(field.weight) || 1,
      nameish: Boolean(field.nameish)
    }));
    const docs = [];
    const postings = new Map();
    const fieldLengths = new Map();
    const nameBuckets = new Map();
    /* Trade names are written with or without the article and with different long vowels
       ("بنادول" / "البنادول" / "بانادول"); the skeleton map makes those meet. */
    const nameSkeletons = new Map();
    /* How many documents carry a name token. A brand ("panadol", 13 rows) is rare and must
       outrank the generic "500 mg tablets" rows that share more words with the question. */
    const nameTokenDf = new Map();
    let built = false;
    let totalLength = 0;

    function postingKey(field, token) {
      return field + SEP + token;
    }

    function add(entry) {
      const record = {
        id: String(entry.id),
        record: entry.record,
        meta: entry.meta || null,
        fields: {},
        lengths: {},
        nameTokens: []
      };
      for (const spec of fieldSpecs) {
        const raw = entry.fields ? entry.fields[spec.name] : entry[spec.name];
        const tokens = T().tokenize(raw || '');
        record.fields[spec.name] = tokens;
        record.lengths[spec.name] = tokens.length || 1;
        if (spec.nameish) {
          const seen = new Set();
          for (const token of tokens) {
            if (token.length < 3) continue;
            record.nameTokens.push(token);
            bucketPush(nameBuckets, token, docs.length);
            bucketPush(nameSkeletons, token, docs.length, tokenSkeleton(token));
            if (!seen.has(token)) {
              seen.add(token);
              nameTokenDf.set(token, (nameTokenDf.get(token) || 0) + 1);
            }
          }
        }
      }
      docs.push(record);
      return docs.length - 1;
    }

    function bucketKey(token) {
      return token.slice(0, 3);
    }

    function tokenSkeleton(token) {
      return T().nameSkeleton(token);
    }

    function bucketPush(buckets, token, docPosition, key) {
      const bucket = key === undefined ? bucketKey(token) : key;
      if (!bucket) return;
      let list = buckets.get(bucket);
      if (!list) {
        list = new Map();
        buckets.set(bucket, list);
      }
      const existing = list.get(token);
      if (existing === undefined) list.set(token, docPosition);
    }

    function build() {
      postings.clear();
      fieldLengths.clear();
      totalLength = 0;
      for (let position = 0; position < docs.length; position += 1) {
        const doc = docs[position];
        for (const spec of fieldSpecs) {
          const tokens = doc.fields[spec.name] || [];
          if (!tokens.length) continue;
          const counts = new Map();
          for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
          const average = (fieldLengths.get(spec.name) || 0) + tokens.length;
          fieldLengths.set(spec.name, average);
          totalLength += tokens.length;
          for (const [token, tf] of counts) {
            const key = postingKey(spec.name, token);
            let list = postings.get(key);
            if (!list) {
              list = [];
              postings.set(key, list);
            }
            list.push([position, tf]);
          }
        }
      }
      for (const [field, sum] of fieldLengths) fieldLengths.set(field, sum / Math.max(1, docs.length));
      built = true;
      return api;
    }

    function queryTerms(query) {
      const tokens = T().tokenize(query);
      const seen = new Set();
      const terms = [];
      for (const token of tokens) {
        if (seen.has(token) || token.length < 2) continue;
        seen.add(token);
        terms.push(token);
      }
      return terms;
    }

    function idf(documentFrequency, count) {
      return Math.log(1 + (count - documentFrequency + 0.5) / (documentFrequency + 0.5));
    }

    function scoreDoc(tf, length, spec, documentFrequency) {
      if (!tf) return 0;
      const average = fieldLengths.get(spec.name) || length || 1;
      const norm = settings.k1 * (1 - settings.b + settings.b * (length / average));
      return spec.weight * idf(documentFrequency, docs.length) * ((tf * (settings.k1 + 1)) / (tf + norm));
    }

    /* Every document whose name field carries the token, not only the first one that registered it. */
    function positionsForNameToken(token) {
      const positions = [];
      for (const spec of fieldSpecs) {
        if (!spec.nameish) continue;
        const list = postings.get(postingKey(spec.name, token));
        if (!list) continue;
        for (const entry of list) positions.push(entry[0]);
      }
      return positions;
    }

    /* Prefix-blocked fuzzy pass over name fields: catches "panad" for Panadol and a
       Latin-only query against an Arabic trade name. A skeleton match ("بنادول" against
       "بانادول") has no character-level score to earn, so it gets a fixed phonetic score. */
    function fuzzyNameScores(term) {
      const scores = new Map();
      if (!settings.fuzzy || term.length < 4) return scores;
      const candidates = new Map();
      const consider = (token, phonetic) => {
        const current = candidates.get(token);
        if (!current || (phonetic && !current.phonetic)) candidates.set(token, { phonetic });
      };
      const keys = new Set([bucketKey(term)]);
      const folded = T().compact(T().transliterate(term)) || T().compact(term);
      if (folded.length >= 4) keys.add(bucketKey(folded));
      for (const key of keys) {
        const bucket = nameBuckets.get(key);
        if (!bucket) continue;
        for (const [token] of bucket) consider(token, false);
      }
      const skeleton = tokenSkeleton(term);
      if (skeleton.length >= 4) {
        const bucket = nameSkeletons.get(skeleton);
        if (bucket) for (const [token] of bucket) consider(token, true);
      }
      for (const [token, info] of candidates) {
        const phonetic = info.phonetic && tokenSkeleton(term) === tokenSkeleton(token);
        const score = phonetic
          ? Math.max(Number(settings.phoneticScore) || 0.8, T().nameTokenScore(term, token))
          : T().nameTokenScore(term, token);
        if (score < settings.minFuzzyScore) continue;
        for (const position of positionsForNameToken(token)) {
          scores.set(position, Math.max(scores.get(position) || 0, score));
        }
      }
      return scores;
    }

    /*
     * Egyptian trade names are written with one letter changed as often as they are written
     * with a long vowel added ("لازيكس" for "لاسيكس", "أموكسيسيلين" for "أموكسيسيللين"), and
     * neither the prefix buckets nor the vowel skeleton catch that. When a term has no usable
     * candidate at all, the unique name tokens are scanned once at edit distance one. The scan
     * runs on short lists and only for a term that found nothing, so it stays cheap.
     */
    function nearMissScores(term) {
      const scores = new Map();
      if (!settings.fuzzy || term.length < 5) return scores;
      const arabic = T().isArabic(term);
      for (const token of nameTokenDf.keys()) {
        if (token.length < 4 || T().isArabic(token) !== arabic) continue;
        if (Math.abs(token.length - term.length) > 1) continue;
        if (T().editDistance(term, token, 1) > 1) continue;
        const score = 1 - 1 / Math.max(term.length, token.length);
        if (score < settings.minFuzzyScore) continue;
        for (const position of positionsForNameToken(token)) {
          scores.set(position, Math.max(scores.get(position) || 0, score));
        }
      }
      return scores;
    }

    function search(query, searchOptions) {
      if (!built) build();
      const opts = searchOptions || {};
      const limit = Number(opts.limit) || 10;
      const minScore = Number(opts.minScore) || 0;
      const terms = queryTerms(query);
      if (!terms.length) return [];
      const totals = new Map();
      const matched = new Map();

      const bump = (position, value, detail) => {
        totals.set(position, (totals.get(position) || 0) + value);
        const set = matched.get(position) || new Set();
        set.add(detail);
        matched.set(position, set);
      };

      for (const term of terms) {
        for (const spec of fieldSpecs) {
          const list = postings.get(postingKey(spec.name, term));
          if (!list || !list.length) continue;
          const documentFrequency = list.length;
          for (const entry of list) {
            const doc = docs[entry[0]];
            const value = scoreDoc(entry[1], doc.lengths[spec.name] || 1, spec, documentFrequency);
            if (value > 0) bump(entry[0], value, `${spec.name}:${term}`);
          }
        }
      }

      /* A rare name token is the strongest signal a question carries: "panadol" appears in
         thirteen rows while "tablets" appears in thousands, so the brand must not lose to a
         generic strength-and-form match on the rest of the words. */
      for (const term of terms) {
        const df = nameTokenDf.get(term) || 0;
        if (!df || df > settings.nameBoostMaxDf || NAME_NOISE.has(term)) continue;
        const boost = settings.nameBoostWeight * idf(df, docs.length);
        for (const spec of fieldSpecs) {
          if (!spec.nameish) continue;
          const list = postings.get(postingKey(spec.name, term));
          if (!list) continue;
          for (const entry of list) bump(entry[0], boost, `nameBoost:${term}`);
        }
      }

      const nearPositions = new Set();
      if (settings.fuzzy) {
        for (const term of terms) {
          const fuzzy = fuzzyNameScores(term);
          let bestFuzzy = 0;
          for (const score of fuzzy.values()) if (score > bestFuzzy) bestFuzzy = score;
          /* A perfect name hit needs no typo pass; anything less might be one letter away
             from the name the user meant. */
          const near = bestFuzzy >= 0.95 ? new Map() : nearMissScores(term);
          const apply = (position, score, detail, isNear) => {
            if (totals.has(position)) return;
            bump(position, score, detail);
            if (isNear) nearPositions.add(position);
          };
          for (const [position, score] of fuzzy) {
            const nearScore = near.get(position) || 0;
            const nearAmount = nearScore ? (nearScore - 0.05) * 10 : 0;
            if (nearAmount > score * 6) apply(position, nearAmount, `near:${term}`, true);
            else apply(position, score * 6, `fuzzy:${term}`, false);
          }
          for (const [position, score] of near) {
            if (fuzzy.has(position)) continue;
            /* One wrong letter is a typed name, not a coincidence, so it scores above the
               three-letter prefix matches that reach the same floor. */
            apply(position, (score - 0.05) * 10, `near:${term}`, true);
          }
        }
      }

      /* Name evidence comes from the words the user actually typed. The stem variants the
         tokenizer adds for recall turn "كلاريتين" into "كلاريت", whose skeleton also fits an
         unrelated "كليارتي", so they are not allowed to claim a name match. */
      const nameTerms = T().normalize(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length >= 4)
        .map(word => ({ compact: T().compact(word), skeleton: tokenSkeleton(word) }));
      const results = [];
      for (const [position, score] of totals) {
        const doc = docs[position];
        let finalScore = score;
        let exactHit = nearPositions.has(position);
        /* One bonus per document: a row that carries the typed name earns it once, no matter
           how many of its tokens line up with the question. */
        let bonus = 0;
        for (const term of nameTerms) {
          if (!term.compact) continue;
          for (const token of doc.nameTokens) {
            const compactToken = T().compact(token);
            if (!compactToken) continue;
            if (compactToken === term.compact) {
              bonus = 40;
              exactHit = true;
              break;
            }
            /* "بنادول" and "بانادول" are the same trade name written two ways. The skeleton
               throws away so much that an ordinary word ("للبول") can share one with a brand
               ("ليليبيل"), so the two spellings must still be close to the same length. */
            if (term.skeleton && tokenSkeleton(token) === term.skeleton
              && Math.min(compactToken.length, term.compact.length) / Math.max(compactToken.length, term.compact.length) >= 0.75) {
              bonus = Math.max(bonus, 24);
              exactHit = true;
            }
            /* A token that is most of the typed word ("بيتاديني" for "بيتادين") is the same
               name; a short fragment of a long word ("اموكس" for "اموكسيسيلين") is not. */
            const shorter = Math.min(compactToken.length, term.compact.length);
            const longer = Math.max(compactToken.length, term.compact.length);
            if (shorter >= 4 && shorter / longer >= 0.7
              && (compactToken.includes(term.compact) || term.compact.includes(compactToken))) {
              bonus = Math.max(bonus, 12);
              exactHit = true;
            }
          }
          if (bonus === 40) break;
        }
        finalScore += bonus;
        results.push({
          id: doc.id,
          record: doc.record,
          meta: doc.meta,
          score: finalScore,
          matched: [...(matched.get(position) || [])],
          exactName: exactHit
        });
      }
      return results
        .filter(item => item.score >= minScore)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit);
    }

    function get(id) {
      for (const doc of docs) if (doc.id === String(id)) return doc;
      return null;
    }

    /* True when the token is part of a name field (a drug or document title), not of body text.
       The output guard uses this to tell a real medicine name from an ordinary Arabic word. */
    const nameishFields = fieldSpecs.filter(spec => spec.nameish).map(spec => spec.name);

    function lookupNameToken(token) {
      if (!built) build();
      const value = String(token || '');
      if (!value) return null;
      for (const field of nameishFields) {
        const list = postings.get(postingKey(field, value));
        if (list && list.length) {
          const doc = docs[list[0][0]];
          return { id: doc.id, record: doc.record, field };
        }
      }
      const bucket = nameBuckets.get(bucketKey(value));
      if (bucket && bucket.has(value)) {
        const doc = docs[bucket.get(value)];
        return { id: doc.id, record: doc.record, field: 'fuzzy' };
      }
      /* Same consonants after dropping the article and long vowels: "البنادول" meets "بانادول". */
      const skeleton = tokenSkeleton(value);
      const skeletonBucket = skeleton.length >= 4 ? nameSkeletons.get(skeleton) : null;
      if (skeletonBucket) {
        for (const [, position] of skeletonBucket) {
          const doc = docs[position];
          return { id: doc.id, record: doc.record, field: 'skeleton' };
        }
      }
      return null;
    }

    const api = {
      add,
      build,
      search,
      get,
      lookupNameToken,
      has: () => built,
      clear() {
        docs.length = 0;
        postings.clear();
        fieldLengths.clear();
        nameBuckets.clear();
        nameSkeletons.clear();
        nameTokenDf.clear();
        built = false;
      },
      stats() {
        return {
          documents: docs.length,
          postings: postings.size,
          fields: fieldSpecs.map(spec => spec.name),
          averageLength: docs.length ? totalLength / docs.length : 0
        };
      }
    };
    return api;
  }

  global.DawayaAISearchIndex = { createIndex, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
