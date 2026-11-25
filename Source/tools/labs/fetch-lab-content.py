#!/usr/bin/env python3
"""Fetches every MedlinePlus lab-test guide linked from lab-tests.js.

MedlinePlus is published by the U.S. National Library of Medicine and its
content is in the public domain. The extractor keeps the page's headed
sections in page order (paragraphs and lists), drops the reference list and
the "related" blocks, and writes assets/lab-tests-content.en.json so the
Arabic translation can be laid alongside it.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "webapp" / "lab-tests.js"
OUT = ROOT / "webapp" / "assets" / "lab-tests-content.json"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
SKIP_HEADINGS = {
    "references",
    "related health topics",
    "related medical tests",
    "related medical tests ",
}


class SectionParser(HTMLParser):
    """Collects <h2> headings and their <p>/<ul>/<ol> content in order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[dict] = []
        self.current: dict | None = None
        self.mode: str | None = None  # 'h2' | 'p' | 'li'
        self.buffer: list[str] = []
        self.items: list[str] = []
        self.depth_div = 0
        self.in_content = 0
        self.stop = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            self.depth_div += 1
            if attrs.get("class") == "mp-content":
                self.in_content += 1
            if attrs.get("id") == "mplus-related":
                self.stop = True
        if self.stop:
            return
        if tag == "h2":
            self.flush()
            self.mode = "h2"
            self.buffer = []
        elif tag == "p" and self.in_content:
            self.flush()
            self.mode = "p"
            self.buffer = []
        elif tag in ("ul", "ol") and self.in_content:
            self.flush()
            self.mode = "list"
            self.items = []
        elif tag == "li" and self.mode == "list":
            self.mode = "li"
            self.buffer = []
        elif tag == "br" and self.mode in ("p", "li", "h2"):
            self.buffer.append(" ")

    def handle_endtag(self, tag):
        if tag == "div":
            if self.in_content:
                self.in_content -= 1
            self.depth_div = max(0, self.depth_div - 1)
            if self.stop:
                return
        if self.stop:
            return
        if tag == "h2" and self.mode == "h2":
            self.close_heading()
        elif tag == "p" and self.mode == "p":
            self.close_paragraph()
        elif tag == "li" and self.mode == "li":
            text = clean("".join(self.buffer))
            if text:
                self.items.append(text)
            self.mode = "list"
            self.buffer = []
        elif tag in ("ul", "ol") and self.mode == "list":
            if self.current is not None and self.items:
                self.current["blocks"].append({"type": "list", "items": self.items})
            self.items = []
            self.mode = None

    def handle_data(self, data):
        if self.stop or self.mode in (None, "h2", "p", "li"):
            if self.mode in ("h2", "p", "li"):
                self.buffer.append(data)

    def close_heading(self):
        heading = clean("".join(self.buffer))
        self.mode = None
        self.buffer = []
        if not heading:
            return
        if heading.lower() in SKIP_HEADINGS:
            self.current = None
            self.stop = True
            return
        self.current = {"heading": heading, "blocks": []}
        self.sections.append(self.current)

    def close_paragraph(self):
        text = clean("".join(self.buffer))
        self.mode = None
        self.buffer = []
        if text and self.current is not None and not self.stop:
            self.current["blocks"].append({"type": "p", "text": text})

    def flush(self):
        if self.mode == "h2":
            self.close_heading()
        elif self.mode == "p":
            self.close_paragraph()
        elif self.mode == "li":
            text = clean("".join(self.buffer))
            if text:
                self.items.append(text)
            self.mode = "list"
            self.buffer = []

    def finish(self):
        self.flush()
        if self.mode == "list" and self.current is not None and self.items:
            self.current["blocks"].append({"type": "list", "items": self.items})
            self.items = []


def clean(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse(html_text: str) -> tuple[str, list[dict]]:
    title = ""
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html_text, re.S)
    if match:
        title = clean(re.sub(r"<[^>]+>", "", match.group(1)))
    parser = EncyclopediaParser() if 'class="mp-content"' not in html_text else SectionParser()
    parser.feed(html_text)
    parser.finish()
    sections = [s for s in parser.sections if s["blocks"]]
    return title, sections


class EncyclopediaParser(HTMLParser):
    """Fallback for MedlinePlus medical-encyclopedia articles (no mp-content).

    Those pages keep the summary in #ency_summary and each heading in an <h2>
    followed by a .section-body div. Both are read in page order.
    """

    SKIP = {
        "references",
        "images",
        "related medlineplus health topics",
        "related medlineplus pages",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[dict] = []
        self.current: dict | None = None
        self.pending_heading = ""
        self.mode: str | None = None
        self.buffer: list[str] = []
        self.items: list[str] = []
        self.depth = 0
        self.body_depth = 0
        self.summary_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            self.depth += 1
            if attrs.get("id") == "ency_summary":
                self.summary_depth = 1
                self.current = {"heading": "Overview", "blocks": []}
                self.sections.append(self.current)
            elif self.summary_depth:
                self.summary_depth += 1
            elif attrs.get("class") == "section-body":
                self.body_depth = 1
                heading = self.pending_heading.strip()
                heading_l = heading.lower()
                if heading and heading_l not in self.SKIP and not heading_l.startswith("review date"):
                    self.current = {"heading": heading, "blocks": []}
                    self.sections.append(self.current)
                else:
                    self.current = None
            elif self.body_depth:
                self.body_depth += 1
        if tag == "h2" and not self.body_depth:
            self.mode = "h2"
            self.buffer = []
        elif tag == "p" and (self.body_depth or self.summary_depth):
            self.flush()
            self.mode = "p"
            self.buffer = []
        elif tag in ("ul", "ol") and self.body_depth:
            self.flush()
            self.mode = "list"
            self.items = []
        elif tag == "li" and self.mode == "list":
            self.mode = "li"
            self.buffer = []
        elif tag == "br" and self.mode in ("p", "li"):
            self.buffer.append(" ")

    def handle_endtag(self, tag):
        if tag == "h2" and self.mode == "h2":
            heading = clean("".join(self.buffer))
            self.pending_heading = heading
            self.mode = None
            self.buffer = []
        elif tag == "p" and self.mode == "p":
            text = clean("".join(self.buffer))
            self.mode = None
            self.buffer = []
            if text and self.current is not None:
                self.current["blocks"].append({"type": "p", "text": text})
        elif tag == "li" and self.mode == "li":
            text = clean("".join(self.buffer))
            if text:
                self.items.append(text)
            self.mode = "list"
            self.buffer = []
        elif tag in ("ul", "ol") and self.mode == "list":
            if self.items and self.current is not None:
                self.current["blocks"].append({"type": "list", "items": self.items})
            self.items = []
            self.mode = None
        elif tag == "div":
            if self.summary_depth:
                self.summary_depth -= 1
            if self.body_depth:
                self.body_depth -= 1
            self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.mode in ("h2", "p", "li"):
            self.buffer.append(data)

    def flush(self):
        if self.mode == "p":
            text = clean("".join(self.buffer))
            if text and self.current is not None:
                self.current["blocks"].append({"type": "p", "text": text})
            self.mode = None
            self.buffer = []
        elif self.mode == "li":
            text = clean("".join(self.buffer))
            if text:
                self.items.append(text)
            self.mode = "list"
            self.buffer = []

    def finish(self):
        self.flush()
        if self.mode == "list" and self.current is not None and self.items:
            self.current["blocks"].append({"type": "list", "items": self.items})


def slugs() -> list[tuple[str, str]]:
    text = CATALOG.read_text(encoding="utf-8")
    found = []
    for match in re.finditer(r"\['([a-z0-9-]+)','[a-z-]+','[a-z-]+'.*?,'([^']+)'\]", text):
        found.append((match.group(1), match.group(2)))
    ids = [item[0] for item in found]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate ids in lab-tests.js")
    return found


def fetch(url: str) -> str:
    # curl uses the macOS trust store; this Python build has no bundled CAs.
    result = subprocess.run(
        ["curl", "-sS", "-L", "--max-time", "40", "-A", UA, url],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout.decode("utf-8", "replace")


def main() -> None:
    only = set(sys.argv[1:])
    payload = {}
    failures = []
    for test_id, slug in slugs():
        if only and test_id not in only:
            continue
        url = (
            f"https://medlineplus.gov/{slug}"
            if "/" in slug
            else f"https://medlineplus.gov/lab-tests/{slug}/"
        )
        try:
            title, sections = parse(fetch(url))
        except Exception as exc:  # noqa: BLE001 - report and continue
            failures.append((test_id, url, str(exc)))
            continue
        if not sections:
            failures.append((test_id, url, "no sections extracted"))
            continue
        payload[test_id] = {"url": url, "en": {"sections": sections}}
        words = sum(
            len((b.get("text") or " ".join(b.get("items", []))).split())
            for s in sections
            for b in s["blocks"]
        )
        print(f"{test_id:14s} {len(sections):2d} sections {words:4d} words  {title}")
        time.sleep(0.4)
    tests = payload
    if only:
        existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        tests = existing.get("tests", {})
        tests.update(payload)
    document = {
        "meta": {
            "source": "MedlinePlus",
            "publisher": "U.S. National Library of Medicine",
            "license": "Public domain (U.S. federal government work)",
            "guide": "https://medlineplus.gov/lab-tests/",
            "retrieved": time.strftime("%Y-%m-%d"),
        },
        "tests": tests,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(tests)} tests)")
    if failures:
        for test_id, url, reason in failures:
            print(f"FAILED {test_id}: {url} — {reason}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
