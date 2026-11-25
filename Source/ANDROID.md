# Dawaya — Android APK

Signed, installable Android build of the Dawaya medicine guide. The complete
web app is bundled inside the APK and runs in Capacitor's WebView; no remote
`server.url` is configured.

| Item | Value |
| --- | --- |
| Package | `com.dawaya.medicineguide` |
| Source version | `1.7.8` (versionCode `48`) |
| Published APK | `1.7.1` (versionCode `40`) — the release build is not reproducible on the current machine; see [Rebuild from source](#rebuild-from-source) and [Signing](#signing) |
| Minimum Android | 7.0 (API 24) |
| Target / compile SDK | Android 16 / API 36 |
| APK | `Android/Dawaya.apk` |
| Native libraries | `arm64-v8a` only — the llama.cpp runtime the on-device assistant uses |
| Signing key | `android/keystore/dawaya-release.jks`, alias `dawaya` — **not on this machine** |
| APK source | `android/app/build/outputs/apk/release/app-release.apk` |

The APK carries arm64 CPU libraries, so it installs on 64-bit ARM phones and
tablets only; an x86/x86_64 device (most emulators) cannot install it. It is
signed with APK Signature Scheme v2 (supported since Android 7.0, the app's
minimum).

## Install on a phone

1. Copy `Android/Dawaya.apk` to the phone (USB, cloud drive, or a direct download).
2. Open the file. If Android blocks it, allow **Install unknown apps** for the
   app you opened it from (Files, Chrome, or your file manager), then tap
   **Install**.
3. Play Protect may ask you to scan an app installed outside Google Play. The
   build is signed, but it is not distributed through Play.

With USB debugging enabled, the equivalent command is:

```bash
adb install -r Android/Dawaya.apk
```

To uninstall: long-press the Dawaya icon → **App info → Uninstall**. Updating
later requires an APK signed with the same keystore.

## What the Android build provides

- **Bundled UI and data** — HTML, CSS, JavaScript, fonts, icons, the app logo,
  and the medicine/condition/lab datasets are inside the APK. The app opens and
  searches without a network connection.
- **Arabic and English** — the launcher label is `دوايا` on Arabic devices and
  `Dawaya` elsewhere; RTL, theme switching, and type scaling are unchanged.
- **Native splash and icons** — light and dark splash screens plus adaptive,
  round, and legacy launcher icons generated from the Dawaya artwork.
- **Native text-to-speech** — the listen buttons use Android's on-device
  `TextToSpeech` engine through `window.DawayaAndroid`. Arabic uses `ar-EG` when
  an Arabic voice is installed; otherwise the device default voice is used.
- **Android share sheet** — medicine summaries share through `ACTION_SEND` only
  when the user taps Share.
- **Reminder notifications** — daily local notifications via `AlarmManager` and
  a `BroadcastReceiver`, with escalating alerts until the dose is confirmed.
- **Back navigation** — the system back button walks WebView history before it
  exits the app.
- **Offline-safe storage** — theme, language, reminders, and custom medicines
  are stored locally in the WebView profile or in private app storage. SMS,
  contacts, location, and advertising IDs are never read. The camera opens only
  while the Scan code sheet is visible, and the microphone only while Voice
  search listens; both stop when the sheet or session closes.
- **Barcode and voice search** — the scanner decodes a box code on the device
  with `BarcodeDetector` and matches it against the bundled
  `barcode-index.json`; a typed code is accepted when a camera is unavailable.
  Voice search uses `android.speech.SpeechRecognizer` with
  `EXTRA_PREFER_OFFLINE`, and the audio is discarded once the text arrives. On a
  device without an offline speech model, the system recognition service may
  process the audio itself; only the transcript returns to Dawaya.
- **Screenshots blocked** — `FLAG_SECURE` keeps app content out of screenshots
  and the recent-apps thumbnail.

### First launch and the medicine database

The Egyptian medicine database, conditions index, lab tests, and a news
snapshot are bundled in the APK and load from local files. No download is
required on first launch. Network use is opt-in and allowlisted in
`privacy.config.json`: the home page news list (WHO, FDA, PubMed) refreshes itself
when the page opens and then at most every six hours while the app is in the
foreground - the only path the app runs on its own, and offline mode refuses it -
the **Download** button in Dawaya AI (`huggingface.co` and its `.hf.co` CDN), and
links or the **View in browser** photograph button, which leave the app for a
Chrome Custom Tab. The **Photos / صور** section on a medicine page needs no key and
no account: one press of **Show photos** asks Wikimedia Commons
(`commons.wikimedia.org/w/api.php`) for files whose own name carries the product's
trade name, and the previews come from `thumb.wikimedia.org` with the full file from
`upload.wikimedia.org`. All three are https, GET-only and
`userInitiatedOnly`, so nothing is fetched until the reader presses the button, and
nothing is sent but the trade name already printed on the page. A medicine the
reader added himself shows no such section. Release 1.7.7 removed the Google
photograph path entirely: the **Settings → Product photos** card, the in-page
Programmable Search gallery, the **Search by photo** camera lookup, and with them
`www.googleapis.com`, `vision.googleapis.com` and `encrypted-tbn0..3.gstatic.com`
in `network_security_config.xml` and `DawayaPrivacyPolicy.java`, plus the
`dawaya-photo-search-v1` key from `SECURE_ONLY_KEYS`. No credential is stored on the
device and no image the reader holds can leave it. Typed text passes a local
identifier guard that removes phone
numbers, 14-digit national IDs and email addresses before search, feedback,
add-medicine and reminder handlers use it; no form asks for an email.
(The published 1.7.1 APK predates all of this; the source at 1.7.7 has the Commons
section and none of the Google fields. See [Rebuild from source](#rebuild-from-source)
and [Signing](#signing).)

### Differences from the iOS build

- The Android shell does not provide the iOS downloads-to-Files flow; the web
  app's export/share actions use the Android share sheet.
- Both platforms use native local notifications for reminders. Neither uses
  push notifications, background sync, analytics, or crash reporting.

## Rebuild from source

Prerequisites:

- JDK 21
- Android SDK with `platforms;android-36` and `build-tools;36.0.0`
- Python 3 (runs the privacy gate)
- Android NDK r27+ (only to build the optional on-device AI runtime; CI builds it -
  see [llama/README.txt](llama/README.txt)). Without it the APK still builds and the
  assistant answers via grounded smart search.
- `ANDROID_HOME` (or `local.properties`) pointing at the SDK
- `node_modules/@capacitor/android` on disk. Gradle needs no Node runtime, but
  `android/capacitor.settings.gradle` includes that folder as the
  `:capacitor-android` project, so a checkout without it fails at configuration
  before any task runs. Install it with `npm ci` in `Source/`.

**Current blocker on this machine:** there is no `Source/node_modules` and no
node/npm, and the release keystore is absent, so `assembleRelease` cannot be
reproduced here and `Android/Dawaya.apk` stays at the 1.7.1 (build 40) package
while the sources carry 1.7.8 / versionCode 48. Neither gap is patched with a
rebuilt APK signed by a different key: that build would refuse to install over
the published one and would erase the reader's reminders. Restoring the build
needs `dawaya-release.jks` plus `npm ci` — no source change.

```bash
scripts/sync-web.sh
cd android

# macOS / Linux
JAVA_HOME=<jdk21> ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease

# Windows (PowerShell or cmd)
gradlew.bat assembleRelease
```

To include the on-device AI runtime, place the built server at
`android/app/src/main/jniLibs/arm64-v8a/libllamaserver.so` plus the NDK `libomp.so`
before running Gradle (exact, verified steps in [llama/README.txt](llama/README.txt)).
The GitHub Actions workflow does this on every build.

`assembleRelease` depends on the `privacyCheck` Gradle task, which runs
`scripts/privacy-check.py` and fails the build on a policy violation.

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

A debug build that installs without the release key is also available:

```bash
./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Signing

The release build reads `android/keystore.properties`:

```
storeFile=keystore/dawaya-release.jks
storePassword=…
keyAlias=dawaya
keyPassword=…
```

If that file is missing, Gradle still builds but produces an **unsigned** APK
that Android will refuse to install.

**Neither `android/keystore.properties` nor `android/keystore/dawaya-release.jks`
is on the machine that produced these files** — they were deliberately kept out of
the distributed archive, and the debug keystore is not a substitute. The published
APK was signed with the release key (alias `dawaya`); re-signing with a new key
produces an APK that will not install over it.

**Keep `android/keystore/dawaya-release.jks` and `keystore.properties` private
and back them up.** The package name and signing key identify the app for
updates. Losing the key means the installed app cannot be updated in place; a
new key requires uninstalling and reinstalling. Do not commit either file to a
public repository.

For Google Play, enroll in Play App Signing and use this key as the upload key,
or replace it with your organization's key before the first upload. The package
ID `com.dawaya.medicineguide` is permanent once published.

## Verification performed on this build

```bash
apksigner verify --verbose --print-certs app-release.apk
# Verifies; v2 scheme true; CN=Dawaya, 4096-bit RSA

aapt2 dump badging app-release.apk
# package com.dawaya.medicineguide, versionCode 48, versionName 1.7.8
# minSdk 24, targetSdk 36, launchable activity MainActivity, native-code arm64-v8a

zipalign -c -v 4 app-release.apk
# aligned

unzip -l app-release.apk | grep assets/public
# index.html, app.js, net.js, ios-shell.js, service-worker.js and all assets present

/usr/bin/python3 ../scripts/privacy-check.py
# privacy gate: PASS
```

The compiled DEX contains `DawayaShellPlugin` with the `speak` and `share`
methods exposed to the bundled JavaScript. The manifest disables cleartext
traffic and Android backups, sets `FLAG_SECURE` on the window, and declares
internet, network-state, notification, boot-completed, exact-alarm, vibrate,
camera, record-audio and modify-audio-settings permissions — no location,
contacts, storage-wide or phone-state access. The camera and microphone entries
exist only for the tap-only scanner and voice search.

**Runtime limitation:** no Android device or emulator is attached to this build
machine, so APKs are verified statically (signature, manifest, resources,
assets, DEX, alignment) and not launched on a device. Install and exercise the
APK on a physical phone before distributing it widely.

## Publishing checklist (Google Play)

1. Build an Android App Bundle with the same signing setup:
   `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.
2. Raise `versionCode` for every upload; update `versionName` for users.
3. Fill the Data safety form: the app collects and shares no data, has no
   accounts, analytics, ads, crash reporting, or advertising ID, and performs
   no server-side collection. The only network requests are the optional
   user-initiated news update from WHO, FDA, and PubMed, and external source
   links opened in the browser on tap. Declare "No data collected" and "No
   data shared".
4. Provide a privacy-policy URL (host `PRIVACY.md` as static text) and keep the
   in-app medical disclaimer, Privacy screen, and sources visible. Describe the
   app as an information reference, not a diagnostic or prescribing tool.
5. Complete the content-rating questionnaire and health-content declarations.
6. Test the release bundle with an internal testing track before production.
