## r181 - 2026-11-24 - off-topic gate fix found by the first real-browser test of the web assistant

Found by running r180 in real Chrome 157 with the real model (Qwen2.5-0.5B via wllama):
- "What is the best pasta recipe for dinner?" was not refused. The ordinary word "best" matched
  Egyptian product names, so the gate scored the question as a medicine question and the
  assistant showed cosmetic and massage-gel product cards.
- "Who won the football World Cup in 2018?" passed the gate the same way and ended in a
  "no matching record" page with WHO/NHS/NIH links that carried the sports query.

Fixed in webapp/ai/safety.js and webapp/assets/ai/policy-config.json:
- policy-config.json -> offTopic.commonWords.en: 544 ordinary English words that also exist
  in the medicine and document index (best, free, price, world...). They no longer count as
  a medicine-name hit on their own. Health words (pain, cold, virus, blood, skin, drug...) are
  not in the list, and a real brand written with them (Panadol Cold) is unaffected.
- A question with an off-topic term and no health signal at all is now refused on one hit
  instead of two. New off-topic terms: world cup, who won, pasta, dinner, lunch, restaurant,
  movie, song, lyrics and Arabic equivalents.
- Privacy gate unchanged (0 violations); no network or storage change.
- Assistant suite 180/180 (176 + 4 regression tests: World Cup phrasings, pasta/restaurant/movie
  phrasings, real medicine questions still pass, end-to-end refusal with no card and no model call).
- Browser check (real Chrome, real model): the pasta and World Cup questions now return the
  fixed medicine-only refusal in English and Egyptian Arabic, with no network request carrying
  question text. Offline reload still answers.

Output guard, investigated and left unchanged: the model's drafts for "side effects of Panadol"
were invented ("abdominal pain, nausea, dizziness, dry mouth": none of it is in the record,
which holds name, ingredient, maker, class and price only), and the Arabic Concor draft was
"الإجابة بالعربي هي: 99". The guard was right to reject both; it was not over-rejecting.
## r180 - 2026-11-24 - the assistant model runs in the browser too (all 5 platforms)

- The web/PWA build now runs the same free on-device model (Qwen2.5-0.5B-Instruct,
  Apache-2.0) as the four native shells, through a fifth transport: wllama 4.0.0
  (llama.cpp compiled to WebAssembly, MIT), vendored untouched in
  webapp/ai/vendor/wllama/ with both the main and the Safari compat wasm builds,
  pinned by SHA-256 and enforced by the privacy gate. No CDN, no account, no API
  key, nothing shipped inside the app but the runtime itself.
- webapp/ai/wasm-bridge.js implements the full runtime contract over OPFS:
  resumable download through DawayaNet.modelDownload (the privacy gate's one
  door to huggingface.co and its CDN), streaming SHA-256 verification, import
  from device with the same checksum rule, lazy load, token streaming,
  cancellation with partial text, and a ChatML wrap byte-identical to the
  iOS/Android/Windows shells.
- Medical-only answers, sources and the doctor/pharmacist reminder are
  unchanged: the same seven-step pipeline (topic gate, emergency rules,
  retrieval first, output guard) runs on every platform, and sources plus the
  disclaimer are still appended by code, never written by the model.
- The page CSP gained 'wasm-unsafe-eval', worker-src blob: and the two model
  hosts in connect-src; privacy.config.json explains why. Offline mode still
  refuses the download, and nothing fetches the model on a timer.
- Assistant suite: 176/176 (168 + 8 for the web transport: ChatML parity,
  parameter mapping, the streamed checksum, transport order, streaming and
  cancellation, the gate, the pins). Privacy gate: 0 violations.
- Revision 180 synced across all 5 web copies (webapp, www, iOS, Android,
  Windows). Native shells are unchanged: Android still builds libllamaserver.so
  from pinned llama.cpp source in CI, Windows embeds the official hash-checked
  runtime, iOS/macOS embed llama.xcframework. A browser without WebAssembly,
  OPFS or enough memory keeps the grounded smart-search fallback.

# Drugcopeia release notes

## r179 - 2026-11-24 - Android on-device AI runtime built in CI

- The Android CI job now builds the llama.cpp server from source (release tag b11985,
  commit 6d194531e1e5876d5d1a0641ce3ca7dae23f94ad, pinned and verified in the workflow)
  with the Android NDK, strips it, and packages it as lib/arm64-v8a/libllamaserver.so
  together with the NDK's libomp.so, so the APK's assistant runs the on-device model
  instead of falling back to grounded smart search. The server's embedded web UI assets
  come from the official ggml-org/llama-ui bucket and are sha256-verified before the
  build uses them. Provenance and local rebuild steps: Source/android/llama/README.txt.
- No app code changed; the DawayaLLM plugin already loads libllamaserver.so when present.
- Revision 179 synced across all 5 web copies; assistant suite still 168/168; the
  privacy gate passes.

## r178 - 2026-11-24 - build fixes: privacy gate, Android platform package

- Privacy gate violations fixed (27 -> 0): calculator history and study-stats storage
  keys declared and covered by delete-all; doi.org and www.ncbi.nlm.nih.gov declared as
  tap-to-open reference links; iOS/macOS usage-description strings synced to
  privacy.config.json; the pregnancy page back button is the unified arrow with an
  accessible label; the two pregnancy-dataset fetches go through DawayaNet; native
  secure-key lists (Android, iOS, macOS) updated; PRIVACY.md added at the repository
  root with the store Data safety declarations.
- Android: @capacitor/android 8.5.3 added to package.json (matches core/ios/cli
  8.5.3), fixing the missing :capacitor-android gradle project. android/local.properties
  (machine-specific SDK path) is ignored by CI.
- iOS CI builds unsigned for a device destination: llama.xcframework ships ios-arm64
  and macOS slices only, no simulator slice.
- Revision 178 synced across all 5 web copies; assistant suite still 168/168; the
  privacy gate passes.


## r177 - 2026-11-23 - grounded assistant, official sources, no guessing

- Assistant retrieval fixed: Arabic spellings (بنادول/بانادول, أوجمينتين/أوجمنتين) and typed
  strengths resolve again; the exactName tier of the search index is now the single identity
  check, and a typed strength promotes the pack that carries it (PANADOL ADVANCE 500 MG).
- Output guard no longer treats ordinary English words ("before") as brand claims.
- No guessing: the general-knowledge route is disabled by policy; unanswered health
  questions get the no-data reply with links to MedlinePlus, NHS, NLM and WHO.
- Every medicine answer carries code-added official verification links (Egyptian Drug
  Authority, Egyptian Ministry of Health, DailyMed/NLM, NHS); every reply ends with the
  doctor-and-pharmacist reminder. Sources the model writes are still impossible: links and
  the disclaimer are appended by code only.
- Assistant suite is green: 168/168 (was 152/167). The CPU-count test no longer depends on
  the host machine.
- Source labels render in the answer's language (Arabic and English).
- Native builds unchanged from r176: web copies synced at r177; Android libllamaserver.so
  and Windows llama-server.exe remain outside this archive; Capacitor toolchain alignment
  is still pending and is being handled with the GitHub Actions build work.


Based on the delivered Dawaya build 48 / revision 174 source. No native binary was built.

## Changed
- Visible brand renamed to Drugcopeia in web UI and native display-name settings. App IDs, native class names, executable paths and localStorage keys are unchanged for compatibility.
- Black-outline D and capsule on white, with an inverse white-on-black dark logo. Capsule halves are hollow, separated by a line. This follows the owner's latest line-art direction. Web logos follow the in-app theme; iOS icon assets include dark appearance and Android includes night resources. Windows ICO and fixed PWA install icons use the light variant. Teal UI accents are unchanged.
- Teal palette in light and dark themes, rounded desktop sidebar, floating icon-only mobile navigation. Text labels remain available to screen readers.
- Search results are dropdown-only in the main/medicine search, condition picker, lab search and pregnancy search. Selecting an item opens the existing detail. Directory browsing is retained.
- Fixed the previous price-test path and missing pregnancy Back translation. Kept internal runtime names unchanged.
- Web revision 176 is stamped in every output. sync:web now calls the same sync:all path. The sync script no longer runs a secondary generator automatically; privacy checks remain a separate release requirement.

## Verification
- Browser interaction checks: drug database 25,070 records, matching dropdown, no duplicate result grid, selecting medicine opens detail; conditions/labs/pregnancy pickers open their details.
- Browser layouts: 320px, 390px and 1440px, English/Arabic, light/dark samples. No document-level horizontal overflow in tested flows, no uncaught JavaScript errors in those flows. Screenshots are browser renders, not native/device captures.
- Revision consistency check passes across webapp, www, iOS public, Android public and Windows www. Price-parser regression tests pass. These are bounded checks, not a guarantee that every app function works.

## Before a native/public release
- Existing native dependency mismatch: package.json pins Capacitor 8.5.3 for core/ios/cli but Android is absent; iOS SwiftPM still pins 7.4.4. Choose and test a consistent Capacitor toolchain before syncing or compiling. Do not blindly upgrade native bridges.
- Android old APK in original archive was 1.7.1/40. No APK/IPA/EXE/DMG is included here. Native display/icon changes have not been compiled or device-tested. Signing and release version codes remain local release work.
- This package preserves required vendor framework/library source assets. It does not contain a newly compiled release.
- Pregnancy dataset remains unreviewed model-authored material, not verified against current product labels. Same-spec price comparison still has the inherited release-type inference and partial coverage. Calculator citations/formulas, interactions and AI medical output require source verification and clinician review before public use.
- App Store dose-calculator guideline 1.4.1 eligibility is NOT established by adding citations. Check publisher eligibility, current official sources and review requirements before submission.
- News headlines shown in screenshots are saved bundled content. External requests were blocked in the render environment, so the app honestly shows a refresh failure, not a live-news verification.

## Assistant checks added in revision 176
- Fixed visible assistant name in bilingual message bundles.
- Removed unrelated body-text-only document matches from assistant results, required exact normalized identity evidence for drug cards, and stopped falsely calling co-occurring sources a conflict. This is deliberately more conservative and may return no data for misspellings.
- General ingredient notes without per-note source references are no longer passed as grounded assistant evidence.
- Smart-search answers explicitly say they are matching records, not one clinical answer, and warn that brand formulations differ and prices are saved data.
- Browser uses smart search without a local LLM runtime. Native generation and model download were not run. Compiled helper/runtime files excluded from source delivery must be restored through an audited build setup before claiming native generation works.

- Follow-up safety tightening: medicine matches no longer append condition articles. Document cards require their complete title or known alias in the question; unrecognized condition names may now return no data rather than guessing. English source labels and bilingual no-source notices corrected.
- Legacy AI suite: 152/167 passed on Node 22 with the final retrieval guard. Failures include Arabic alias/name retrieval, pipeline assumptions, output-guard cases and CPU-count test environment. This is NOT a release-ready or fully passing assistant. See VERIFICATION-r176.txt.

- Fixed mobile/tablet composer overlap by keeping the input in document flow below the messages. Long answers remain scrollable without the composer hiding their text.
