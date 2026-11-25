#!/usr/bin/env python3
"""Fetches sourced per-ingredient monographs from the U.S. FDA openFDA drug
label API and bundles them as webapp/assets/monographs.json.

openFDA redistributes the Structured Product Labels (SPL) that manufacturers
submit to the FDA and that NLM publishes on DailyMed. Each bundled section
keeps a link to the full label on DailyMed, and the app shows it next to a
not-clinically-reviewed note. Sections are trimmed at a sentence boundary so
the offline bundle stays small; the DailyMed link is the complete record.

The Egyptian catalogue names ingredients with international spellings and
packs aliases in parentheses ("PARACETAMOL(ACETAMINOPHEN)"); U.S. labels use
USAN names, so each ingredient is tried under every candidate spelling.

Usage: fetch_monographs.py [--top N] [--sleep SECONDS]
Raw API responses are cached under tools/monographs/cache/ so re-runs are
cheap and the selection/scoring logic can be tuned without refetching.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRUGS = ROOT / "webapp" / "assets" / "egyptian-drugs.json"
OUT = ROOT / "webapp" / "assets" / "monographs.json"
CACHE = Path(__file__).resolve().parent / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
_rate_lock = threading.Lock()
_last_request = 0.0
MIN_INTERVAL = 0.12  # stays well under the 240 requests/minute anonymous cap
API = "https://api.fda.gov/drug/label.json"
UA = "Drugcopeia-offline-bundle/1.0 (educational; contact via GitHub hussein-elnagmy/Drugcopeia)"

# Per-section character caps, trimmed at a sentence boundary.
SECTIONS = {
    "boxed_warning": ("boxed_warning", 1500),
    "indications": ("indications_and_usage", 1800),
    "dosage": ("dosage_and_administration", 2200),
    "contraindications": ("contraindications", 1200),
    "warnings": ("warnings_and_cautions", 2500),
    "adverse_reactions": ("adverse_reactions", 2000),
    "interactions": ("drug_interactions", 1800),
    "pregnancy": ("pregnancy", 1500),
    "mechanism": ("mechanism_of_action", 1000),
}
FALLBACK_SECTIONS = {  # when the primary field is missing
    "warnings": ("warnings", 2500),
    "pregnancy": ("use_in_specific_populations", 1200),
}

SALT_WORDS = {
    "hydrochloride", "hydrobromide", "sodium", "potassium", "calcium", "magnesium",
    "sulfate", "sulphate", "phosphate", "maleate", "tartrate", "citrate", "acetate",
    "succinate", "fumarate", "mesylate", "besylate", "tosylate", "nitrate", "lactate",
    "monohydrate", "dihydrate", "trihydrate", "anhydrous", "hemihydrate", "hydrogen",
}

# Egyptian catalogue spelling -> USAN spelling used on U.S. labels.
ALIASES = {
    "PARACETAMOL": "ACETAMINOPHEN",
    "VITAMIN C": "ASCORBIC ACID",
    "VITAMIN D3": "CHOLECALCIFEROL",
    "VITAMIN D2": "ERGOCALCIFEROL",
    "VITAMIN B1": "THIAMINE",
    "VITAMIN B2": "RIBOFLAVIN",
    "VITAMIN B3": "NIACINAMIDE",
    "VITAMIN B6": "PYRIDOXINE",
    "VITAMIN B12": "CYANOCOBALAMIN",
    "VITAMIN E": "TOCOPHEROL",
    "VITAMIN K1": "PHYTONADIONE",
    "ADRENALINE": "EPINEPHRINE",
    "NORADRENALINE": "NOREPINEPHRINE",
    "FRUSEMIDE": "FUROSEMIDE",
    "SALBUTAMOL": "ALBUTEROL",
    "LIGNOCAINE": "LIDOCAINE",
    "MEPYRAMINE MALEATE": "PYRILAMINE",
    "PHENYLPROPANOLAMINE": "PHENYLPROPANOLAMINE",
    "HYOSCINE": "SCOPOLAMINE",
    "CHLORPHENIRAMINE": "CHLORPHENIRAMINE MALEATE",
    "CEFALEXIN": "CEPHALEXIN",
    "NICOTINAMIDE": "NIACINAMIDE",
    "ACETYLSALICYLIC ACID": "ASPIRIN",
    "DIGOXINE": "DIGOXIN",
    "GAMMA LINOLENIC ACID": None,
}
# High-priority medicines that brand-count ranking can leave below the
# cut-off (critical drugs on relatively few Egyptian brands). Included only
# when the ingredient actually appears in the bundled catalogue.
EXTRAS = [
    "WARFARIN", "ACETYLSALICYLIC ACID", "ASPIRIN", "DIGOXIN", "DIGOXINE", "LEVOTHYROXINE",
    "INSULIN GLARGINE", "INSULIN ASPART", "INSULIN LISPRO", "INSULIN DEGLUDEC",
    "INSULIN", "METHOTREXATE", "ALLOPURINOL", "FEBUXOSTAT", "COLCHICINE",
    "CARBAMAZEPINE", "SODIUM VALPROATE", "VALPROIC ACID", "PHENYTOIN",
    "LEVETIRACETAM", "LAMOTRIGINE", "TOPIRAMATE", "ENOXAPARIN", "HEPARIN",
    "RIVAROXABAN", "APIXABAN", "DABIGATRAN", "FUROSEMIDE", "SPIRONOLACTONE",
    "METOPROLOL", "BISOPROLOL", "CARVEDILOL", "PROPRANOLOL", "LABETALOL",
    "RAMIPRIL", "LISINOPRIL", "PERINDOPRIL", "VALSARTAN", "LOSARTAN",
    "LOSARTAN POTASSIUM", "CANDESARTAN", "TELMISARTAN", "NIFEDIPINE",
    "DILTIAZEM", "VERAPAMIL", "AMIODARONE", "ISOSORBIDE MONONITRATE",
    "ISOSORBIDE DINITRATE", "NITROGLYCERIN", "GLYCERYL TRINITRATE",
    "METHYLDOPA", "HYDRALAZINE", "ROSUVASTATIN", "EZETIMIBE", "FENOFIBRATE",
    "GLICLAZIDE", "GLIMEPIRIDE", "GLIBENCLAMIDE", "PIOGLITAZONE",
    "SITAGLIPTIN", "EMPAGLIFLOZIN", "DAPAGLIFLOZIN", "ACARBOSE",
    "LEVOFLOXACIN", "MOXIFLOXACIN", "DOXYCYCLINE", "CLARITHROMYCIN",
    "METRONIDAZOLE", "TINIDAZOLE", "FLUCONAZOLE", "ITRACONAZOLE",
    "ACYCLOVIR", "OSELTAMIVIR", "CEFUROXIME", "CEFPODOXIME", "CEFTRIAXONE",
    "CEFOTAXIME", "CEFAZOLIN", "CEFEPIME", "MEROPENEM", "VANCOMYCIN",
    "GENTAMICIN", "AMIKACIN", "CLINDAMYCIN", "LINEZOLID", "NITROFURANTOIN",
    "BUDESONIDE", "FLUTICASONE", "MONTELUKAST", "THEOPHYLLINE",
    "PREDNISOLONE", "PREDNISONE", "DEXAMETHASONE", "HYDROCORTISONE",
    "METHYLPREDNISOLONE", "ESOMEPRAZOLE", "PANTOPRAZOLE", "LANSOPRAZOLE",
    "RABEPRAZOLE", "ONDANSETRON", "METOCLOPRAMIDE", "LOPERAMIDE",
    "LACTULOSE", "BISACODYL", "SILDENAFIL", "TADALAFIL", "FINASTERIDE",
    "TAMSULOSIN", "SERTRALINE", "FLUOXETINE", "ESCITALOPRAM", "PAROXETINE",
    "VENLAFAXINE", "DULOXETINE", "MIRTAZAPINE", "AMITRIPTYLINE",
    "QUETIAPINE", "OLANZAPINE", "RISPERIDONE", "ARIPIPRAZOLE", "HALOPERIDOL",
    "CLONAZEPAM", "ALPRAZOLAM", "DIAZEPAM", "LORAZEPAM", "ZOLPIDEM",
    "SUMATRIPTAN", "NAPROXEN", "KETOPROFEN", "KETOROLAC", "CELECOXIB",
    "MELOXICAM", "INDOMETHACIN", "TRAMADOL", "MORPHINE", "CODEINE",
    "EPINEPHRINE", "ATROPINE", "TRANEXAMIC ACID", "OXYTOCIN", "MISOPROSTOL",
    "NORETHISTERONE", "LEVONORGESTREL", "CLOMIPHENE", "LETROZOLE",
    "TAMOXIFEN", "ALENDRONATE", "HYDROXYCHLOROQUINE", "SULFASALAZINE",
    "AZATHIOPRINE", "CICLOSPORIN", "TACROLIMUS", "MYCOPHENOLATE",
    "METHYLPHENIDATE", "ATOMOXETINE", "GABAPENTIN", "BACLOFEN",
]


def spelling_variants(name: str) -> list[str]:
    """Catalogue shorthands: VIT D3 -> VITAMIN D3, D-PANTHENOL -> PANTHENOL."""
    out = []
    expanded = re.sub(r"\bVIT\.?\b", "VITAMIN", name, flags=re.IGNORECASE)
    if expanded != name:
        out.append(expanded)
    stripped = re.sub(r"^(?:D|L|DL|ALPHA|BETA|GAMMA|DL-ALPHA)[-. ]+", "", name, flags=re.IGNORECASE)
    if stripped != name:
        out.append(stripped)
    return out


def norm(value: str) -> str:
    """Mirror app.js clean(): lowercase, unify separators, drop punctuation."""
    text = re.sub(r"[+/,;._()\-]+", " ", value)
    return re.sub(r"\s+", " ", text).strip().lower()


def split_ingredients(sci: str) -> list[str]:
    parts = re.split(r"[+,;/]|\band\b(?=\s)", sci, flags=re.IGNORECASE)
    out = []
    for part in parts:
        part = part.strip()
        if part:
            out.append(part)
    return out


def candidates(name: str) -> list[str]:
    """Query spellings to try for one catalogue ingredient name."""
    out = []
    inner = re.findall(r"\(([^)]+)\)", name)
    base = re.sub(r"\([^)]*\)", "", name).strip()
    for cand in inner + [base]:
        cand = cand.strip()
        if cand and cand.upper() not in [c.upper() for c in out]:
            out.append(cand)
    for cand in list(out):
        for variant in spelling_variants(cand):
            if variant.upper() not in [c.upper() for c in out]:
                out.append(variant)
                mapped_v = ALIASES.get(variant.upper())
                if mapped_v and mapped_v.upper() not in [c.upper() for c in out]:
                    out.append(mapped_v)
    mapped = ALIASES.get(base.upper())
    if mapped and mapped.upper() not in [c.upper() for c in out]:
        out.append(mapped)
    return out


def base_name(generic: str) -> str:
    words = [w for w in re.split(r"\s+", generic.lower()) if w not in SALT_WORDS]
    return " ".join(words)


def fetch(url: str) -> dict | None:
    global _last_request
    with _rate_lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def query_openfda(candidate: str) -> list[dict]:
    key = re.sub(r"[^A-Za-z0-9]+", "_", candidate).strip("_").lower()
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    q = urllib.parse.quote(f'openfda.generic_name:"{candidate}"')
    url = f"{API}?search={q}&limit=5"
    data = fetch(url)
    results = (data or {}).get("results") or []
    if not results:
        # Exact phrase misses labels that carry a salt suffix
        # ("TRAMADOL HYDROCHLORIDE"); fall back to an AND of the tokens.
        tokens = [t for t in re.split(r"\s+", candidate.strip()) if t]
        if tokens:
            q2 = "+AND+".join(f"openfda.generic_name:{urllib.parse.quote(t)}" for t in tokens)
            data2 = fetch(f"{API}?search={q2}&limit=5")
            results = (data2 or {}).get("results") or []
    path.write_text(json.dumps(results), "utf-8")
    return results


def pick_label(results: list[dict], candidate: str) -> dict | None:
    want = base_name(candidate)
    best, best_score = None, -1
    for r in results:
        generics = [g.lower() for g in (r.get("openfda", {}).get("generic_name") or [])]
        single = any(" and " not in g and base_name(g) == want for g in generics)
        exact = any(g == candidate.lower() for g in generics)
        score = 0
        if single:
            score += 100
        if exact:
            score += 40
        present = 0
        for field, _cap in SECTIONS.values():
            if r.get(field):
                present += 1
        score += present * 3
        score += min(sum(len((r.get(f) or [""])[0]) for f, _ in SECTIONS.values()) // 5000, 10)
        if score > best_score:
            best, best_score = r, score
    if best is None:
        return None
    # Require at least one dosing/indication section to be useful.
    if not (best.get("indications_and_usage") or best.get("dosage_and_administration")):
        return None
    return best


def trim(text: str, cap: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= cap:
        return text
    cut = text[:cap]
    m = list(re.finditer(r"[.!?]\s", cut))
    if m and m[-1].end() > cap * 0.5:
        cut = cut[: m[-1].end()].strip()
    else:
        cut = cut.rsplit(" ", 1)[0].strip()
    return cut + " …"



XR_LABEL_RE = re.compile(
    r"\b(XR|ER|SR|CR|XL|DR)\b|EXTENDED[- ]?RELEASE|MODIFIED[- ]?RELEASE"
    r"|SUSTAINED[- ]?RELEASE|PROLONGED[- ]?RELEASE|RETARD",
    re.I,
)
STRENGTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%|units?)\b", re.I)


def label_strengths(*texts: str) -> list[str]:
    out: list[str] = []
    for text in texts:
        for m in STRENGTH_RE.finditer(text or ""):
            pair = f"{m.group(1)} {m.group(2).lower().rstrip('s')}"
            if pair not in out:
                out.append(pair)
            if len(out) >= 20:
                return out
    return out

def extract(label: dict) -> dict:
    sections = {}
    for out_key, (field, cap) in SECTIONS.items():
        values = label.get(field)
        if not values and out_key in FALLBACK_SECTIONS:
            f2, cap2 = FALLBACK_SECTIONS[out_key]
            values, cap = label.get(f2), cap2
        if values:
            text = trim(values[0], cap)
            if len(text) > 60:
                sections[out_key] = text
    of = label.get("openfda", {})
    set_id = (of.get("spl_set_id") or [""])[0]
    date = str(label.get("effective_time") or "")
    brands = of.get("brand_name") or []
    ai_text = (label.get("active_ingredient") or [""])[0]
    dfs_text = (label.get("dosage_forms_and_strengths") or [""])[0]
    return {
        "sections": sections,
        "source": {
            "name": "U.S. FDA label via openFDA / DailyMed (NLM)",
            "dailymed": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={set_id}" if set_id else "",
            "openfda": "https://open.fda.gov/apis/drug/label/",
            "label_date": f"{date[:4]}-{date[4:6]}-{date[6:8]}" if len(date) == 8 else "",
            "us_brand": brands[0] if brands else "",
            "us_brands": brands[:6],
            "manufacturer": (of.get("manufacturer_name") or [""])[0],
            "product_type": (of.get("product_type") or [""])[0],
            "routes": (of.get("route") or [])[:6],
            "strengths": label_strengths(ai_text, dfs_text),
            "extended_release": bool(
                XR_LABEL_RE.search(" ".join(brands)) or XR_LABEL_RE.search((dfs_text or "")[:400])
            ),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=600)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    drugs = json.loads(DRUGS.read_text("utf-8"))
    counts: Counter = Counter()
    display: dict[str, str] = {}
    for row in drugs:
        for part in split_ingredients(row.get("scientific_name") or ""):
            key = norm(part)
            counts[key] += 1
            display.setdefault(key, part)

    top = counts.most_common(args.top)
    have = {k for k, _n in top}
    extras_norm = [norm(e) for e in EXTRAS]
    for key in counts:
        if key in have:
            continue
        if any(re.search(r"\b" + re.escape(e) + r"\b", key) for e in extras_norm):
            top.append((key, counts[key]))
            have.add(key)

    def resolve(rank_key):
        _rank, (key, _n) = rank_key
        name = display[key]
        for cand in candidates(name):
            results = query_openfda(cand)
            if results:
                label = pick_label(results, cand)
                if label:
                    return key, name, label
        return key, name, None

    resolved: dict[str, tuple[str, dict | None]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, (key, name, label) in enumerate(pool.map(resolve, enumerate(top))):
            resolved[key] = (name, label)
            if (done + 1) % 50 == 0:
                print(f"  …{done + 1}/{len(top)}", flush=True)

    items: list[dict] = []
    index: dict[str, int] = {}
    misses: list[str] = []
    for key, _n in top:
        name, label = resolved[key]
        if not label:
            misses.append(name)
            continue
        entry = extract(label)
        if len(entry["sections"]) < 2:
            misses.append(name)
            continue
        entry["names"] = sorted({name.upper()} | {c.upper() for c in candidates(name)})
        items.append(entry)
        index[key] = len(items) - 1
        for cand in candidates(name):
            index.setdefault(norm(cand), len(items) - 1)

    payload = {
        "meta": {
            "source": "U.S. FDA Structured Product Labels via the openFDA drug label API; full labels on DailyMed (U.S. National Library of Medicine)",
            "retrieved": time.strftime("%Y-%m-%d"),
            "count": len(items),
            "note": "Educational summary of a U.S. product label, trimmed for offline reading. Not clinically reviewed. Egyptian products can differ; the current local leaflet and a doctor or pharmacist are the reference.",
        },
        "items": items,
        "index": index,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    size = OUT.stat().st_size
    print(f"matched {len(items)}/{len(top)} ingredients; {size/1e6:.1f} MB -> {OUT}")
    print(f"misses ({len(misses)}): {', '.join(misses[:60])}")


if __name__ == "__main__":
    main()
