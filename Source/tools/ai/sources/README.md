# Offline knowledge sources

This folder holds the local copies of the official documents that are ingested into the app's
offline knowledge index. The app itself never browses the web: whatever is not indexed here (plus
the bundled condition topics) simply is not available to the assistant.

## What may be added

Only documents whose published URL host appears in `webapp/assets/ai/policy-config.json` under
`sources.allowedDomains`:

- Egyptian: Egyptian Drug Authority (`edaegypt.gov.eg`), Ministry of Health and Population
  (`mohp.gov.eg`), official Egyptian price lists and patient leaflets published by those bodies.
- International: NIH and MedlinePlus health topic page summaries, FDA / DailyMed, EMA, NICE.

Being on the allowlist only means the tool will accept the host; the licence still has to allow
redistributing a commercial app. WHO pages are CC BY-NC-SA (non-commercial, share-alike) and CDC
refuses programmatic fetching (HTTP 403), so nothing from either is ingested, and the A.D.A.M.
encyclopedia text on a MedlinePlus page is licensed content that is never copied. See
"Adding a trusted document" in `AI.md`.

`build_knowledge_index.py` reads that list from the policy file and refuses every other host, so
the check is code and not a convention. If you genuinely need another source, add the host to the
policy first and say why in the commit — the allowlist is the only door.

## Adding a document

1. Save the page or the leaflet text here under a stable name, e.g. `eda-recalls-alerts.html`.
   Keep the wording exactly as published; do not paraphrase into this file.
2. Add an entry to `tools/ai/sources.json` using the shape in `sources.example.json`.
   `date` is the publication or last-updated date printed on the source, not the day you saved it.
3. Rebuild:

   ```bash
   python3 tools/ai/build_knowledge_index.py --emit-fts-check
   ```

   It writes `webapp/assets/ai/knowledge-index.json`, `tools/ai/out/knowledge.sqlite` (the FTS5
   reference copy) and `tools/ai/out/fts-check.json` for the cross-engine test.
4. Re-sync the web assets so the new index reaches every platform bundle:

   ```bash
   scripts/sync-web.sh
   ```

Rejected entries are printed with the reason, and a document whose text falls below 120
characters after tag removal is dropped rather than indexed.

## Arabic reachability

`aliases-ar.json` carries Arabic names for the English condition topics. It translates topic titles
only, never medical statements, so an Arabic question can reach an English document. Add a key when
you want another title reachable in Arabic.

## What is never indexed here

`webapp/assets/egyptian-drugs.json` (the 25,070 medicine rows) stays where it is and is searched
directly. Those rows carry trade names, ingredient, company, class, route and price but no source
column, so `dataset-meta.json` records the version and date and the assistant labels such answers
"مصدر البيانات: قاعدة بيانات التطبيق" instead of implying an official leaflet.
