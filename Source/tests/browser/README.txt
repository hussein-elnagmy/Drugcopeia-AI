Real-browser smoke test for the web assistant (puppeteer-core + Google Chrome).
  1. cd Source/www && python3 -m http.server 8181 --bind 127.0.0.1
  2. npm i puppeteer-core; mkdir -p /tmp/shots
  3. node tests/browser/unsupported-fallback.js     (no model; ~40 s)
  4. node tests/browser/web-assistant-smoke.js      (downloads the 469 MB model, ~6 min on 1 core)
web-assistant-smoke.js maps drug.test to 127.0.0.1 because index.html skips the service worker on
127.0.0.1/localhost, and spoofs navigator.deviceMemory=8 (the app needs 3 GB; a small CI VM reports 2).
It logs every drafted model answer, so a guard rejection can be told from a model failure.
