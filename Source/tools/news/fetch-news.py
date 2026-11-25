#!/usr/bin/env python3
"""Builds the offline news snapshot shipped inside every Dawaya bundle.

Pulls the same official endpoints the app queries at runtime (WHO's news hub,
feature stories and Arabic service, openFDA, PubMed) so the home page has real
headlines on a first run with no network. Titles and summaries are truncated
verbatim, never rewritten.
"""
import calendar
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "webapp", "news.json")
UA = "DawayaGuide/1.0 (offline medicine guide; https://github.com/hussein-elnagmy/egyptian-drug-database)"
WHO_NEWS_API = ("https://www.who.int/api/hubs/newsitems"
                "?sf_site=15210d59-ad60-47ff-a542-7ed76645f0c7&sf_provider=OpenAccessDataProvider&sf_culture=en"
                "&$orderby=PublicationDateAndTime%20desc&$top=5"
                "&$select=Title,ItemDefaultUrl,PublicationDateAndTime,Tag")
TAGS = re.compile(r"<[^>]+>")
META_TAGS = re.compile(r"<meta\b[^>]*>", re.I)
META_CONTENT = re.compile(r"\bcontent\s*=\s*(\"([^\"]*)\"|'([^']*)')", re.I)
PARAGRAPHS = re.compile(r"<p\b[^>]*>.*?</p>", re.I | re.S)
SPACE = re.compile(r"\s+")


def _opener():
    context = ssl.create_default_context()
    # Some Homebrew/framework Pythons ship with an empty trust store; macOS
    # keeps the same roots in /etc/ssl/cert.pem.
    if not context.cert_store_stats().get("x509_ca"):
        for bundle in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl/cert.pem"):
            if os.path.exists(bundle):
                context = ssl.create_default_context(cafile=bundle)
                break
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=context))


OPENER = _opener()
MONTHS = {name.lower(): index for index, name in enumerate(calendar.month_abbr) if name}
MONTHS.update({"spring": 3, "summer": 6, "fall": 9, "autumn": 9, "winter": 12})
ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&nbsp;": " ", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”",
    "&ndash;": "–", "&mdash;": "—", "&eacute;": "é", "&egrave;": "è", "&ccedil;": "ç",
}


def get(url, timeout=30, attempts=3):
    last = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with OPENER.open(request, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except Exception as error:
            last = error
            if attempt + 1 < attempts:
                time.sleep(2 * (attempt + 1))
    raise last


def clean(text, limit):
    if not text:
        return ""
    value = TAGS.sub(" ", text)
    for entity, char in ENTITIES.items():
        value = value.replace(entity, char)
    value = value.replace("[1]", " ")
    value = SPACE.sub(" ", value).strip()
    if len(value) <= limit:
        return value
    cut = value[:limit].rfind(" ")
    return (value[:cut if cut > 40 else limit]).rstrip(" ,;:.") + "…"


def day_stamp(offset_days=0):
    return time.strftime("%Y%m%d", time.gmtime(time.time() + offset_days * 86400))


def iso_date(value):
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", value or "")
    if match:
        return "-".join(match.groups())
    match = re.search(r"(\d{4})(\d{2})(\d{2})", value or "")
    if match:
        return "-".join(match.groups())
    return ""


def rfc_date(value):
    match = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", value or "")
    if not match:
        return ""
    number = {name: index for index, name in enumerate(calendar.month_abbr)}
    month = number.get(match.group(2).title(), 0)
    if not month:
        return ""
    return "%s-%02d-%02d" % (match.group(3), month, int(match.group(1)))


def meta_summary(html):
    for tag in META_TAGS.findall(html or ""):
        if "description" not in tag.lower():
            continue
        match = META_CONTENT.search(tag)
        if match:
            return match.group(2) or match.group(3) or ""
    return ""


def page_summary(html):
    """The description meta when the publisher sets one, otherwise the story's
    own opening paragraph — never a rewrite."""
    meta = meta_summary(html)
    if meta:
        return meta
    for paragraph in PARAGRAPHS.findall(html or ""):
        text = clean(paragraph, 4000)
        if len(text) >= 120 and "cookie" not in text.lower() and "javascript" not in text.lower():
            return text
    return ""


def who_news_items(cap):
    """WHO's English RSS stopped in January, so the news hub is read instead.
    It lists headlines only; each item's own page publishes the summary."""
    payload = json.loads(get(WHO_NEWS_API))
    out = []
    for row in (payload.get("value") or [])[:cap]:
        title = clean(row.get("Title"), 150)
        path = (row.get("ItemDefaultUrl") or "").strip().lstrip("/")
        if not title or not path:
            continue
        url = "https://www.who.int/news/item/" + path
        try:
            summary = clean(page_summary(get(url, 25, 2)), 230)
        except Exception as error:
            print("WHO item skipped:", url, error, file=sys.stderr)
            continue
        if not summary:
            print("WHO item has no summary:", url, file=sys.stderr)
            continue
        out.append({
            "id": "who:" + (row.get("UrlName") or path),
            "kind": "news",
            "source": "who",
            "lang": "en",
            "title": title,
            "summary": summary,
            "url": url,
            "date": iso_date(row.get("PublicationDateAndTime")),
        })
    return dedupe(out, cap)


def who_items(feed, source, lang, cap):
    root = ET.fromstring(get("https://www.who.int/rss-feeds/" + feed))
    out = []
    for item in root.findall("./channel/item"):
        link = (item.findtext("link") or "").strip()
        title = clean(item.findtext("title"), 150)
        if not link or not title:
            continue
        stamp = rfc_date(item.findtext("pubDate"))
        # WHO stamps some items when the page is republished, so a date carried
        # in the news-item URL wins over the feed date when both are present.
        slug = re.search(r"/news/item/(\d{2})-(\d{2})-(\d{4})", link)
        if slug:
            stamp = "%s-%s-%s" % (slug.group(3), slug.group(2), slug.group(1))
        out.append({
            "id": "%s:%s" % (source, link.rstrip("/").rsplit("/", 1)[-1]),
            "kind": "news",
            "source": source,
            "lang": lang,
            "title": title,
            "summary": clean(item.findtext("description"), 230),
            "url": link,
            "date": stamp or iso_date(day_stamp()),
        })
    return dedupe(out, cap)


def fda_items(cap):
    span = "%5B" + day_stamp(-120) + "+TO+" + day_stamp() + "%5D"
    url = ("https://api.fda.gov/drug/enforcement.json?search=report_date:" + span
           + "&sort=report_date:desc&limit=60")
    try:
        payload = json.loads(get(url))
    except Exception as error:  # a 404 on an empty window is not a build failure
        print("openFDA skipped:", error, file=sys.stderr)
        return []
    out = []
    for record in payload.get("results", []):
        product = clean(record.get("product_description"), 120)
        firm = clean(record.get("recalling_firm"), 70)
        if not product:
            continue
        reason = clean(record.get("reason_for_recall"), 140)
        kind = clean(record.get("voluntary_mandated"), 60)
        where = clean(record.get("distribution_pattern"), 90)
        out.append({
            "id": "fda:" + str(record.get("recall_number") or record.get("event_id") or product[:24]),
            "kind": "news",
            "source": "fda",
            "lang": "en",
            "title": ("Recall: " + product)[:150],
            "summary": clean(" — ".join(part for part in [
                firm, reason, kind, where] if part), 230),
            "url": "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",
            "date": iso_date(record.get("report_date") or record.get("recall_initiation_date")),
        })
    return dedupe(out, cap)


def pubmed_items(cap):
    query = ('"drug therapy"[Title/Abstract] OR "medication"[Title/Abstract] OR '
             '"diagnosis"[Title/Abstract] OR "treatment"[Title/Abstract]')
    search_url = ("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed"
                  "&retmode=json&sort=date&retmax=" + str(cap + 6) +
                  "&dateline=14%5Bdp%5D&term=" + urllib.parse.quote(query, safe="[]/\""))
    ids = json.loads(get(search_url))["esearchresult"].get("idlist", [])
    if not ids:
        return []
    xml = get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed"
              "&retmode=xml&rettype=abstract&id=" + ",".join(ids))
    out = []
    for article in ET.fromstring(xml).findall(".//PubmedArticle"):
        citation = article.find("MedlineCitation")
        pmid = (citation.findtext("PMID") or "").strip() if citation is not None else ""
        entry = citation.find("Article") if citation is not None else None
        title = clean(entry.findtext("ArticleTitle"), 150) if entry is not None else ""
        if not pmid or not title:
            continue
        journal = clean(entry.find("Journal").findtext("Title"), 80) if entry is not None and entry.find("Journal") is not None else ""
        abstract = ""
        if entry is not None and entry.find("Abstract") is not None:
            abstract = " ".join(node.text or "" for node in entry.find("Abstract").findall("AbstractText"))
        date_node = article.find("MedlineCitation/Article/ArticleDate")
        if date_node is None:
            for candidate in article.findall("PubmedData/PubMedPubDate"):
                if candidate.get("PubStatus") == "pubmed":
                    date_node = candidate
                    break
        if date_node is None:
            date_node = article.find("MedlineCitation/Article/Journal/JournalIssue/PubDate")
        year = (date_node.findtext("Year") or "") if date_node is not None else ""
        month_text = ((date_node.findtext("Month") or "") if date_node is not None else "").strip()
        day = ((date_node.findtext("Day") or "") if date_node is not None else "").strip()
        stamp = ""
        if year:
            if month_text.isdigit():
                month_number = int(month_text)
            else:
                month_number = MONTHS.get(month_text[:3].lower(), 1)
            stamp = "%s-%02d-%02d" % (year, month_number, int(day) if day.isdigit() else 1)
        out.append({
            "id": "pubmed:" + pmid,
            "kind": "article",
            "source": "pubmed",
            "lang": "en",
            "title": title.rstrip("."),
            "summary": clean(abstract, 230),
            "url": "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
            "date": stamp,
            "journal": journal,
        })
    return dedupe(out, cap)


def dedupe(items, cap):
    seen = set()
    out = []
    ceiling = time.time() + 86400
    for item in sorted(items, key=lambda entry: entry.get("date", ""), reverse=True):
        key = item["id"]
        stamp = item.get("date", "")
        future = bool(stamp) and time.mktime(time.strptime(stamp, "%Y-%m-%d")) > ceiling
        if key in seen or not item["summary"] or future:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= cap:
            break
    return out


def main():
    snapshot = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": {
            "who": WHO_NEWS_API,
            "whofeature": "https://www.who.int/rss-feeds/feature-stories-english.xml",
            "whoar": "https://www.who.int/rss-feeds/news-arabic.xml",
            "fda": "https://api.fda.gov/drug/enforcement.json",
            "pubmed": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
        },
        "items": [],
    }
    jobs = (
        ("WHO news", lambda: who_news_items(5), 5),
        ("WHO features", lambda: who_items("feature-stories-english.xml", "whofeature", "en", 8), 8),
        ("WHO arabic", lambda: who_items("news-arabic.xml", "whoar", "ar", 8), 8),
        ("FDA recalls", lambda: fda_items(8), 8),
        ("PubMed", lambda: pubmed_items(10), 10),
    )
    for label, fetch, _cap in jobs:
        try:
            rows = fetch()
        except Exception as error:
            print("%s failed:" % label, error, file=sys.stderr)
            rows = []
        snapshot["items"].extend(rows)
        print("%-14s %2d items" % (label, len(rows)))
    snapshot["items"].sort(key=lambda item: item.get("date", ""), reverse=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=1)
    print("wrote", OUT, len(snapshot["items"]), "items")
    return 0 if snapshot["items"] else 1


if __name__ == "__main__":
    sys.exit(main())
