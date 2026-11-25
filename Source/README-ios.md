# Dawaya — Native iOS Wrapper

A production-oriented Capacitor 8 / WKWebView shell around the Dawaya medicine
guide. The web app and its datasets are bundled inside the app (no remote
`server.url`), with native offline handling, a native loading layer,
on-device text-to-speech, sharing, downloads, and local dose reminders. The app
collects no data and has no analytics, ads or accounts. The camera and
microphone open only from the Scan code and Voice search buttons, and speech
is transcribed by the system service, on-device where supported.

- **Bundle ID:** `com.dawaya.medicineguide`
- **Display name:** Dawaya / دوايا
- **Minimum iOS:** 15.0
- **Devices:** iPhone and iPad
- **Xcode project:** [`ios/App/App.xcodeproj`](ios/App/App.xcodeproj)
- **Web source:** [`webapp/`](webapp)
- **Native bridge:** [`native/ios-shell.js`](native/ios-shell.js)

> **Build environment note:** the current IPA is archived and installed from
> macOS with Xcode 16.2. The commands below are complete for reproducing the
> signed archive and export.

---

## 1. What is included

### Native container

| File | Responsibility |
| --- | --- |
| `DawayaShellViewController.swift` | Root view controller. Owns the Capacitor child, loading/offline/toast layers, connectivity state, speech, sharing, downloads, and reminders. |
| `DawayaBridgeViewController.swift` | Capacitor `CAPBridgeViewController` tuned for edge-to-edge layout, persistent website data, registration of the shell plugin, and the custom delegate proxy. |
| `DawayaWebViewDelegateProxy.swift` | Forwards Capacitor's navigation callbacks, adds `WKDownload` support, and opens external links in the system browser only on user tap. |
| `DawayaFileStore.swift` | Writes downloads to `Documents/Downloads` (visible in Files) and sanitizes names. |
| `DawayaNetworkMonitor.swift` | `NWPathMonitor` wrapper with main-queue callbacks. |
| `DawayaNotificationService.swift` | Daily local notifications for the web app's reminders, with permission requested only when a reminder is added. |
| `DawayaSpeechService.swift` | `AVSpeechSynthesizer` on-device text-to-speech for the listen buttons. |
| `DawayaOverlayViews.swift` | Native loading screen, offline screen, and download toast. |
| `DawayaShellPlugin.swift` | JavaScript bridge (`Capacitor.Plugins.DawayaShell`). |
| `DawayaStrings.swift` | Bilingual native copy (English/Arabic). |
| `DawayaTheme.swift` | Native palette matching the web CSS tokens, status-bar style, and RTL direction. |
| `DawayaPrivacyPolicy.swift` | Shared host/path allowlist mirror generated from `privacy.config.json`. |
| `DawayaSecureStore.swift` | Keychain-backed storage for the three local user-data keys. |
| `AppDelegate.swift` / `SceneDelegate.swift` | Notification delegate and scene lifecycle; Capacitor scene proxy forwarding. |

### Web/runtime support

- [`native/ios-shell.js`](native/ios-shell.js) is injected before `core.js` by
  [`scripts/sync-web.sh`](scripts/sync-web.sh). On a normal browser it exits
  immediately, so the PWA is unaffected.
- [`scripts/verify-project.mjs`](scripts/verify-project.mjs) checks Xcode wiring,
  bundled assets, privacy strings, icon dimensions, and the JS bridge.
- `PrivacyInfo.xcprivacy` declares no tracking, no collected data, and the
  UserDefaults required-reason API (`CA92.1`).
- `InfoPlist.strings` localizes the app name in English and Arabic. Three usage
  descriptions are declared, all with tap-only wording: camera for scanning a
  box code, microphone for voice search, and speech recognition for turning the
  spoken name into text. No photo-library permission is declared.
- `Assets.xcassets` contains a 1024×1024 opaque App Store icon, the launch logo,
  and a light/dark launch background.
- `Base.lproj/LaunchScreen.storyboard` is the immediate system launch screen; the
  native loading layer bridges the gap until the web app reports readiness.

### Architecture

```
UIWindow
└── DawayaShellViewController          status bar, theme, lifecycle
    ├── DawayaBridgeViewController     WKWebView + Capacitor bridge (edge-to-edge)
    │   ├── DawayaWebViewDelegateProxy navigation, downloads, file picker
    │   └── DawayaShellPlugin          ready/speak/share/reminders/files
    ├── DawayaLoadingView              native launch loading layer
    ├── DawayaOfflineView              native offline state + retry
    └── DawayaToastView                download/offline notices
```

The web view fills the window; the app's CSS uses `viewport-fit=cover` and
`env(safe-area-inset-*)`, so content respects the notch, Dynamic Island, and home
indicator. Overlays pin their content to `safeAreaLayoutGuide`. The status bar
style follows the web theme through `setAppearance`.

---

## 2. Requirements

- macOS 14.5 or newer (Xcode 16 requirement)
- Xcode 16.x with command-line tools
- Node.js 22+ (24 LTS recommended)
- An Apple Developer Program membership (for device archives, TestFlight, and the
  App Store)
- A Mac with a valid Apple Distribution certificate in the login keychain for
  command-line exports

No CocoaPods are required. Capacitor is linked with Swift Package Manager through
[`ios/App/CapApp-SPM`](ios/App/CapApp-SPM/Package.swift).

---

## 3. First run on macOS

```bash
cd Source
npm ci                 # installs Capacitor 8.5.3 exactly
npm run sync:web       # rebuilds www/ and injects ios-shell.js
npm run sync:ios       # copies www/ into the Xcode target and syncs SPM
npm run verify         # 15 static release checks
open ios/App/App.xcodeproj
```

These npm scripts need Node. The machine that produced the current builds has no
node and no `node_modules`, so the same steps were run without them:
`bash scripts/sync-web.sh` regenerates `www/` and copies it into
`ios/App/App/public`, and the archive is made with `xcodebuild` (section 6).
`npm run verify` has therefore not been executed on this machine.

The web source is [`webapp/`](webapp). Edit it, then rerun `npm run sync:ios`;
never edit `ios/App/App/public` directly — Capacitor overwrites it.

### Useful commands

| Command | Effect |
| --- | --- |
| `npm run sync:web` | Rebuild `www/` and inject the iOS bridge |
| `npm run sync:ios` | Sync web assets and Capacitor configuration into the Xcode project |
| `npm run open:ios` | Open the Xcode workspace/project |
| `npm run verify` | 15 static release checks (needs Node) |

---

## 4. Configure signing in Xcode

1. Open `ios/App/App.xcodeproj`.
2. Select the **App** target → **Signing & Capabilities**.
3. Tick **Automatically manage signing**.
4. Choose your **Team**.
5. Change the **Bundle Identifier** if `com.dawaya.medicineguide` is not yours.
   - Also change `appId` in [`capacitor.config.json`](capacitor.config.json),
     run `npm run sync:ios`, and create a matching explicit App ID in the
     Developer portal.
6. Set **Version** (`MARKETING_VERSION`, e.g. `1.0.0`) and **Build**
   (`CURRENT_PROJECT_VERSION`, e.g. `1`). Increment the build number for every
   upload to App Store Connect.
7. Choose a development team for the **CapApp-SPM** package if Xcode asks; it
   has no signing settings of its own and uses the app target's team.

No paid capabilities are required:

- The app requests the notification permission only when the user adds a
  reminder, and camera, microphone and speech recognition only from the Scan
  code and Voice search buttons. It never requests photo-library, contacts or
  location access. Scan results and transcripts stay on the device.
- Dose reminders are **local** `UNCalendarNotificationTrigger` notifications.
  Push Notifications and Background Modes are not used or enabled.
- File downloads use the app's Documents container with iTunes file sharing.
- App Transport Security stays at the default secure configuration
  (`NSAllowsArbitraryLoads` and `NSAllowsLocalNetworking` are both `false`).

### Create the certificate and provisioning profile manually (optional)

Automatic signing is recommended. For manual signing or CI:

1. **Certificate signing request**
   - Keychain Access → Certificate Assistant → *Request a Certificate From a
     Certificate Authority*.
   - Use your Apple Developer email, choose *Saved to disk*, continue and save
     `CertificateSigningRequest.certSigningRequest`.
2. **Apple Distribution certificate**
   - [developer.apple.com/account](https://developer.apple.com/account) →
     Certificates, Identifiers & Profiles → Certificates → **+**.
   - Choose **Apple Distribution** (App Store/TestFlight), upload the CSR,
     download the `.cer`, double-click it to install.
3. **App ID**
   - Identifiers → **+** → App IDs → App.
   - Bundle ID (explicit): `com.dawaya.medicineguide` (or your own).
   - No capabilities need to be enabled for this build.
4. **Provisioning profile**
   - Profiles → **+** → **App Store** (distribution).
   - Select the App ID and the Apple Distribution certificate.
   - Name it, download the `.mobileprovision`, and double-click it.
5. **Xcode account**
   - Xcode → Settings → Accounts → add your Apple ID and team.
   - For manual signing, turn off *Automatically manage signing*, pick the
     distribution certificate and the downloaded profile.

---

## 5. Create the signed `.ipa`

### Option A — Xcode (recommended)

1. Connect/select **Any iOS Device (arm64)** as the run destination.
2. **Product → Archive**. Wait for the build to finish.
3. The Organizer opens → **Distribute App → App Store Connect → Upload**.
4. Validate first, then upload. Xcode manages the App Store provisioning profile.
5. In [App Store Connect](https://appstoreconnect.apple.com) → your app →
   **TestFlight**, wait for processing, answer export compliance (the plist
   already declares `ITSAppUsesNonExemptEncryption = false`), then add testers.

### Option B — Terminal archive and export

Run from the project root. Replace `YOUR_TEAM_ID` with the 10-character Team ID
from the Developer portal (Membership details).

```bash
export TEAM_ID=YOUR_TEAM_ID
mkdir -p build

# 1. Resolve Capacitor's Swift package, if this is a fresh checkout
xcodebuild -resolvePackageDependencies \
  -project ios/App/App.xcodeproj -scheme App

# 2. Create a Release archive. -allowProvisioningUpdates lets Xcode
#    create/download the App Store profile using the signed-in account.
xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$PWD/build/Dawaya.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates

# 3. Export the App Store IPA using ExportOptions.plist
plutil -replace teamID -string "$TEAM_ID" ExportOptions.plist
xcodebuild -exportArchive \
  -archivePath "$PWD/build/Dawaya.xcarchive" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$PWD/build/export" \
  -allowProvisioningUpdates

# Output (target product name is "App"; rename for convenience):
#   build/export/App.ipa
mv build/export/App.ipa build/export/Dawaya.ipa
```

Useful checks:

```bash
# Inspect the archive/export without uploading
unzip -l build/export/Dawaya.ipa | head -30
plutil -p build/Dawaya.xcarchive/Info.plist

# Validate with App Store Connect (API key required)
xcrun altool --validate-app -f build/export/Dawaya.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

`altool` requires an App Store Connect API key placed at
`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`. Create the key in App
Store Connect → Users and Access → Integrations. If your Xcode no longer ships
`altool`, use the **Transporter** app or Xcode Organizer to upload — the exported
IPA is identical.

### Manual-signing export

If you use a downloaded provisioning profile, edit `ExportOptions.plist`:

```xml
<key>signingStyle</key>
<string>manual</string>
<key>provisioningProfiles</key>
<dict>
  <key>com.dawaya.medicineguide</key>
  <string>Dawaya App Store</string>
</dict>
```

Then run the same `xcodebuild -exportArchive` command (without
`-allowProvisioningUpdates`).

### TestFlight / App Store checklist

- [ ] Bundle ID matches the App Store Connect app record.
- [ ] Build number increased since the previous upload.
- [ ] 1024×1024 icon is opaque (verified by `npm run verify`).
- [ ] Privacy policy URL and support URL are provided in App Store Connect.
- [ ] App Privacy answers: **Data Not Collected**, tracking **No**. The app has
      no analytics, ads, accounts, or crash reporting; the only network traffic
      is the optional, user-initiated news update and links the user taps.
- [ ] Medical disclaimer is visible (it is, in the web UI and About page).
- [ ] Review notes explain that the app is a bilingual offline medicine
      reference with on-device text-to-speech, local notifications, and native
      file export.
- [ ] Export compliance: no non-exempt encryption (`ITSAppUsesNonExemptEncryption`
      is already `false`).
- [ ] Test on a physical iPhone: TTS, reminders, downloads in Files, dark mode,
      Arabic RTL, air-plane mode, the Privacy screen, and the data wipe.

> **App Review guideline 4.2:** Apple can reject apps that are only a repackaged
> website. This build adds native offline states, on-device text-to-speech, local
> notifications, native file handling, and a launch/loading experience. Still,
> expect reviewers to ask what native value the app provides. Describe the
> native capabilities precisely in the review notes.

---

## 6. Runtime behaviour

### Loading and splash

1. The system shows `LaunchScreen.storyboard` immediately (logo + light/dark
   background).
2. `DawayaLoadingView` appears over the web view with the logo and a spinner.
3. `ios-shell.js` waits for `window.load`, then for the web app's
   `dawaya:dataset-updated` event (up to 6 s) before sending the native `ready`
   call. This keeps the loading layer visible until the first medicine index is
   ready. A 15 s JS fallback and a 20 s native timeout prevent an infinite
   spinner.

### Connectivity and offline

- `NWPathMonitor` detects loss of connectivity; the native notice is
  dismissible and the bundled data stays available.
- Offline mode in the web app disables the network gate entirely. Turning it off
  restores the allowlisted, user-initiated news update only.
- **Continue offline** dismisses the notice until connectivity returns; nothing
  is downloaded in the background.
- The offline screen content is scrollable, safe-area aware, and localized.

### Persistence and downloads

- The web view uses `WKWebsiteDataStore.default()`, so cookies, `localStorage`
  (theme, language, custom medicines), and the app cache survive relaunches.
  Reminders are mirrored in the Keychain-backed secure store.
- Generated downloads (Blob/Data URLs) are intercepted by `ios-shell.js` and
  written by native code to **Files → On My iPhone → Dawaya → Downloads**.
- WebKit downloads (`WKDownload`) are saved to the same folder. Toasts report
  progress, success, or failure.
- The app has no file upload UI and does not register a file chooser.

### Speech, sharing, reminders

- `window.DawayaNative.speak/stop` maps to the on-device `AVSpeechSynthesizer`;
  natural completion notifies `DawayaCore.speech.notify('end')`.
- Share uses `UIActivityViewController` with an iPad popover anchor and is only
  presented after an explicit user tap.
- The web app keeps reminders in `localStorage["dawaya-reminders-v1"]`. The bridge
  watches writes and syncs up to 20 daily local notifications. Permission is
  requested only when a **new** reminder is added, never on deletion or a silent
  sync.

### Theme and safe areas

- The web app's theme/language mutations are observed and sent to
  `setAppearance`.
- The shell updates `overrideUserInterfaceStyle`, status bar style, overlay
  colors, and native layout direction.
- The web view is edge-to-edge; CSS safe-area variables handle notch/Dynamic
  Island/home indicator spacing.

---

## 7. Bridge contract

`ios-shell.js` exposes these calls through `Capacitor.Plugins.DawayaShell`:

| Method | Payload | Result |
| --- | --- | --- |
| `ready` | — | Hides the native loading layer |
| `setAppearance` | `{ theme: "light"\|"dark", language: "en"\|"ar" }` | Updates native chrome/status bar |
| `speak` | `{ text, lang, rate }` | `{ ok: boolean }` |
| `stopSpeaking` | — | Resolves |
| `share` | `{ title, text, url }` | `{ presented: true }` or rejection |
| `setOfflineMode` | `{ enabled }` | Resolves |
| `syncReminders` | `{ reminders: [{id,name,dose,time}], language, requestAuthorization }` | `{ authorized, scheduled, supported }` |
| `saveFile` | `{ filename, base64, mimeType }` | `{ saved, filename }` |

Native-to-web events:

- `window.__dawayaNativeSpeechEvent('end'|'stop')`
- `window.__dawayaConnectivityEvent('online'|'offline')`

---

## 8. Configuration reference

| Setting | Location | Current value |
| --- | --- | --- |
| App ID / bundle ID | `capacitor.config.json`, Xcode signing | `com.dawaya.medicineguide` |
| Display name | `Info.plist`, `InfoPlist.strings` | Dawaya / دوايا |
| Web directory | `capacitor.config.json` | `www` |
| Background | `capacitor.config.json`, assets | `#F8F9FA` / `#121212` |
| Status bar | `DawayaShellViewController` | Follows web theme |
| Minimum iOS | Xcode + `Package.swift` | 15.0 |
| Orientations | `Info.plist` | Portrait + landscape (iPhone); all (iPad) |
| Dataset | `webapp/app.js` `BUNDLED_DATA_URL` | Bundled `assets/egyptian-drugs.json` |
| Reminder cap | `ios-shell.js` `MAX_REMINDERS` | 20 |

The app performs no startup download. External requests are limited to the
hosts allowlisted in `privacy.config.json` (WHO, FDA, PubMed), which the home page
news list uses on opening and then at most every six hours while the app is in the
foreground - the only path the app runs on its own, and offline mode refuses it;
all other links open in the system browser.
Typed text passes a local identifier guard that removes phone numbers, 14-digit
national IDs and email addresses before search, feedback, add-medicine and
reminder handlers use it; no form asks for an email.

---

## 9. Verification and known limits

`npm run verify` performs 15 static checks (it needs Node, which this build
machine does not have — see section 3):

- project files and pinned Capacitor versions;
- Capacitor configuration consistency and absence of a remote server URL;
- JavaScript bridge syntax and script injection order;
- synced `public/` assets vs. `webapp/` sources;
- privacy descriptions, ATS, launch storyboard, scene manifest;
- English/Arabic privacy strings;
- privacy manifest declarations;
- every Swift file compiled by the Xcode Sources phase;
- Xcode resources, localization variant group, and launch screen;
- shared scheme → app target;
- App Store icon dimensions and opacity;
- plugin/notification registration;
- export options.

Limits of this delivery:

1. **Signing.** The archive must be signed with your Apple team. The scripts in
   this repository build, archive, and install on a connected device.
2. **App Store 4.2**: see the review note above.
3. The web app has no upload UI and the native shell registers no file chooser.
4. **Screenshots** cannot be blocked on iOS the way Android's `FLAG_SECURE`
   does; the Privacy screen documents that limitation.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank/white screen in simulator | Run `npm run sync:ios`; check Safari → Develop → [device] → Web Inspector; confirm `public/index.html` exists in the app target. |
| `DawayaShell` plugin not found | Ensure all Swift files are in the **App** target's Compile Sources; clean build folder; re-run sync. |
| Signing error `No profiles for …` | Set the Team, confirm the bundle ID exists in the portal, enable automatic signing, add `-allowProvisioningUpdates`. |
| Archive builds for simulator only | Choose **Any iOS Device (arm64)** or use `-destination 'generic/platform=iOS'`. |
| Downloads invisible | Use Files → **On My iPhone → Dawaya → Downloads**; simulator uses its own container. |
| Reminders not firing | Allow notifications in Settings; keep at most 20 reminders; opening the reminders page re-syncs them. |
| Offline notice never clears | Turn **Offline mode** off in the app's Privacy screen, or restore connectivity. The bundled data stays usable either way. |
| TestFlight build missing | Wait for processing; check export compliance; check the build number is new. |
| Stale web content after editing | Always `npm run sync:ios`; clean the Xcode build folder. |

---

## 10. Delivery

Release IPAs are built from this tree with `scripts/sync-web.sh` followed by the
Xcode archive/export steps above, and installed on a connected iPhone for
verification. The signed IPA, APK, DMG, and EXE are published together with
`VERSION.txt` and `SHA256SUMS.txt`.
