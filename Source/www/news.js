/*
 * Drugcopeia — daily health news from official publishers.
 *
 * Endpoints, all of which send `Access-Control-Allow-Origin: *` so the
 * packaged WebViews can call them directly with no proxy and no server:
 *   WHO    news hub (json, with each item's own page read for its summary),
 *          feature stories and the Arabic service                     (rss)
 *   FDA    drug enforcement reports                       (openFDA json)
 *   NLM    latest PubMed abstracts                        (eutils json + xml)
 *
 * Only the headline and a trimmed summary are kept, and every card links back
 * to the publisher's own page — Drugcopeia never re-hosts or rewrites an article.
 * A snapshot of the same feeds ships as news.json so a first run with no
 * network still shows dated headlines.
 *
 * Exposed as DawayaNews.
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'dawaya-news-v1';
  var SNAPSHOT_URL = 'news.json';
  var TTL = 6 * 60 * 60 * 1000;
  var MAX_ITEMS = 40;
  var MAX_AGE_DAYS = 120;

  var WHO_FEEDS = [
    { source: 'whofeature', lang: 'en', feed: 'feature-stories-english.xml', limit: 8 },
    { source: 'whoar', lang: 'ar', feed: 'news-arabic.xml', limit: 8 }
  ];

  // WHO's English RSS has not been updated since January, but the hub behind
  // the news page is current and sends `Access-Control-Allow-Origin: *`.
  var WHO_NEWS_API = 'https://www.who.int/api/hubs/newsitems'
    + '?sf_site=15210d59-ad60-47ff-a542-7ed76645f0c7&sf_provider=OpenAccessDataProvider&sf_culture=en'
    + '&$orderby=PublicationDateAndTime%20desc&$top=5'
    + '&$select=Title,ItemDefaultUrl,PublicationDateAndTime,Tag';

  var PUBMED_QUERY = '"drug therapy"[Title/Abstract] OR "medication"[Title/Abstract] OR '
    + '"diagnosis"[Title/Abstract] OR "treatment"[Title/Abstract]';

  var listeners = [];
  var cache = readCache();
  var snapshot = null;
  var snapshotRequest = null;
  var refreshing = null;

  function readCache() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCache(items) {
    cache = { fetchedAt: new Date().toISOString(), items: items };
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) {
      /* A full quota only costs the next cold start a refresh. */
    }
  }

  function notify() {
    listeners.forEach(function (listener) {
      try {
        listener(items());
      } catch (_) {
        /* a broken subscriber must not stop the others */
      }
    });
  }

  /*
     Every remote read goes through DawayaNet. The gate still refuses it in
     offline mode, refuses any host that is not in privacy.config.json, and
     strips cookies, referrer and identifiers. These three hosts are the ones
     the config lets the app reach on its own schedule rather than only after a
     press, because the home page now refreshes the headlines by itself.
  */
  function getText(url, timeoutMs) {
    var net = global.DawayaNet;
    if (!net || typeof net.request !== 'function') {
      return Promise.reject(new Error('privacy gate unavailable'));
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 20000) : 0;
    return net.request(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function stripHtml(value) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“')
      .replace(/&rdquo;/g, '”').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
      .replace(/&#(\d+);/g, function (_match, code) { return String.fromCharCode(Number(code)); })
      .replace(/\[1\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trim(value, limit) {
    var text = stripHtml(value);
    if (text.length <= limit) return text;
    var cut = text.slice(0, limit).lastIndexOf(' ');
    return text.slice(0, cut > 40 ? cut : limit).replace(/[\s,;:.]+$/, '') + '…';
  }

  function isoDate(value) {
    var match = /(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (match) return match[0];
    match = /(\d{4})(\d{2})(\d{2})/.exec(value || '');
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
    return '';
  }

  function rfcDate(value) {
    var parsed = Date.parse(value || '');
    if (isNaN(parsed)) return '';
    return new Date(parsed).toISOString().slice(0, 10);
  }

  function slugDate(link) {
    var match = /\/news\/item\/(\d{2})-(\d{2})-(\d{4})/.exec(link || '');
    return match ? match[3] + '-' + match[2] + '-' + match[1] : '';
  }

  function dayStamp(offsetDays) {
    var date = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return String(date.getUTCFullYear())
      + String(date.getUTCMonth() + 1).padStart(2, '0')
      + String(date.getUTCDate()).padStart(2, '0');
  }

  function tooOld(date) {
    if (!date) return false;
    var stamp = Date.parse(date + 'T00:00:00Z');
    if (isNaN(stamp)) return false;
    return Date.now() - stamp > MAX_AGE_DAYS * 86400000;
  }

  // A republished or mis-stamped page can carry tomorrow's date; anything more
  // than a day ahead would sit permanently at the top of the list.
  function tooNew(date) {
    if (!date) return false;
    var stamp = Date.parse(date + 'T00:00:00Z');
    if (isNaN(stamp)) return false;
    return stamp - Date.now() > 86400000;
  }

  function parseXml(text) {
    var doc = new global.DOMParser().parseFromString(text, 'text/xml');
    if (!doc || doc.getElementsByTagName('parsererror').length) throw new Error('bad xml');
    return doc;
  }

  function whoFeed(spec) {
    return getText('https://www.who.int/rss-feeds/' + spec.feed).then(function (text) {
      var doc = parseXml(text);
      var nodes = doc.getElementsByTagName('item');
      var out = [];
      // WHO's feed is not in release order, so every item is read first and the
      // newest ones are chosen afterwards; capping up front would return only
      // whatever happens to sit at the top of the file.
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var title = trim(node.querySelector('title') && node.querySelector('title').textContent, 150);
        var link = stripHtml(node.querySelector('link') && node.querySelector('link').textContent);
        if (!title || !link) continue;
        var summary = trim(node.querySelector('description') && node.querySelector('description').textContent, 230);
        if (!summary) continue;
        out.push({
          id: spec.source + ':' + link.replace(/\/$/, '').split('/').pop(),
          kind: 'news',
          source: spec.source,
          lang: spec.lang,
          title: title,
          summary: summary,
          url: link,
          date: slugDate(link) || rfcDate(node.querySelector('pubDate') && node.querySelector('pubDate').textContent)
        });
      }
      out.sort(function (left, right) {
        return String(right.date || '').localeCompare(String(left.date || ''));
      });
      return out.slice(0, spec.limit);
    });
  }

  function whoNewsFeed() {
    return getText(WHO_NEWS_API).then(function (text) {
      var payload = JSON.parse(text);
      var rows = payload && payload.value;
      if (!Array.isArray(rows)) return [];
      var picks = [];
      rows.forEach(function (row) {
        if (!row || picks.length >= 5) return;
        var title = trim(row.Title, 150);
        var path = String(row.ItemDefaultUrl || '');
        if (!title || !path) return;
        picks.push({
          id: 'who:' + (row.UrlName || path.replace(/^\//, '')),
          kind: 'news',
          source: 'who',
          lang: 'en',
          title: title,
          summary: '',
          url: 'https://www.who.int/news/item/' + path.replace(/^\//, ''),
          date: isoDate(row.PublicationDateAndTime)
        });
      });
      // The hub feed carries headlines only, so each page is read once for the
      // description it publishes in its own <meta> tag. An item whose page does
      // not answer is dropped rather than shown without a summary.
      return Promise.all(picks.map(function (row) {
        return getText(row.url, 15000).then(function (html) {
          row.summary = trim(summaryFrom(html), 230);
        }).catch(function () { return null; });
      })).then(function () {
        return picks.filter(function (row) { return row.summary; });
      });
    });
  }

  function metaSummary(html) {
    var tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
    for (var i = 0; i < tags.length; i += 1) {
      if (!/description/i.test(tags[i])) continue;
      var match = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tags[i]);
      if (match && (match[2] || match[3])) return match[2] || match[3];
    }
    return '';
  }

  // Not every page carries a description, so the opening paragraph of the
  // story is used instead — it is the publisher's own lede, not a rewrite.
  function summaryFrom(html) {
    var meta = metaSummary(html);
    if (meta) return meta;
    var paragraphs = String(html || '').match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    for (var i = 0; i < paragraphs.length; i += 1) {
      var text = stripHtml(paragraphs[i]);
      if (text.length >= 120 && !/cookie|javascript/i.test(text)) return text;
    }
    return '';
  }

  function fdaFeed() {    var url = 'https://api.fda.gov/drug/enforcement.json?search=report_date:%5B'
      + dayStamp(-MAX_AGE_DAYS) + '+TO+' + dayStamp() + '%5D&sort=report_date:desc&limit=40';
    return getText(url).then(function (text) {
      var payload = JSON.parse(text);
      var rows = payload && payload.results;
      if (!Array.isArray(rows)) return [];
      var out = [];
      rows.forEach(function (record) {
        var product = trim(record && record.product_description, 120);
        if (!product || out.length >= 8) return;
        var parts = [
          trim(record.recalling_firm, 70),
          trim(record.reason_for_recall, 140),
          trim(record.voluntary_mandated, 60),
          trim(record.distribution_pattern, 90)
        ].filter(Boolean);
        out.push({
          id: 'fda:' + (record.recall_number || record.event_id || product.slice(0, 24)),
          kind: 'news',
          source: 'fda',
          lang: 'en',
          title: trim('Recall: ' + product, 150),
          summary: trim(parts.join(' — '), 230),
          url: 'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
          date: isoDate(record.report_date || record.recall_initiation_date)
        });
      });
      return out;
    });
  }

  function pubmedFeed() {
    var search = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed'
      + '&retmode=json&sort=date&retmax=10&dateline=14%5Bdp%5D&term=' + encodeURIComponent(PUBMED_QUERY);
    return getText(search).then(function (text) {
      var result = JSON.parse(text);
      var ids = result && result.esearchresult && result.esearchresult.idlist;
      if (!Array.isArray(ids) || !ids.length) return [];
      return getText('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed'
        + '&retmode=xml&rettype=abstract&id=' + ids.join(','), 30000).then(function (xmlText) {
        var doc = parseXml(xmlText);
        var articles = doc.getElementsByTagName('PubmedArticle');
        var out = [];
        for (var i = 0; i < articles.length; i += 1) {
          var article = articles[i];
          var pmid = textOf(article, 'PMID');
          var title = trim(textOf(article, 'ArticleTitle'), 150);
          if (!pmid || !title) continue;
          out.push({
            id: 'pubmed:' + pmid,
            kind: 'article',
            source: 'pubmed',
            lang: 'en',
            title: title.replace(/\.$/, ''),
            summary: trim(abstractOf(article), 230),
            url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
            date: pubmedDate(article),
            journal: trim(textOf(article, 'Title'), 80)
          });
        }
        return out;
      });
    });
  }

  function textOf(node, tag) {
    var found = node.getElementsByTagName(tag);
    return found.length ? (found[0].textContent || '').trim() : '';
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

  // The issue's PubDate carries only a year for most records, so the electronic
  // article date (or the date it entered PubMed) is the real publication day.
  function pubmedDate(article) {
    var node = article.getElementsByTagName('ArticleDate')[0] || null;
    if (!node) {
      var stamped = article.getElementsByTagName('PubMedPubDate');
      for (var i = 0; i < stamped.length && !node; i += 1) {
        if (stamped[i].getAttribute('PubStatus') === 'pubmed') node = stamped[i];
      }
    }
    if (!node) node = article.getElementsByTagName('PubDate')[0] || null;
    if (!node) return '';
    var year = textOf(node, 'Year');
    if (!year) return '';
    var monthText = textOf(node, 'Month');
    var month = MONTHS[monthText.slice(0, 3).toLowerCase()] || Number(monthText) || 1;
    var day = Number(textOf(node, 'Day')) || 1;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function abstractOf(article) {
    var abstracts = article.getElementsByTagName('Abstract');
    if (!abstracts.length) return '';
    var parts = abstracts[0].getElementsByTagName('AbstractText');
    var text = '';
    for (var i = 0; i < parts.length; i += 1) text += ' ' + (parts[i].textContent || '');
    return text;
  }

  function dedupe(rows) {
    var seen = {};
    return rows.filter(function (row) {
      if (!row || !row.id || !row.title || !row.summary) return false;
      if (seen[row.id] || tooOld(row.date) || tooNew(row.date)) return false;
      seen[row.id] = true;
      return true;
    }).sort(function (left, right) {
      return String(right.date || '').localeCompare(String(left.date || ''));
    }).slice(0, MAX_ITEMS);
  }

  function fetchedAt() {
    return cache && cache.fetchedAt ? cache.fetchedAt : '';
  }

  function isStale() {
    if (!cache || !cache.fetchedAt || cache.snapshot === true) return true;
    var stamp = Date.parse(cache.fetchedAt);
    return isNaN(stamp) || Date.now() - stamp > TTL;
  }

  function items() {
    return cache && Array.isArray(cache.items) ? cache.items : [];
  }

  function loadSnapshot() {
    if (snapshot) return Promise.resolve(snapshot);
    if (!snapshotRequest) {
      snapshotRequest = global.DawayaNet.request(SNAPSHOT_URL, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }).then(function (payload) {
        snapshot = dedupe(Array.isArray(payload && payload.items) ? payload.items : []);
        if (!cache && snapshot.length) {
          /* Marked as a snapshot: it is dated, but it was cut at packaging time
             and no live fetch has run on this device yet, so the schedule still
             owes the reader one the first time the home page opens. */
          cache = { fetchedAt: payload.generatedAt || '', items: snapshot, snapshot: true };
          notify();
        }
        return snapshot;
      }).catch(function () {
        snapshot = [];
        return snapshot;
      });
    }
    return snapshotRequest.then(function () { return snapshot; });
  }

  function refresh(force) {
    if (refreshing) return refreshing;
    if (!force && !isStale()) return Promise.resolve({ ok: true, items: items(), cached: true });
    var tasks = WHO_FEEDS.map(whoFeed).concat([whoNewsFeed(), fdaFeed(), pubmedFeed()]);
    refreshing = Promise.allSettled(tasks).then(function (results) {
      var rows = [];
      var failures = 0;
      var answered = {};
      results.forEach(function (result) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          rows = rows.concat(result.value);
          result.value.forEach(function (row) { answered[row.source] = true; });
        } else {
          failures += 1;
        }
      });
      var merged = dedupe(rows);
      if (!merged.length) {
        return { ok: false, items: items(), error: 'unreachable', failures: failures };
      }
      // A feed that timed out keeps the headlines we already had instead of
      // leaving a hole; the next refresh replaces them once it answers again.
      items().forEach(function (row) {
        if (!answered[row.source]) merged.push(row);
      });
      merged = dedupe(merged);
      writeCache(merged);
      notify();
      return { ok: true, items: merged, failures: failures };
    }).catch(function (error) {
      return { ok: false, items: items(), error: String(error && error.message || error) };
    }).finally(function () {
      refreshing = null;
    });
    return refreshing;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    return function () {
      listeners = listeners.filter(function (other) { return other !== listener; });
    };
  }

  global.DawayaNews = {
    items: items,
    fetchedAt: fetchedAt,
    isStale: isStale,
    refresh: refresh,
    loadSnapshot: loadSnapshot,
    subscribe: subscribe,
    isArabic: function (item) { return item && item.lang === 'ar'; }
  };
})(window);
