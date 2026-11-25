#!/usr/bin/env python3
"""Expands the lab-test catalogue from the hand-picked starter set to the
full MedlinePlus lab-test library (https://medlineplus.gov/lab-tests/),
reusing the section extractor in fetch-lab-content.py.

MedlinePlus is published by the U.S. National Library of Medicine and its
content is in the public domain. New catalogue rows carry the English name
in both language slots (the starter rows keep their hand-written Arabic) and
short summaries derived from the fetched guide itself, so every word shown
still traces to MedlinePlus. Tests are filed into the existing specialty
groups by keyword, with a General group for the rest.

Usage: expand_lab_tests.py [--limit N]
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "webapp" / "lab-tests.js"
OUT = ROOT / "webapp" / "assets" / "lab-tests-content.json"
INDEX_URL = "https://medlineplus.gov/lab-tests/"
UA = "Drugcopeia-offline-bundle/1.0 (educational)"

spec = importlib.util.spec_from_file_location("flc", Path(__file__).with_name("fetch-lab-content.py"))
flc = importlib.util.module_from_spec(spec)
sys.modules["flc"] = flc
spec.loader.exec_module(flc)

# keyword -> (specialty, group); first match wins
RULES = [
    (r"complete-blood|blood-count|hemoglobin(?!-a1c)|hematocrit|platelet|white-blood|red-blood|blood-differential|reticulocyte|sedimentation|mpv|mean-corpuscular|\brdw\b|blood-smear|g6pd|haptoglobin|bone-marrow|cd4", ("blood", "cells")),
    (r"ferritin|iron|transferrin|anemia|anaemia", ("blood", "iron")),
    (r"prothrombin|pt-and-inr|ptt|thromboplastin|d-dimer|fibrin|clotting|coagulation|von-willebrand|thrombin|bleeding|protein-c-and-protein-s", ("blood", "clotting")),
    (r"glucose|a1c|insulin|c-peptide|diabetes", ("metabolic", "diabetes")),
    (r"thyroid|tsh|thyroxine|triiodothyronine|\bt3\b|\bt4\b|thyroglobulin|calcitonin", ("metabolic", "thyroid")),
    (r"vitamin|folate|folic|carotene|methylmalonic", ("metabolic", "vitamins")),
    (r"metabolic-panel|electrolyte|sodium|potassium|chloride|bicarbonate|calcium|magnesium|phosphorus|phosphate|uric-acid|lactate|cortisol|acth|aldosterone|parathyroid|growth-hormone|testosterone|dhea|anion-gap|carbon-dioxide|osmolality|total-protein|globulin|ketones|glucagon|catecholamine|renin|ceruloplasmin|free-light-chains|protein-electrophoresis|porphyrin", ("metabolic", "metabolic-panels")),
    (r"creatinine|egfr|gfr|\bbun\b|urea|cystatin|kidney|pyelogram", ("renal", "kidney-function")),
    (r"urine|urinalysis|microalbumin", ("renal", "urine-tests")),
    (r"troponin|creatine-kinase|ck-mb|\bbnp\b|probnp|myoglobin|echocardiography|electrocardiogram|stress-test", ("cardio", "heart-injury")),
    (r"cholesterol|lipid|triglyceride|hdl|ldl|lipoprotein|homocysteine|c-reactive|\bcrp\b|cardiac|heart|blood-pressure", ("cardio", "risk")),
    (r"alanine|aspartate|\balt\b|\bast\b|bilirubin|alkaline-phosphatase|ggt|liver|hepatitis|ammonia|albumin-blood|prealbumin", ("liver-digestive", "liver")),
    (r"celiac|stool|fecal|faecal|pylori|calprotectin|digestive|food|lactose|hydrogen-breath|amylase|lipase|xylose|gastric|esophageal|dysphagia|barium", ("liver-digestive", "digestive")),
    (r"rheumatoid|antinuclear|\bana\b|autoimmune|inflammation|complement|immunoglobulin|allergy", ("infection", "inflammation")),
    (r"hiv|mono|strep|covid|flu|influenza|tuberculosis|\btb\b|syphilis|rpr|vdrl|cmv|epstein|rubella|measles|mumps|varicella|herpes|toxoplasma|malaria|dengue|culture|antibod|chlamydia|gonorrhea|trichomonas|hepatitis|west-nile|lyme|rsv|pertussis|whooping|fungal|infection|sepsis|procalcitonin|legionella|meningococcal|mrsa|pneumococcal|zika|chickenpox|shingles|c-diff|gram-stain|pcr|respiratory-pathogens|ova-and-parasite|parasite|nasal-swab|acid-fast|vaginosis|antibiotic-sensitivity", ("infection", "infection-tests")),
    (r"pregnancy|hcg|prenatal|quad|alpha-fetoprotein|amniocentesis|down-syndrome|chorionic|nonstress|fetal|cord-blood", ("reproductive", "pregnancy")),
    (r"progesterone|estrogen|estradiol|fsh|luteinizing|prolactin|\bamh\b|semen|sperm|pap|hpv|menopause|ovarian|prostate|psa|hormone|shbg|colposcopy|hysteroscopy", ("reproductive", "hormones")),
    (r"screening|genetic|carrier|newborn|tumor-marker|tumou?r|\bcea\b|ca-19-9|beta-2-microglobulin|her2|pdl1|brca|braf|karyotype|mthfr|pten|tp53|bcr-abl|pharmacogenetic|oncolog|cancer|biopsy|mental-health|depression|anxiety|adhd|autism|ocd|panic|suicide|cognitive|developmental|vision|hearing|glaucoma|bone-density|colorectal|dental", ("general", "screening")),
]
FALLBACK = ("general", "general-tests")
NEW_SPECIALTY = "    {id:'general',name:{en:'General & screening',ar:'تحاليل عامة وفحوص كشف'},groups:[{id:'general-tests',name:{en:'General tests',ar:'تحاليل عامة'}},{id:'screening',name:{en:'Screening tests',ar:'اختبارات الفحص المبكر'}}]},\n"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


def trim(text: str, cap: int = 260) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= cap:
        return text
    cut = text[:cap]
    m = list(re.finditer(r"[.!?]\s", cut))
    return (cut[: m[-1].end()].strip() if m and m[-1].end() > cap * 0.5 else cut.rsplit(" ", 1)[0]) 


def first_para(sections: list[dict], pattern: str = "") -> str:
    for s in sections:
        if pattern and not re.search(pattern, s["heading"], re.I):
            continue
        for b in s["blocks"]:
            if b["type"] == "p" and len(b["text"]) > 40:
                return trim(b["text"])
    return ""


def js_str(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def main() -> None:
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 0
    catalog_text = CATALOG.read_text("utf-8")
    have_slugs = set(re.findall(r"'([a-z0-9-]+)'\s*\]", catalog_text))

    index_html = fetch(INDEX_URL)
    links = sorted(set(re.findall(r'href="https://medlineplus\.gov/lab-tests/([a-z0-9-]+)/"', index_html)))
    new_slugs = [s for s in links if s not in have_slugs]
    if limit:
        new_slugs = new_slugs[:limit]
    print(f"{len(links)} guides in the MedlinePlus index, {len(new_slugs)} new")

    def load(slug: str):
        url = f"https://medlineplus.gov/lab-tests/{slug}/"
        try:
            html_text = fetch(url)
            title, sections = flc.parse(html_text)
            return slug, url, title, [s for s in sections if s["blocks"]], ""
        except Exception as exc:
            return slug, url, "", [], str(exc)

    results = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for done, (slug, url, title, sections, err) in enumerate(pool.map(load, new_slugs)):
            results[slug] = (url, title, sections, err)
            if (done + 1) % 50 == 0:
                print(f"  …{done + 1}/{len(new_slugs)}", flush=True)
            time.sleep(0.02)

    document = json.loads(OUT.read_text("utf-8"))
    tests = document["tests"]
    rows = []
    failures = 0
    for slug in new_slugs:
        url, title, sections, err = results[slug]
        if err or not sections or not title:
            failures += 1
            continue
        tests[slug] = {"url": url, "en": {"sections": sections}}
        target = FALLBACK
        for pattern, pair in RULES:
            if re.search(pattern, slug):
                target = pair
                break
        what = first_para(sections)
        meaning = first_para(sections, r"results?\s+mean")
        sample = first_para(sections, r"during|happens|done")
        prep = first_para(sections, r"prepare|preparation")
        name = title.replace(":", ",").strip()
        row = "    [" + ",".join([
            js_str(slug), js_str(target[0]), js_str(target[1]),
            js_str(name), js_str(name),
            js_str(what), js_str(what),
            js_str(meaning), js_str(meaning),
            js_str(sample), js_str(sample),
            js_str(prep), js_str(prep),
            js_str(slug),
        ]) + "],"
        rows.append(row)

    # new specialty group (once), new rows at the end of the tests array
    if "id:'general'" not in catalog_text:
        catalog_text = catalog_text.replace("}\n  ],\n  tests: [", "},\n" + NEW_SPECIALTY.rstrip(",\n") + "\n  ],\n  tests: [", 1)
    marker = re.compile(r"\]\n  \]\n};")
    if not marker.search(catalog_text):
        raise SystemExit("tests-array closing marker not found")
    catalog_text = marker.sub("],\n" + "\n".join(rows) + "\n  ]\n};", catalog_text, count=1)
    CATALOG.write_text(catalog_text, "utf-8")

    document["meta"]["retrieved"] = time.strftime("%Y-%m-%d")
    document["meta"]["count"] = len(tests)
    OUT.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"catalog rows added: {len(rows)}, fetch failures: {failures}")
    print(f"content tests total: {len(tests)}, file {OUT.stat().st_size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
