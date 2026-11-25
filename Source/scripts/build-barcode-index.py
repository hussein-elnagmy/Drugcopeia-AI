#!/usr/bin/env python3
"""Build assets/barcode-index.json from the MIT-licensed eg-drugs dataset.

The bundled Egyptian medicine directory has no GTIN column, so a scanned box
code cannot be resolved from it alone. This script joins the public eg-drugs
barcodes (mahmoudfalous/eg-drugs, MIT) onto the local directory by brand name
and writes one small offline lookup file. Every entry is a barcode and the two
brand names that carry it; no personal data and no network access at runtime.

Usage:
    curl -L -o /tmp/eg_drugs.csv \
      https://raw.githubusercontent.com/mahmoudfalous/eg-drugs/main/data/eg_drugs.csv
    python3 Source/scripts/build-barcode-index.py /tmp/eg_drugs.csv
"""
import csv
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRUGS = os.path.join(ROOT, "webapp", "assets", "egyptian-drugs.json")
OUT = os.path.join(ROOT, "webapp", "assets", "barcode-index.json")
SOURCE_URL = "https://github.com/mahmoudfalous/eg-drugs"
SOURCE_LICENSE = "MIT"


def norm(value):
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper()
    text = re.sub(r"[^0-9A-Z\u0600-\u06FF]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else "/tmp/eg_drugs.csv"
    drugs = json.load(open(DRUGS, encoding="utf-8"))
    by_en, by_ar = {}, {}
    for index, row in enumerate(drugs):
        en = norm(row.get("commercial_name_en"))
        ar = norm(row.get("commercial_name_ar"))
        if en:
            by_en.setdefault(en, index)
        if ar:
            by_ar.setdefault(ar, index)

    codes, exact = {}, 0
    with open(source, encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            code = (row.get("barcode") or "").strip()
            if not code.isdigit() or len(code) < 8 or len(code) > 14:
                continue
            en = (row.get("name") or "").strip()
            ar = (row.get("arabic") or "").strip()
            hit = by_en.get(norm(en)) if en else None
            if hit is None and ar:
                hit = by_ar.get(norm(ar))
            if hit is not None:
                exact += 1
                record = drugs[hit]
                en = record.get("commercial_name_en") or en
                ar = record.get("commercial_name_ar") or ar
            if en or ar:
                codes[code] = [en, ar]

    payload = {
        "meta": {
            "source": SOURCE_URL,
            "license": SOURCE_LICENSE,
            "note": "Barcode to brand name, bundled for offline scanning. Only published product codes are stored.",
        },
        "codes": codes,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    print("barcodes: %d (matched to local directory: %d) -> %s" % (len(codes), exact, OUT))


if __name__ == "__main__":
    main()
