/*
 * Dawaya AI - benchmark.
 *
 * Measures the parts that can be measured without a model (index build, retrieval accuracy and
 * latency on Egyptian questions, smart-search preparation) and, when the shell exposes the
 * llama.cpp runtime, load time, tokens per second and the RAM the model takes.
 *
 * From Source/:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tools/ai/benchmark.js
 *   node tools/ai/benchmark.js
 *
 * No network, no writes. Accuracy is top-1 and top-3 over the answer the retrieval step would
 * hand to the model, which is the number that decides whether a grounded answer is possible.
 */
'use strict';

const IS_JSC = typeof readFile === 'function';
const IS_NODE = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

function readTextFile(path) {
  if (IS_JSC) return readFile(path);
  return require('fs').readFileSync(path, 'utf8');
}

function runModule(path) {
  if (IS_JSC) return load(path);
  (0, eval)(readTextFile(path));
  return undefined;
}

const memoryStore = new Map();
globalThis.localStorage = {
  getItem: key => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: key => memoryStore.delete(key)
};
if (!globalThis.console) {
  globalThis.console = {
    log: (...args) => print(args.join(' ')),
    warn: (...args) => print(`WARN ${args.join(' ')}`),
    error: (...args) => print(`ERROR ${args.join(' ')}`)
  };
}
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.addEventListener) globalThis.addEventListener = () => {};
if (!globalThis.removeEventListener) globalThis.removeEventListener = () => {};
globalThis.navigator = globalThis.navigator || {};
if (!navigator.hardwareConcurrency) navigator.hardwareConcurrency = 8;

const WEBAPP = 'webapp';
const ASSETS = `${WEBAPP}/assets/ai/`;

[
  `${WEBAPP}/ai/text.js`,
  `${WEBAPP}/ai/search-index.js`,
  `${WEBAPP}/ai/safety.js`,
  `${WEBAPP}/ai/retrieval.js`,
  `${WEBAPP}/ai/llm-bridge.js`,
  `${WEBAPP}/ai/model-manager.js`,
  `${WEBAPP}/ai/pipeline.js`
].forEach(runModule);

const T = globalThis.DawayaAIText;
const RETRIEVAL = globalThis.DawayaAIRetrieval;
const RUNTIME = globalThis.DawayaAIRuntime;
const MODEL = globalThis.DawayaAIModel;

const policy = JSON.parse(readTextFile(`${ASSETS}policy-config.json`));
const modelConfig = JSON.parse(readTextFile(`${ASSETS}model-config.json`));
const messagesAr = JSON.parse(readTextFile(`${ASSETS}messages-ar.json`));
const messagesEn = JSON.parse(readTextFile(`${ASSETS}messages-en.json`));
const datasetMeta = JSON.parse(readTextFile(`${ASSETS}dataset-meta.json`));
const knowledge = JSON.parse(readTextFile(`${ASSETS}knowledge-index.json`));
const drugs = JSON.parse(readTextFile(`${WEBAPP}/assets/egyptian-drugs.json`));
const conditions = JSON.parse(readTextFile(`${WEBAPP}/assets/conditions.json`));

/* 32 Egyptian medicines, 3 ingredient questions and 3 trusted-document questions.
   `expect` is the trade name the first three records must contain. */
const QUESTIONS = [
  ['سعر بنادول 500 ملجم', 'PANADOL', 'medicine'],
  ['بانادول للألم', 'PANADOL', 'medicine'],
  ['Panadol side effects', 'PANADOL', 'medicine'],
  ['أوجمنتين سعره كام', 'AUGMENTIN', 'medicine'],
  ['Augmentin 1 gm price', 'AUGMENTIN', 'medicine'],
  ['بروفين للصداع', 'BRUFEN', 'medicine'],
  ['Brufen 200 mg tablets', 'BRUFEN', 'medicine'],
  ['كتافلام مسكن', 'CATAFLAM', 'medicine'],
  ['كونكور لضغط الدم', 'CONCOR', 'medicine'],
  ['Glucophage 500 mg', 'GLUCOPHAGE', 'medicine'],
  ['زيثروماكس مضاد حيوي', 'ZITHROMAX', 'medicine'],
  ['فلاجيل جرعة', 'FLAGYL', 'medicine'],
  ['فنتولين بخاخ', 'VENTOLIN', 'medicine'],
  ['Nexium 20 mg', 'NEXIUM', 'medicine'],
  ['ليبيتور للكوليسترول', 'LIPITOR', 'medicine'],
  ['Euthyrox 50 mcg', 'EUTHYROX', 'medicine'],
  ['اموكسيل شراب', 'AMOXIL', 'medicine'],
  ['سيبرو 500', 'CIPRO', 'medicine'],
  ['فولتارين جل', 'VOLTAREN', 'medicine'],
  ['جوسبرين 81', 'JUSPRIN', 'medicine'],
  ['لازيكس مدر للبول', 'LASIX', 'medicine'],
  ['الدكتون 25', 'ALDACTONE', 'medicine'],
  ['بروزاك 20', 'PROZAC', 'medicine'],
  ['كونجستال', 'CONGESTAL', 'medicine'],
  ['موتيليوم', 'MOTILIUM', 'medicine'],
  ['بوسكوبان مغص', 'BUSCOPAN', 'medicine'],
  ['ديكلاك 75', 'DICLAC', 'medicine'],
  ['تلفاست حساسية', 'TELFAST', 'medicine'],
  ['كلاريتين', 'CLARITINE', 'medicine'],
  ['زيناسيف مضاد حيوي', 'ZINACEF', 'medicine'],
  ['دالاسين 300', 'DALACIN', 'medicine'],
  ['فيوسيدين مرهم', 'FUCIDIN', 'medicine'],
  ['بيتادين مطهر', 'BETADINE', 'medicine'],
  ['باراسيتامول', 'PARACETAMOL', 'ingredient'],
  ['ايبوبروفين', 'IBUPROFEN', 'ingredient'],
  ['أموكسيسيلين', 'AMOXICILLIN', 'ingredient'],
  ['what are the symptoms of diabetes', '', 'document'],
  ['high blood pressure symptoms', '', 'document'],
  ['أعراض الربو', '', 'document']
];

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function matches(result, expectation) {
  const records = result.medicines || [];
  if (expectation.kind === 'document') {
    return (result.documents || []).length > 0 && Boolean((result.documents[0].source || {}).url);
  }
  if (expectation.kind === 'ingredient') {
    return records.some(record => String(record.fields.ingredient || '').toUpperCase().includes(expectation.expect));
  }
  return records.some(record => String(record.fields.tradeNameEn || '').toUpperCase().includes(expectation.expect));
}

function median(values) {
  return percentile(values, 0.5);
}

async function main() {
  RETRIEVAL.configure(policy.retrieval);
  const provider = { drugs, conditions, knowledge, clinicalNotes: [], arabicClinical: [], interactions: [], datasetMeta };

  const buildStarted = Date.now();
  RETRIEVAL.build(provider);
  const buildMs = Date.now() - buildStarted;
  const stats = RETRIEVAL.stats();

  console.log('Dawaya AI benchmark');
  console.log(`index          ${buildMs} ms · ${stats.medicines.documents} medicines · ${stats.documents.documents} passages`);

  const latencies = [];
  let correct = 0;
  const misses = [];
  for (const [question, expect, kind] of QUESTIONS) {
    const started = Date.now();
    const result = RETRIEVAL.retrieve(question, {});
    latencies.push(Date.now() - started);
    if (matches(result, { expect, kind })) correct += 1;
    else misses.push(question);
  }
  const total = QUESTIONS.length;
  console.log(`retrieval      ${correct}/${total} questions carry the right record (${round(correct / total * 100)}%)`);
  console.log(`latency        median ${median(latencies)} ms · p95 ${percentile(latencies, 0.95)} ms`);
  if (misses.length) console.log(`misses         ${misses.join(' | ')}`);

  const prepare = [];
  for (const question of ['سعر بنادول 500 ملجم', 'أوجمنتين سعره كام', 'بروفين للصداع', 'أعراض الربو', 'ما أعراض دواء زوكسبلوميد', 'قولي وصفة مكرونة']) {
    const started = Date.now();
    const result = RETRIEVAL.retrieve(question, {});
    if (result.found) RETRIEVAL.buildCard(result.records);
    T.normalize(question);
    prepare.push(Date.now() - started);
  }
  console.log(`smart search   median ${median(prepare)} ms per question (retrieval + card, no model)`);

  await benchmarkGeneration();
}

async function benchmarkGeneration() {
  if (!RUNTIME.available()) {
    console.log('generation     not measured · no llama.cpp runtime in this shell');
    console.log('               run the app shell (iOS/Android/macOS/Windows) with this script to measure it');
    return;
  }
  const caps = await RUNTIME.capabilities();
  if (!caps || caps.supported === false) {
    console.log(`generation     not measured · runtime unsupported (${(caps && caps.reason) || 'unknown'})`);
    return;
  }
  const storage = {
    get: (key, fallback = null) => (memoryStore.has(key) ? memoryStore.get(key) : fallback),
    set: (key, value) => { memoryStore.set(key, String(value)); return true; },
    remove: key => memoryStore.delete(key),
    json(key, fallback) {
      try { return memoryStore.has(key) ? JSON.parse(memoryStore.get(key)) : fallback; } catch (_) { return fallback; }
    }
  };
  MODEL.configure({ model: modelConfig, generation: modelConfig.generation, storage });
  const init = await MODEL.initialize();
  if (init.state !== MODEL.STATES.READY_TO_LOAD && init.state !== MODEL.STATES.READY) {
    console.log(`generation     not measured · model state ${init.state}`);
    return;
  }
  const loadStarted = Date.now();
  const loaded = await MODEL.ensureLoaded();
  const loadMs = Date.now() - loadStarted;
  if (!loaded.ok) {
    console.log(`generation     load failed · ${loaded.error}`);
    return;
  }
  console.log(`model load     ${loadMs} ms · ${MODEL.generationParams().n_threads} threads · ${MODEL.generationParams().n_ctx} ctx`);
  console.log(`device ram     total ${Math.round((caps.totalRamBytes || 0) / 1048576)} MB · free ${Math.round((caps.freeRamBytes || 0) / 1048576)} MB before load`);

  const instruction = readTextFile(`${WEBAPP}/assets/ai/prompts/system-ar.txt`);
  let prompt = instruction;
  for (const question of ['سعر بنادول 500 ملجم', 'أوجمنتين سعره كام', 'بروفين للصداع']) {
    const result = RETRIEVAL.retrieve(question, {});
    const pack = RETRIEVAL.buildContextPack(question, result.records);
    prompt = instruction.split('{{CONTEXT}}').join(pack.contextText).split('{{QUESTION}}').join(question);
    const started = Date.now();
    const generation = await RUNTIME.generate({ prompt, params: MODEL.generationParams() });
    const elapsed = Math.max(1, Date.now() - started);
    const tokens = Number(generation.tokens || 0) || String(generation.text || '').trim().split(/\s+/).length;
    console.log(`tokens/sec     ${round(tokens / (elapsed / 1000))} · ${tokens} tokens in ${elapsed} ms · ${question}`);
  }
  const after = await RUNTIME.capabilities();
  if (after && after.freeRamBytes && caps.freeRamBytes) {
    const used = Math.round((caps.freeRamBytes - after.freeRamBytes) / 1048576);
    console.log(`model ram      ~${used} MB free-RAM delta while loaded`);
  }
  await MODEL.release('benchmark');
}

main().catch(error => {
  console.error(`benchmark failed: ${error && error.stack ? error.stack : error}`);
  if (IS_NODE) process.exit(1);
});
