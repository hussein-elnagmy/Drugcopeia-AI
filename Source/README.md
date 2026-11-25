# Dawaya source

This `Source/` tree is the single source of truth for all four platforms.
Every app version (Windows, macOS, Android, iOS) is built from `webapp/` plus
the per-platform shell in this folder.

```
webapp/    Front-end shared by every platform:
           index.html, styles.css, app.js, core.js, lab-tests.js,
           clinical-tools.js, reading.js, news.js, net.js,
           service-worker.js, manifest.webmanifest
           assets/  bundled datasets (medicines, conditions, lab tests,
                    news snapshot), fonts, icons, vendor libraries
native/    ios-shell.js — Capacitor bridge (text-to-speech, share,
           downloads, reminder notifications, secure storage)
ios/       Capacitor/Xcode project (App.xcodeproj, Swift plugin, public/)
android/   Capacitor/Gradle project (DawayaShellPlugin, assets/public/)
branding/  Source logo/icon artwork
macos/     Native macOS shell (Swift + WKWebView, universal binary)
windows/   Native Windows launcher (Go); serves embedded assets on 127.0.0.1
           windows/llama/  the llama.cpp runtime embedded in Dawaya.exe
native/apple/llama.xcframework  the llama.cpp runtime for iOS and macOS
www/       Synced copy of webapp/ with the current cache revision (build input)
tools/     news fetcher, AI benchmark and knowledge-index helpers
tests/     ai/run-tests.js - the Dawaya AI suite, run with jsc
build/     Build output (macOS app and dmg); never a source of truth
scripts/   sync-web.sh (no Node required), sync-web.mjs, verify-project.mjs,
           gen-privacy-config.py, privacy-check.py, privacy-tests.py
privacy.config.json  the network and permission allowlist the gate enforces
```

## On-device health assistant

`webapp/ai/` holds the offline assistant: the on-device model, the seven-step question pipeline,
grounded retrieval over the Egyptian database and the trusted-document index, and the chat screen.
See [`AI.md`](AI.md) for the model download, adding trusted documents, updating the database, and
the test and benchmark commands.

## Privacy and network policy

`privacy.config.json` is the single source of truth for allowed hosts,
permissions, and local-storage keys. `scripts/gen-privacy-config.py` renders the
web config and the Android network security config from it, and
`scripts/privacy-check.py` fails the build on analytics/tracking/ads
dependencies, non-allowlisted network calls, unapproved permissions, log
statements that reference user input, email-collecting fields and missing
identifier sanitising. Typed text passes a local guard that removes phone
numbers, 14-digit national IDs and email addresses before search, feedback,
new-medicine and reminder handlers use it; no form asks for an email. See
[`../PRIVACY.md`](../PRIVACY.md) for the user-facing policy.

After editing anything in `webapp/`, run:

```bash
scripts/sync-web.sh
```

It rebuilds `www/`, copies `native/ios-shell.js`, injects the bridge script
tag, applies the cache revision taken from `service-worker.js`, refreshes
`ios/App/App/public` and `android/app/src/main/assets/public`, and runs the
privacy gate.

## Checks before shipping

No Node is needed; the suite runs on the JavaScriptCore that ships with macOS:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tests/ai/run-tests.js
/usr/bin/python3 scripts/privacy-check.py
/usr/bin/python3 scripts/privacy-tests.py
```

The AI suite is 145 cases and must print `145/145 passed`; the gate reports the
number of files scanned against `privacy.config.json` and must end in `PASS`.

## Windows build

Requires Go 1.23+ and network access the first time (for `go-winres`). The script
stages `../www` (the synced output with the current cache revision) and embeds
whatever is in `windows/llama/`:

```bash
cd windows
GO="$HOME/go-sdk/go/bin/go" bash build-windows.sh
# dist/Dawaya.exe — single file, all assets and the llama.cpp runtime embedded
```

To replace that runtime, download the matching llama.cpp release archive and point
`LLAMA_WIN_ZIP` at it before building; `windows/llama/README.txt` records the
archive URL and SHA-256 the shipped files were verified against.

## macOS build

Requires Xcode (Command Line Tools + macOS SDK) and `native/apple/llama.xcframework`:

```bash
cd macos
bash build-macos.sh
# ../build/macos/Dawaya.app and ../build/Dawaya-mac.dmg
```

## iOS build

Requires Xcode and an Apple signing team:

```bash
scripts/sync-web.sh
cd ios/App
xcodebuild archive -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath $PWD/build/Dawaya.xcarchive \
  DEVELOPMENT_TEAM=<TEAM-ID> CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates
# then package build/Dawaya.xcarchive/Products/Applications/App.app as
# Payload/App.app inside the .ipa (rm -f the old ipa, then zip -qry)
```

## Android build

Requires JDK 21 and Android SDK 36 (create `android/local.properties` with
`sdk.dir=/path/to/Android/sdk` if it is missing), **plus** the Capacitor packages
under `Source/node_modules` and the release keystore:

```bash
scripts/sync-web.sh
cd android
JAVA_HOME=<jdk21> ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

Neither extra is present on the current build machine: there is no `node`/`npm`, so
`android/capacitor.settings.gradle` points at a `../node_modules/@capacitor/android`
that does not exist, and `android/keystore.properties` is absent so Gradle falls back
to no release signing. The published APK therefore stays on its last release-signed
build; see `VERSION.txt`.

## Notes

- The Windows launcher has no CGO dependencies and cross-compiles from any OS:
  `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w -H windowsgui"`.
- The macOS shell is signed ad-hoc (`codesign --sign -`) and does not require an
  Apple Developer account.
- Android release signing is NOT reproducible on this machine: `android/keystore/`
  and `android/keystore.properties` are absent and excluded from every distributed
  archive. Updates must be signed with the original `dawaya-release.jks` to install
  over an existing build, so the key is never rotated silently — a new key would
  refuse the in-place update and erase the reader's reminders.
- The service worker is skipped on `127.0.0.1` and `localhost`, so the Windows
  and macOS builds always load the bundled files directly.
