#!/usr/bin/env python3
"""Runtime privacy tests for Dawaya.

Runs the real generated privacy config, the real `webapp/net.js` and the real
app page in headless Chrome, then asserts the behaviour the static gate cannot
prove:

  * online mode is the default; turning Offline mode on blocks even an
    allowlisted host and turning it off restores it;
  * unknown hosts, the retired dataset host, a path outside the prefix, a
    tracking parameter and a non-user-initiated request are refused;
  * sanitize() strips cookies, credentials and identity headers;
  * fetch, XHR and WebSocket are blocked;
  * booting the app makes no remote request;
  * no chat history key is written;
  * typed phone numbers, national IDs and email addresses are stripped before
    search, feedback and add-medicine use them, and no form asks for an email;
  * the "Photos" hosts are opened only for a press, only under their own path,
    and never for an address carrying a tracking parameter;
  * the retired Google photograph hosts are refused even for a press, and no
    Settings field or storage key for that lookup is left in the page;
  * Privacy > Delete all local data removes reminders, the taken log, custom
    drugs and saved conversations.

Usage: /usr/bin/python3 Source/scripts/privacy-tests.py

Requires Google Chrome or Chromium. Exits 0 on success, 1 on a failed
assertion, 2 when no browser is available (the static gate still applies).
"""

import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SOURCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBAPP = os.path.join(SOURCE, "webapp")

TEST_PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dawaya privacy tests</title></head>
<body><pre id="results">RUNNING</pre>
<script src="/generated/privacy-config.js"></script>
<script src="/net.js"></script>
<script>
(function () {
  'use strict';
  var lines = [], failures = 0;
  function record(name, ok, detail) {
    lines.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' [' + detail + ']' : ''));
    if (!ok) failures += 1;
  }
  function finish() {
    document.getElementById('results').textContent = lines.join('\n') + '\nDONE failures=' + failures;
  }
  function block(name, fn, reason) {
    return Promise.resolve().then(fn).then(function () {
      record(name, false, 'was allowed');
    }).catch(function (error) {
      record(name, Boolean(error) && error.reason === reason, error && (error.reason || error.name));
    });
  }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function main() {
    localStorage.clear();
    record('online is the default', DawayaNet.isOffline() === false);
    DawayaNet.setOffline(true);
    record('offline can be turned on', DawayaNet.isOffline() === true);
    await block('offline blocks an allowlisted host',
      function () { return DawayaNet.request('https://www.who.int/api/hubs/newsitems'); },
      'offline-mode');

    DawayaNet.setOffline(false);
    record('offline can be turned off', DawayaNet.isOffline() === false);

    await block('unknown host is refused',
      function () { return DawayaNet.request('https://example.com/'); }, 'host-not-allowlisted');
    await block('retired dataset host is refused',
      function () { return DawayaNet.request('https://raw.githubusercontent.com/a/b'); }, 'host-not-allowlisted');
    await block('suffix lookalike is refused',
      function () { return DawayaNet.request('https://www.who.int.evil.example/'); }, 'host-not-allowlisted');
    await block('path outside the prefix is refused',
      function () { return DawayaNet.request('https://www.who.int/some-page'); }, 'host-not-allowlisted');
    await block('tracking parameter is refused',
      function () { return DawayaNet.request('https://api.fda.gov/drug/enforcement.json?utm_source=x'); },
      'identifier-in-url');
    /* The three news hosts are the ones the app may reach on its own schedule, so
       the two rules that used to protect them - a button press and the offline
       switch - now have to be checked separately. The schedule is what changed;
       offline mode is what still stops it. */
    record('the scheduled news fetch needs no press', (function () {
      try {
        return DawayaNet.check('https://api.fda.gov/drug/enforcement.json').allowed === true;
      } catch (_) { return false; }
    })());
    DawayaNet.setOffline(true);
    await block('offline blocks the scheduled news fetch',
      function () { return DawayaNet.check('https://api.fda.gov/drug/enforcement.json'); },
      'offline-mode');
    DawayaNet.setOffline(false);
    await block('the commons photo lookup is refused without a press',
      function () {
        return DawayaNet.check('https://commons.wikimedia.org/w/api.php?action=query&generator=search'
          + '&gsrnamespace=6&gsrsearch=panadol&format=json&origin=*');
      },
      'requires-user-initiation');
    record('the commons photo lookup opens for a press', (function () {
      try {
        return DawayaNet.check('https://commons.wikimedia.org/w/api.php?action=query&generator=search'
          + '&gsrnamespace=6&gsrsearch=panadol&format=json&origin=*', { userInitiated: true }).allowed === true;
      } catch (_) { return false; }
    })());
    await block('a commons page outside the api path is refused',
      function () {
        return DawayaNet.check('https://commons.wikimedia.org/wiki/Panadol', { userInitiated: true });
      },
      'host-not-allowlisted');
    await block('the preview host is refused without a press',
      function () {
        return DawayaNet.check('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/'
          + 'Panadol_box.png/500px-Panadol_box.png');
      },
      'requires-user-initiation');
    record('the preview host opens for a press', (function () {
      try {
        return DawayaNet.check('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/'
          + 'Panadol_box.png/500px-Panadol_box.png', { userInitiated: true }).allowed === true;
      } catch (_) { return false; }
    })());
    record('the full-size file host opens for a press', (function () {
      try {
        return DawayaNet.check('https://upload.wikimedia.org/wikipedia/commons/a/ab/Panadol_box.png',
          { userInitiated: true }).allowed === true;
      } catch (_) { return false; }
    })());
    /* MediaWiki hangs a utm_* trail on every address it hands back, so the very
       picture the gallery is allowed to fetch is refused the moment it does. */
    await block('a commons image with a tracking parameter is refused',
      function () {
        return DawayaNet.check('https://upload.wikimedia.org/wikipedia/commons/a/ab/Panadol_box.png'
          + '?utm_source=dawaya&utm_campaign=search', { userInitiated: true });
      },
      'identifier-in-url');
    /* The Google photograph lookup this build used to make is retired and its
       hosts are closed: not even a press opens them now. */
    await block('the retired search host is refused even for a press',
      function () {
        return DawayaNet.check('https://www.googleapis.com/customsearch/v1?key=test&cx=test&q=panadol',
          { userInitiated: true });
      },
      'host-not-allowlisted');
    await block('the retired vision host is refused even for a press',
      function () {
        return DawayaNet.check('https://vision.googleapis.com/v1/images:annotate?key=test',
          { userInitiated: true, method: 'POST' });
      },
      'host-not-allowlisted');
    await block('the retired thumbnail host is refused even for a press',
      function () {
        return DawayaNet.check('https://encrypted-tbn0.gstatic.com/images?q=tbn:test',
          { userInitiated: true });
      },
      'host-not-allowlisted');
    await block('external-link host is not fetchable',
      function () { return DawayaNet.request('https://medlineplus.gov/'); }, 'host-not-allowlisted');
    await block('loopback lookalike host is refused',
      function () { return DawayaNet.request('http://127.0.0.1.example/'); }, 'host-not-allowlisted');

    var decision = DawayaNet.check('https://api.fda.gov/drug/enforcement.json');
    record('allowlisted request passes', decision.allowed === true && decision.entry.host === 'api.fda.gov');

    var clean = DawayaNet.sanitize({
      headers: { Cookie: 'session=1', 'X-Device-Id': 'abc', Accept: 'application/json' },
      credentials: 'include',
      referrer: 'https://example.com/'
    });
    record('sanitize strips cookie', !clean.headers.Cookie && !clean.headers.cookie);
    record('sanitize strips identity header', !clean.headers['X-Device-Id'] && !clean.headers['x-device-id']);
    record('sanitize keeps Accept', clean.headers.Accept === 'application/json');
    record('sanitize omits credentials', clean.credentials === 'omit');
    record('sanitize clears referrer', clean.referrer === '' && clean.referrerPolicy === 'no-referrer');
    record('sanitize refuses redirects', clean.redirect === 'error');

    /* The Windows assistant is the app's only POST and its loopback helper
       refuses the call without a JSON content type, so that one value must
       survive the strip. */
    var posted = DawayaNet.sanitize({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    record('sanitize keeps a JSON content type',
      posted.headers['Content-Type'] === 'application/json', JSON.stringify(posted.headers));
    var smuggled = DawayaNet.sanitize({
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    record('sanitize drops an unexpected content type',
      !smuggled.headers['Content-Type'] && !smuggled.headers['content-type']);

    await block('fetch guard blocks an unknown host',
      function () { return fetch('https://example.com/'); }, 'host-not-allowlisted');
    try { new XMLHttpRequest(); record('XMLHttpRequest is blocked', false); }
    catch (error) { record('XMLHttpRequest is blocked', error.reason === 'transport-blocked'); }
    try { new WebSocket('wss://example.com/'); record('WebSocket is blocked', false); }
    catch (error) { record('WebSocket is blocked', error.reason === 'transport-blocked'); }

    /* A credential pasted into the card that 1.7.7 retired has no screen and no
       entry in the delete list left, so loading the app has to erase it. */
    localStorage.setItem('dawaya-photo-search-v1', '{"key":"AIzaSyOrphanedTest","engine":"orphan"}');

    var frame = document.createElement('iframe');
    frame.style.width = '320px';
    frame.style.height = '480px';
    frame.src = '/index.html';
    document.body.appendChild(frame);
    await new Promise(function (resolve, reject) {
      /* The frame is the whole offline app - the 25k-row directory, the knowledge
         index and app.js - and a low-RAM Mac boots it well past 12 s. This budget
         only waits for the load; every assertion below is unchanged by it. */
      var timer = setTimeout(function () { reject(new Error('app iframe did not load')); }, 20000);
      frame.onload = function () { clearTimeout(timer); resolve(); };
    });
    await wait(500);

    record('loading the app erases a photograph key stored before 1.7.7',
      localStorage.getItem('dawaya-photo-search-v1') === null,
      localStorage.getItem('dawaya-photo-search-v1'));

    /* The home page now updates its own headlines, so a boot does reach the
       wire. What still has to hold is that it goes only to the hosts the config
       declares for that schedule: offline mode and the six-hour window are
       checked elsewhere, so here the host set is the thing under test. The
       publishers are slow, so the sample is taken over several seconds rather
       than once at load. */
    var NEWS_HOSTS = ['www.who.int', 'api.fda.gov', 'eutils.ncbi.nlm.nih.gov'];
    var remote = [];
    var frameWindow = frame.contentWindow;
    for (var round = 0; round < 90; round += 1) {
      frameWindow.performance.getEntriesByType('resource').forEach(function (entry) {
        if (entry.name.indexOf(location.origin) === 0) return;
        var host = '';
        try { host = new URL(entry.name).hostname.toLowerCase(); } catch (_) {}
        if (remote.indexOf(host) < 0 && host) remote.push(host);
      });
      if (remote.some(function (host) { return NEWS_HOSTS.indexOf(host) >= 0; })) break;
      await wait(500);
    }
    var strays = remote.filter(function (host) { return NEWS_HOSTS.indexOf(host) < 0; });
    record('app boot contacts only the scheduled news hosts',
      strays.length === 0 && remote.length > 0, remote.join(',') || 'no remote request at all');

    var chatKeys = [];
    for (var i = 0; i < localStorage.length; i += 1) {
      var key = localStorage.key(i);
      if (key && /chat|query-history/i.test(key)) chatKeys.push(key);
    }
    record('no chat key is written before the reader asks', chatKeys.length === 0, chatKeys.join(','));

    var doc = frame.contentDocument;
    function typeInto(field, value) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var searchField = doc.querySelector('#searchInput');
    typeInto(searchField, 'paracetamol 01012345678');
    await wait(150);
    record('search strips a phone number before use', searchField.value === 'paracetamol', searchField.value);
    typeInto(searchField, '29801011234567');
    await wait(150);
    record('search strips a 14-digit national ID', searchField.value === '', searchField.value);
    typeInto(searchField, 'take 2 at 09:30');
    await wait(150);
    record('ordinary numbers and times are kept', searchField.value === 'take 2 at 09:30', searchField.value);
    var notice = doc.querySelector('#privacyGuardNote');
    record('identifier notice is shown after stripping', Boolean(notice) && !notice.hidden);
    record('feedback form asks for no email address',
      !doc.querySelector('#suggestionsPage input[type="email"]') && !doc.querySelector('#suggestionEmail'));
    record('add-medicine form asks for no email address',
      !doc.querySelector('#newMedicinePage input[type="email"]') && !doc.querySelector('#newMedicineEmail'));
    var messageField = doc.querySelector('#suggestionMessage');
    typeInto(messageField, 'my email is someone@example.com and phone 01012345678');
    await wait(150);
    record('feedback message strips email and phone',
      !/@|01012345678/.test(messageField.value), messageField.value);

    var privacy = frame.contentWindow.DawayaPrivacy;
    record('conversation saving is on by default', Boolean(privacy) && privacy.historyEnabled() === true);

    var doc = frame.contentDocument;
    var trigger = doc.querySelector('[data-app-nav="privacy"]');
    record('privacy navigation exists', Boolean(trigger));
    if (trigger) { trigger.click(); await wait(300); }
    var historyToggle = doc.querySelector('#privacyHistory');
    record('the privacy screen shows saving as on', Boolean(historyToggle) && historyToggle.checked === true);
    record('the privacy screen has the conversation list', Boolean(doc.querySelector('#privacyHistoryList')) && Boolean(doc.querySelector('#privacyHistoryClear')));
    record('settings mirrors the conversation switch', Boolean(doc.querySelector('#settingsHistory')) && doc.querySelector('#settingsHistory').checked === true);
    if (historyToggle) {
      historyToggle.checked = false;
      historyToggle.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(200);
    }
    record('turning saving off from privacy erases the saved key',
      privacy.historyEnabled() === false && localStorage.getItem('dawaya-ai-chat-v1') === null);
    if (historyToggle) {
      historyToggle.checked = true;
      historyToggle.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(200);
    }
    record('saving can be turned back on', privacy.historyEnabled() === true);

    /* The photograph key went with the Google lookup it served. Nothing on the
       Settings page collects a key any more, and the retired storage key is never
       written - not by booting the app and not by opening either photo screen. */
    var settingsTrigger = doc.querySelector('[data-app-nav="settings"]');
    record('settings navigation exists', Boolean(settingsTrigger));
    if (settingsTrigger) { settingsTrigger.click(); await wait(300); }
    record('settings offers no photograph key fields',
      !doc.querySelector('#settingsPhotoKey') && !doc.querySelector('#settingsPhotoEngine') &&
      !doc.querySelector('#settingsPhotoSave') && !doc.querySelector('#settingsPhotoRemove') &&
      !doc.querySelector('#settingsPhotosHeading'), 'a photograph field is still on the page');
    record('the camera photo sheet is gone from the page',
      !doc.querySelector('#photoButton') && !doc.querySelector('#photoOverlay') &&
      !doc.querySelector('#photoTakeInput') && !doc.querySelector('#photoChooseInput'));
    record('the medicine page keeps only the keyless photo paths',
      Boolean(doc.querySelector('#commonsToggle')) && Boolean(doc.querySelector('#modalImageSearch')) &&
      !doc.querySelector('#modalImageToggle') && !doc.querySelector('#modalImageGallery'));
    record('no photograph key is stored on this device',
      localStorage.getItem('dawaya-photo-search-v1') === null,
      localStorage.getItem('dawaya-photo-search-v1'));

    localStorage.setItem('dawaya-reminders-v1', '[{"id":"t1","name":"Test medicine","dose":"1 tablet","time":"09:00"}]');
    localStorage.setItem('dawaya-reminder-taken-v1', '{"2026-10-29":["t1"]}');
    localStorage.setItem('dawaya-custom-drugs-v1', '[{"id":"c1","name":"Test"}]');

    var doc = frame.contentDocument;
    var trigger = doc.querySelector('[data-app-nav="privacy"]');
    record('privacy navigation exists', Boolean(trigger));
    if (trigger) { trigger.click(); await wait(250); }
    var wipe = doc.querySelector('#privacyWipe');
    record('delete-all button exists', Boolean(wipe));
    if (wipe) {
      wipe.click();
      await wait(80);
      wipe.click();
      await wait(200);
    }
    record('delete-all removes reminders', localStorage.getItem('dawaya-reminders-v1') === null);
    record('delete-all removes the taken log', localStorage.getItem('dawaya-reminder-taken-v1') === null);
    record('delete-all removes custom drugs', localStorage.getItem('dawaya-custom-drugs-v1') === null);
    record('delete-all removes the news snapshot', localStorage.getItem('dawaya-news-v1') === null);
    record('delete-all removes saved conversations', localStorage.getItem('dawaya-ai-chat-v1') === null);

    finish();
  }

  var finished = false;
  function done() { if (!finished) { finished = true; finish(); } }
  /* Must stay above the frame wait above, or a slow boot aborts the run before the
     page has even loaded and the report says "timed out" instead of naming the cause. */
  setTimeout(function () {
    if (finished) return;
    lines.push('FAIL harness [timed out after the last PASS line above]');
    failures += 1;
    done();
  }, 90000);

  main().then(done).catch(function (error) {
    lines.push('FAIL harness [' + (error && (error.stack || error.message || error)) + ']');
    failures += 1;
    done();
  });
})();
</script></body></html>
"""


HISTORY_TEST_PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dawaya conversation history tests</title></head>
<body><pre id="results">RUNNING</pre>
<script src="/generated/privacy-config.js"></script>
<script src="/ai/secure-history.js"></script>
<script>
(function () {
  'use strict';
  var lines = [], failures = 0;
  function record(name, ok, detail) {
    lines.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' [' + detail + ']' : ''));
    if (!ok) failures += 1;
  }
  function send() {
    var body = lines.join('\n') + '\nDONE failures=' + failures;
    document.getElementById('results').textContent = body;
    fetch('/__history_done__', { method: 'POST', body: body }).catch(function () {});
  }

  async function main() {
    localStorage.clear();
    var privacy = window.DawayaPrivacy;
    record('saving defaults to on', privacy.historyEnabled() === true);

    await privacy.record('user', 'asthma test question');
    await privacy.record('assistant', 'reference answer', { type: 'answer' });
    var saved = localStorage.getItem('dawaya-ai-chat-v1');
    record('stored conversation is a ciphertext envelope',
      Boolean(saved) && saved.indexOf('v1.webaesgcm.') === 0 && saved.indexOf('asthma') === -1,
      String(saved || '').slice(0, 20));
    var list = await privacy.listSessions();
    record('the conversation is listed with a title',
      list.length === 1 && /asthma/.test(list[0].title || ''), String(list.length));
    var firstId = list.length ? list[0].id : '';
    record('the active conversation reloads its turns', (await privacy.load()).length === 2);

    await privacy.beginNewSession();
    record('a new chat starts empty and keeps the saved one',
      (await privacy.load()).length === 0 && (await privacy.listSessions()).length === 1);
    await privacy.record('user', 'second test question');
    record('the second conversation is saved too', (await privacy.listSessions()).length === 2);

    var deleted = await privacy.deleteSession(firstId);
    var left = await privacy.listSessions();
    record('a single conversation can be deleted',
      deleted.deleted === true && left.length === 1 && left[0].id !== firstId, String(left.length));
    var atRest = await privacy.read(privacy.KEYS.history);
    record('the surviving conversation is encrypted at rest',
      Boolean(atRest) && atRest.version === 2 && Array.isArray(atRest.sessions) && atRest.sessions.length === 1);

    privacy.setHistoryEnabled(false);
    record('turning saving off clears storage and memory',
      privacy.historyEnabled() === false && localStorage.getItem('dawaya-ai-chat-v1') === null &&
      (await privacy.listSessions()).length === 0);
    record('nothing is recorded while saving is off',
      (await privacy.record('user', 'ignored')).persisted === false &&
      localStorage.getItem('dawaya-ai-chat-v1') === null);
    privacy.setHistoryEnabled(true);

    await privacy.close();
    localStorage.setItem('dawaya-ai-chat-v1', JSON.stringify([{ role: 'user', text: 'legacy question', at: 1700000000000 }]));
    var legacy = await privacy.load();
    var migrated = localStorage.getItem('dawaya-ai-chat-v1');
    record('an older flat transcript is migrated and encrypted',
      legacy.length === 1 && legacy[0].text === 'legacy question' &&
      Boolean(migrated) && migrated.indexOf('v1.webaesgcm.') === 0 && migrated.indexOf('legacy question') === -1);

    await privacy.clearHistory();
    record('clear all removes the stored conversations', localStorage.getItem('dawaya-ai-chat-v1') === null);
    send();
  }

  main().catch(function (error) {
    lines.push('FAIL harness [' + (error && (error.stack || error.message || error)) + ']');
    failures += 1;
    send();
  });
})();
</script></body></html>
"""


def find_browser():
    override = os.environ.get("CHROME")
    candidates = [
        override,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


HISTORY_RESULT = {"body": "", "event": threading.Event()}


def page_response(handler, page):
    body = page.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class TestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBAPP, **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/__privacy_tests__.html":
            page_response(self, TEST_PAGE)
            return
        if self.path.split("?")[0] == "/__history_tests__.html":
            page_response(self, HISTORY_TEST_PAGE)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/__history_done__":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        HISTORY_RESULT["body"] = self.rfile.read(length).decode("utf-8", "replace")
        HISTORY_RESULT["event"].set()
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *_args):
        pass


def run_history_tests(browser, port):
    """The conversation store needs real IndexedDB and WebCrypto, which do not
    complete under --virtual-time-budget, so this page runs on the real clock
    and reports back by POST."""
    HISTORY_RESULT["body"] = ""
    HISTORY_RESULT["event"].clear()
    profile = tempfile.mkdtemp(prefix="dawaya-history-tests-")
    url = "http://127.0.0.1:%d/__history_tests__.html" % port
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-features=CalculateNativeWinOcclusion,MacWebContentsOcclusion",
        "--user-data-dir=" + profile,
        url,
    ]
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        finished = HISTORY_RESULT["event"].wait(120)
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(profile, ignore_errors=True)
    if not finished:
        print("\nFAIL: the conversation history page did not report a result")
        return False
    text = HISTORY_RESULT["body"].strip()
    print("\nConversation history tests:\n" + text)
    return "DONE failures=0" in text and "FAIL" not in text


def main():
    browser = find_browser()
    if not browser:
        print("SKIP: no Chrome/Chromium found; set CHROME=/path/to/browser")
        return 2

    server = ThreadingHTTPServer(("127.0.0.1", 0), TestHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    profile = tempfile.mkdtemp(prefix="dawaya-privacy-tests-")
    url = "http://127.0.0.1:%d/__privacy_tests__.html" % port
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-features=CalculateNativeWinOcclusion,MacWebContentsOcclusion",
        "--user-data-dir=" + profile,
        "--virtual-time-budget=70000",
        "--dump-dom",
        url,
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=420)
        history_passed = run_history_tests(browser, port)
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(profile, ignore_errors=True)

    output = result.stdout
    match = re.search(r'<pre id="results">(.*?)</pre>', output, re.S)
    if not match:
        print("FAIL: the test page produced no results (browser exit %d)" % result.returncode)
        if result.stderr:
            print(result.stderr[-2000:])
        return 1
    text = html.unescape(match.group(1)).strip()
    print(text)
    if "DONE failures=0" not in text or "FAIL" in text:
        return 1
    if not history_passed:
        return 1
    print("\nAll runtime privacy tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
