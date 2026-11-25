# Dawaya AI — the on-device health assistant

The assistant answers questions about Egyptian medicines and general health entirely on the
device. A small open-source instruction model (Qwen2.5-0.5B-Instruct, GGUF Q4_K_M, 469 MB,
Apache-2.0) is downloaded once, checked against a SHA-256, and run through llama.cpp by the native
shell. It is chosen because it fits phones that are years old: a 4 GB iPhone 11 and a 3 GB iPhone X,
XR or SE 2 all load it, and it is the same ChatML model family the shells were already wrapping
prompts for, so Arabic and English keep working with no native change. No question,
answer or fragment of either is sent anywhere, and the assistant keeps working with no model at all
by falling back to smart search over the bundled database.

```
webapp/ai/
  text.js          normalization, Arabic letter folds, transliteration, fuzzy scoring
  search-index.js  BM25 index with name buckets, vowel skeletons and a one-edit typo pass
  safety.js        sanitize, topic gate, emergency rules, output guard
  retrieval.js     step 4: Egyptian database first, trusted documents second, cards and sources
  model-manager.js capability check, one-time download, checksum, import, lazy load
  llm-bridge.js    the five transports (native, Capacitor, Windows loopback, web wasm, none)
  wasm-bridge.js   the web/PWA transport: wllama (llama.cpp compiled to WebAssembly), the
                   model in OPFS, the download through DawayaNet.modelDownload
  vendor/wllama/   the pinned wllama 4.0.0 release (MIT), both wasm builds, no CDN
  pipeline.js      the seven ordered steps, prompts, fixed messages
  secure-history.js optional encrypted local chat history (off by default)
  chat-ui.js       the screen: streaming text, sources, disclaimer, RTL
webapp/assets/ai/
  model-config.json      model name, URL, size, SHA-256, generation parameters
  policy-config.json     allowlist, thresholds, keywords, emergency and injection patterns
  messages-ar.json       every fixed Arabic string, including the disclaimer
  messages-en.json       the same in English
  prompts/               system, chat and borderline-classifier prompts (Arabic and English)
  dataset-meta.json      version and date printed with every database-sourced answer
  knowledge-index.json   trusted-document passages exported from tools/ai/build_knowledge_index.py
```

Every fixed string the user sees is in `messages-*.json` and printed by code. The model only ever
produces the summary body of a grounded answer; the sources and the disclaimer are appended by
`pipeline.js` for every result type.

## The seven steps

1. **Sanitize** — strip invisible characters and prompt injection, cap the length, reject empty.
2. **Topic gate** — rules first (health keywords, symptoms, Egyptian brand names); the model is
   asked to classify only borderline questions and must answer with strict JSON. Off-topic gets a
   fixed refusal; low confidence gets one clarifying question.
3. **Emergency** — chest pain, stroke signs, breathing difficulty, overdose and similar patterns
   return a fixed message to call 123 / go to the nearest emergency department. No generation.
4. **Retrieval** — the Egyptian medicine database first, then the trusted documents; top 1–3
   records. An empty result stops the run with a fixed Arabic "no data" refusal.
5. **Grounded generation** — the model sees only the retrieved text and the question.
6. **Output guard** — code checks the draft: every number, unit and medicine name must exist in
   the retrieved records, and diagnosis, personal dosing, stop-medication instructions, English
   text or off-topic content reject it. A rejected draft is replaced by the information card.
7. **Sources and disclaimer** — appended by code to every answer, including refusals. A
   medicine answer also carries official verification links (Egyptian Drug Authority,
   Egyptian Ministry of Health, DailyMed/NLM and NHS searches for the ingredient) from
   `policy-config.json → retrieval.verificationLinks`; every URL there was fetched live
   before it was allowed in. The model never writes a link. Every answer ends with the
   doctor-and-pharmacist reminder in `messages-*.json → disclaimer`.

## Model download

The model is described only in `webapp/assets/ai/model-config.json`:

```json
"model": {
  "version": 2,
  "fileName": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "url": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "sizeBytes": 491400032,
  "sha256": "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db"
}
```

`model.version` went from 1 to 2 with this swap, so a device that already downloaded the 1.06 GB
1.5B file deletes it on the next start and offers the smaller one instead of keeping two copies.

- The first visit to the Health assistant screen shows the download panel with the exact size, a
  Wi-Fi recommendation, the free-space requirement, and Start / Pause / Resume / Retry / Cancel.
- The file goes to app-private storage (`Application Support/Dawaya/models` on iOS and macOS,
  `getNoBackupFilesDir` on Android, `%LOCALAPPDATA%\Dawaya\models` on Windows) and is verified
  natively. A mismatch deletes the file and returns to "not downloaded".
- Without a connection the same panel offers **Import from device**: pick the `.gguf` file by its
  exact name and size, and the same checksum runs on it.
- The file is never fetched again unless the reader deletes it or `model.version` is bumped.
- `Settings → Delete model` and the download panel's delete action both remove it.

After changing `model.url` or `model.fileName`, recompute the checksum, update `model.sha256`, and
bump `model.version` so devices re-download.

The download host (`huggingface.co`) and any mirror must stay on the allowlist in
`privacy.config.json`; `scripts/privacy-check.py` fails the build otherwise.

## The web build runs the model too

The browser/PWA build has its own runtime: llama.cpp compiled to WebAssembly (wllama 4.0.0,
MIT, vendored untouched in `ai/vendor/wllama/` - the main build plus the Asyncify compat build
Safari needs; never the jsDelivr CDN fallback). `ai/wasm-bridge.js` is the fifth transport in
`llm-bridge.js`, after the four native ones: a browser with WebAssembly, OPFS and streams gets
the same download panel, the same ChatML wrap the native shells apply byte for byte, the same
pinned SHA-256 (verified with a streaming pure-JS implementation; WebCrypto cannot hash a
stream), and the same answer pipeline. The model is fetched through `DawayaNet.modelDownload`,
the one door in the privacy gate that may reach `huggingface.co` and its `*.hf.co` CDN, GET
only, no credentials, no referrer, only after Offline mode is off and the reader presses
Download; both hosts are in the page CSP `connect-src`, and the CSP also carries
`'wasm-unsafe-eval'` and `worker-src blob:`, which WebAssembly and the inference workers
cannot run without. Downloads resume after a pause or a closed tab (Range requests against the
OPFS file), Import from device accepts the same file and hashes it before keeping it, and a
checksum mismatch deletes the bytes, exactly like the native shells. Inference runs
single-threaded unless the host sends COOP/COEP headers; the medicine database, smart search
and every other assistant feature work without the model either way.

## Devices without enough memory

`model-config.json → device.minRamMB` (2600) decides. A device below the floor, or a build with no
llama.cpp runtime, never loads the model: the same pipeline runs steps 1–4 and step 7 and returns
the information card with a "smart search" note. The card is built from database fields, not from a
model draft, and carries the same sources.

The floor is what the model file makes possible. With the 1.06 GB 1.5B file it had to stay at
3000 MB, so 2 GB and 3 GB phones were refused; the 469 MB 0.5B file runs on a 3 GB phone, and only a
2 GB device - which the OS kills while the model loads - stays on smart search. Between
`minRamMB` and `recommendedRamMB` (4200) the same file runs the `generation.lowMemory` profile:
half the context window and a shorter answer. The threshold sits above 4 GB on purpose - a 4 GB
phone reports about 3.7 GB, and the model file plus the app's own copy of the medicine index is what
pushes that class past what the OS leaves it, so a 4 GB device gets the lean profile and only devices
reporting more than 4 GB get the full 2048-token window.

`device.minFreeRamMBAtLoad` (500) refuses a load when the OS reports less free memory than that, and
`device.lowMemoryMinFreeRamMBAtLoad` (340) is the same gate for a lean device. Android reports
MemAvailable, and a healthy 4 GB phone routinely sits under 500 MB because the OS keeps spare RAM as
reclaimable cache, so the shorter profile is judged against the floor it actually needs. The runtime
on Apple reports half of total RAM as free, so this gate only bites on Android; the guard against
over-committing there is the memory-pressure unload, which releases the model and keeps the download.

## Answering fast, and asking with a photograph

**Tokens stream.** The model writes into the bubble as it generates. Each shell buffers the pieces
it is handed and pushes them to the page on a 50 ms beat rather than one web-view call per token -
`tokenFlushInterval` in `ios/App/App/DawayaLLMPlugin.swift` and `macos/main.swift`,
`TOKEN_FLUSH_MS` in `DawayaLLMPlugin.java`. Windows needs none of that: it streams through the
browser's own `EventSource`. The flush is always run before the generate call resolves, so the tail
of the answer is in the page before the finished state is painted. The waiting line ("Writing") is
dropped by `paintText` as soon as there is text, and the composer shows either Send or Stop, never
both.

**The prompt stays warm.** The system block, the directory records and the chat history are the same
prefix for every turn of a conversation, so `native/apple/LlamaEngine.swift` remembers the tokens it
already decoded (`cachedTokens`), rewinds the KV cache to the first token that differs
(`llama_memory_seq_rm`) and decodes only the new tail - at least `minCachedTokens` (32) of shared
prefix, otherwise the whole prompt is decoded fresh. Android and Windows get the same effect from
llama-server through `cache_prompt: true`. The cache is dropped when the model is loaded or unloaded.

**The context stays short.** `historyBlock()` in `ai/pipeline.js` sends the last few turns only, each
trimmed, and the reference pack is the handful of BM25 passages that matched the question rather than
anything resembling the whole directory. Generation limits - window, tokens, temperature - live in
`assets/ai/model-config.json`, which is what the tests assert against.

**Photographs are read on the device.** The shipped model is text-only, so a picture can never be
sent to it. Instead the composer's attach button (`#aiAttach`) takes a photo from the camera or the
gallery, `ai/photo-ask.js` shrinks it to 1024 px, reads the pack barcode and printed text on the
device, and matches what it read against the medicine directory already on the phone. What matched
goes into the prompt as reference data, marked as read from the photograph. Nothing is uploaded.
Barcode and printed text are read in a different order depending on the platform:

| platform | barcode | printed text |
| --- | --- | --- |
| iOS, macOS | Vision (`native/apple/PhotoReader.swift`, through `DawayaNative.readPhoto`) | Vision, English and Arabic |
| Android, Windows | the browser's `BarcodeDetector` in the WebView | not available - no on-device OCR is bundled |
| any platform without either | the attach button is hidden and the reader is told to type the name | |

The answer line always says which route was taken - barcode matched, printed name matched, or
nothing readable - so the reader is never left guessing whether the photo was understood.

## Adding a trusted document

1. Copy the official page or PDF text into `tools/ai/sources/`.
2. Add an entry to `tools/ai/sources.json` with the title, language, source name, url, publication
   or retrieval date and license. The host must be in `policy-config.json →
   sources.allowedDomains` (EDA, Egyptian MoH, WHO, FDA DailyMed, EMA, NIH/MedlinePlus, NICE, CDC);
   the tool refuses anything else.
3. Run:

```bash
cd Source
python3 tools/ai/build_knowledge_index.py            # local files only
python3 tools/ai/build_knowledge_index.py --fetch    # also download the manifest urls
python3 tools/ai/build_knowledge_index.py --emit-fts-check
```

This rewrites `webapp/assets/ai/knowledge-index.json` and the SQLite reference in
`tools/ai/out/knowledge.sqlite` from one pass. `tests/ai/run-tests.js` then checks that the
in-app index returns the same official pages as FTS5 for a fixed query list.

## What the symptom and disease answers are made of

The assistant answers symptoms, disease and diagnosis questions from the official topic page
summaries already bundled in `webapp/assets/conditions.json` (1,017 MedlinePlus health topics, each
with its own url and retrieval date). `build_knowledge_index.py` cuts every summary at the question
headings the page publishes - "What are the symptoms of…", "How is … diagnosed?" - and ships one
passage per heading (up to two per heading, eight per topic), so a question that asks about
symptoms gets the symptoms passage and not the opening paragraph. The current index is 3,468
passages: Overview 2,103, Causes 402, Treatment 304, Diagnosis 294, Symptoms 255, Prevention 110.
Rebuild it with `--emit-fts-check` after touching `conditions.json` or `aliases-ar.json`.

Source selection is a licence decision, recorded per passage in `source.license`:

- NLM / MedlinePlus **health topic page summaries** are works of the U.S. federal government and
  are public domain, so they are redistributed. See <https://medlineplus.gov/about/using/usingcontent/>.
- The **A.D.A.M. and IMIS encyclopedia text and the ASHP drug information on those same pages are
  licensed content**, not public domain, and are never copied into the app - the builder indexes
  the bundled topic summaries only.
- **WHO** material is published under a non-commercial, share-alike licence (CC BY-NC-SA), which a
  commercial app cannot redistribute, so nothing from who.int is ingested even though the host is
  allowlisted.
- **CDC** publishes public-domain content but refuses programmatic fetching (HTTP 403 for both a
  tool and a browser user agent), so it is not ingested either.
- Egyptian sources (EDA, MoHP) stay allowlisted for leaflets and price lists added by hand to
  `tools/ai/sources/`.

The section heading words in `policy-config.json → retrieval.sectionTags` are never indexed as
searchable text. They only multiply the score of a passage whose page the question already matched
(`retrieval.sectionBoost`), because "symptoms" or "أعراض" alone must not pull an unrelated disease
into an answer about a medicine that does not exist - `tests/ai/run-tests.js` asserts both.

## Updating the Egyptian medicine database

Replace `webapp/assets/egyptian-drugs.json`, then stamp `webapp/assets/ai/dataset-meta.json`:

```json
{ "version": "1.6.6", "date": "2026-10-30", "rows": 25070, "rowsWithoutSource": 25070, ... }
```

The assistant prints this version and date in the source line of every answer that relies on the
database, because those rows carry no per-row source metadata. `tests/ai/run-tests.js` asserts the
version, date and row count against the shipped file.

## Tests and benchmark

From `Source/`:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/ai/run-tests.js
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tools/ai/benchmark.js
```

The suite has 176 cases: normalization, index ranking (English, Arabic and one-letter typos),
sanitize and injection handling, the topic gate, emergencies in Arabic and English, the output
guard (invented numbers and names, diagnosis, dosing, stop instructions, language), grounded
retrieval, every pipeline result type, the model lifecycle including checksum failure, the two
memory profiles and their free-memory floors, the config wiring between the assistant page and the
model manager, the token batching and KV-cache reuse each shell is built with, the single
send/stop control, the typing indicator that the first token removes, the piece-by-piece paint path,
the short history window, the warm-up that runs at app boot rather than on the first question, the
general-knowledge route and the awareness notice that appears once per conversation, the photograph
route (the bundled barcode table, matching a printed brand against the directory, a weak read staying
a weak read, the reader never reaching the network, the strings in both languages and the Vision
reader in every Apple shell), the composer clearing the bottom bar and the home indicator and the
follow-the-newest-line scroll, the runtime knowledge index against the SQLite FTS5 reference,
the product-photograph request rules, the automatic news schedule that replaced the
**Update news** button, and the source allowlist.

Latest results (2026-11-23, Node 22 on Linux):

```
Dawaya AI suite: 176/176 passed
```

Benchmark, last measured 2026-11-01 on this machine:

```
Dawaya AI benchmark
index          4.5 s · 25070 medicines · 3468 passages
retrieval      39/39 questions carry the right record (100%)
latency        median 28 ms · p95 327 ms
smart search   median 60 ms per question (retrieval + card, no model)
generation     not measured · the JavaScriptCore harness has no llama.cpp runtime
               run the app shell (iOS/Android/macOS/Windows) with this script to measure it
```

The 39 questions are a curated set of Egyptian brands in Arabic and English, three
active-ingredient questions and three trusted-document questions; they were used while tuning the
name ranking, so treat 100% as an upper bound rather than a field estimate.

## Known limitations

- **Generation was not benchmarked here.** Tokens per second, load time and RAM need the native
  runtime; the benchmark prints those when it is started inside a shell. The model itself was not
  executed during this build.
- iOS needs 16.4 or later for the bundled llama.cpp XCFramework (`llama.framework` is embedded in
  the IPA); the macOS app embeds the same framework for both arm64 and x86_64; the Windows exe
  embeds the b11985 windows-x64 CPU runtime in `Source/windows/llama/` and unpacks it on first
  launch (see that folder's README for the archive hash it was checked against). Android is arm64
  only. None of the four has been measured for tokens per second from this machine.
- The Apple XCFramework carries no upstream version marker inside the binary, so its llama.cpp
  revision is recorded only by the build note above and cannot be re-verified from the shipped file.
- The output guard is deliberately strict. When it rejects a draft the reader sees the information
  card instead of a summary, which is the intended behaviour but can feel blunt for questions the
  database answers only partly.
- Retrieval covers the medicine database and the trusted-document index. A question about a
  medicine that is not in the database gets the "no data" refusal rather than a guess.
- Chat history is on by default. It is encrypted before it is written, stays in app-private
  storage, and "Clear chat" or the Privacy screen erases it; the Dawaya AI menu turns it off.
