#!/usr/bin/env python3
"""Upgrades webapp/assets/conditions.json from the capped MedlinePlus web
service summaries to the complete topic text published in the MedlinePlus
bulk XML (https://medlineplus.gov/xml.html). MedlinePlus health topics are
produced by the U.S. National Library of Medicine; the page URL each topic
already carries stays as the citation.

Topics match on the MedlinePlus numeric id that the catalogue stores. The
HTML inside <full-summary> is flattened to the plain-text shape the app
already renders (blank-line paragraphs, bullet glyph lists).
"""
from __future__ import annotations

import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COND = ROOT / "webapp" / "assets" / "conditions.json"


def flatten(fragment: str) -> str:
    text = fragment
    text = re.sub(r"(?i)<\s*(br|/p|/div|/h\d)\s*/?\s*>", "\n\n", text)
    text = re.sub(r"(?i)<\s*li[^>]*>", "\n• ", text)
    text = re.sub(r"(?i)<\s*/(ul|ol)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main(xml_path: str) -> None:
    tree = ET.parse(xml_path)
    full: dict[str, dict] = {}
    for topic in tree.getroot().iter("health-topic"):
        tid = topic.get("id") or ""
        summary = topic.findtext("full-summary") or ""
        if tid and summary.strip():
            full[tid] = {
                "title": topic.get("title") or "",
                "summary": flatten(summary),
                "also": [a.text or "" for a in topic.iter("also-called")],
            }

    data = json.loads(COND.read_text("utf-8"))
    topics = data["topics"]
    upgraded = 0
    gained = 0
    synonyms_added = 0
    for t in topics:
        hit = full.get(str(t.get("id") or ""))
        if not hit or not hit["summary"]:
            continue
        old = t.get("summary") or ""
        if len(hit["summary"]) > len(old):
            gained += len(hit["summary"]) - len(old)
            t["summary"] = hit["summary"]
            upgraded += 1
        existing = {s.lower() for s in t.get("synonyms") or []}
        for a in hit["also"]:
            if a and a.lower() not in existing and a.lower() != (t.get("title") or "").lower():
                t.setdefault("synonyms", []).append(a)
                existing.add(a.lower())
                synonyms_added += 1

    meta = data.setdefault("meta", {})
    meta["summaryText"] = "Full MedlinePlus topic text (bulk XML)"
    meta["bulkRetrieved"] = "2026-11-24"
    COND.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    lens = sorted(len(t.get("summary") or "") for t in topics)
    print(f"topics: {len(topics)}, upgraded: {upgraded}, +{gained/1e6:.1f} MB of text, synonyms +{synonyms_added}")
    print(f"summary chars: min {lens[0]}, median {lens[len(lens)//2]}, p90 {lens[int(len(lens)*0.9)]}, max {lens[-1]}")
    print(f"file size: {COND.stat().st_size/1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1])
