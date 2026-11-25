# دوايا — تطبيق iOS الأصلي (غلاف Capacitor)

غلاف إنتاجي مبني على **Capacitor 8 / WKWebView** يحمّل تطبيق دوايا وقواعد
بياناته من داخل التطبيق نفسه (بدون `server.url` خارجي)، ويضيف واجهة تحميل
أصلية، ومعالجة انقطاع الاتصال، وتحويل النص إلى كلام على الجهاز، والمشاركة،
وتنزيل الملفات، وتذكيرات الجرعات المحلية. لا يجمع التطبيق أي بيانات، ولا
يحتوي تحليلات أو إعلانات أو حسابات. الكاميرا والميكروفون يعملان فقط من زرّي
«مسح الكود» و«البحث الصوتي»، ويتولى نظام التعرّف على الكلام تحويل الصوت إلى نص
على الجهاز حيثما كان ذلك مدعومًا.

- **معرّف الحزمة:** `com.dawaya.medicineguide`
- **اسم التطبيق:** Dawaya / دوايا
- **أقل إصدار iOS:** 15.0
- **الأجهزة:** iPhone و iPad
- **مشروع Xcode:** `ios/App/App.xcodeproj`
- **مصدر الويب:** `webapp/`
- **جسر iOS:** `native/ios-shell.js`

> **ملاحظة عن بيئة البناء:** يُبنى الـ IPA الحالي ويُثبّت من macOS عبر
> Xcode 16.2. الأوامر أدناه كاملة لإعادة إنتاج الأرشيف الموقّع وتصديره.

---

## 1. ما الذي يتضمنه المشروع؟

### الطبقة الأصلية

| الملف | الوظيفة |
| --- | --- |
| `DawayaShellViewController.swift` | المتحكم الجذري: طبقات التحميل/عدم الاتصال/التنبيهات، الاتصال، الصوت، المشاركة، التنزيلات، والتذكيرات. |
| `DawayaBridgeViewController.swift` | إعداد `CAPBridgeViewController`، تخزين دائم لبيانات الموقع، تسجيل إضافة الجسر، وربط وكيل التنقل. |
| `DawayaWebViewDelegateProxy.swift` | تمرير أحداث Capacitor، دعم `WKDownload`، وفتح الروابط الخارجية في المتصفح عند ضغط المستخدم فقط. |
| `DawayaFileStore.swift` | حفظ التنزيلات في `Documents/Downloads` لتظهر في تطبيق الملفات، وتنظيف الأسماء. |
| `DawayaNetworkMonitor.swift` | مراقبة الاتصال عبر `NWPathMonitor`. |
| `DawayaNotificationService.swift` | إشعارات محلية يومية لتذكيرات الجرعات، مع طلب الإذن فقط عند إضافة تذكير جديد. |
| `DawayaSpeechService.swift` | تحويل النص إلى كلام على الجهاز عبر `AVSpeechSynthesizer`. |
| `DawayaOverlayViews.swift` | شاشة التحميل، شاشة عدم الاتصال، وتنبيه التنزيل. |
| `DawayaShellPlugin.swift` | جسر JavaScript باسم `Capacitor.Plugins.DawayaShell`. |
| `DawayaStrings.swift` | النصوص الأصلية بالعربية والإنجليزية. |
| `DawayaTheme.swift` | ألوان مطابقة لتطبيق الويب، شريط الحالة، واتجاه RTL. |
| `DawayaPrivacyPolicy.swift` | نسخة مشتركة من قائمة المضيفين والمسارات المسموح بها من `privacy.config.json`. |
| `DawayaSecureStore.swift` | تخزين مفاتيح بيانات المستخدم الثلاثة في Keychain. |
| `AppDelegate.swift` / `SceneDelegate.swift` | مندوب الإشعارات ودورة حياة المشهد مع وكيل Capacitor. |

### دعم الويب

- يتم حقن `native/ios-shell.js` قبل `core.js` عبر `scripts/sync-web.sh`،
  ويتوقف تلقائيًا خارج التطبيق الأصلي.
- `npm run verify` ينفّذ فحوصًا ساكنة (ربط Xcode، الأصول، نصوص الخصوصية،
  أبعاد الأيقونة، الجسر، …).
- `PrivacyInfo.xcprivacy`: لا تتبّع، لا بيانات مجمّعة، وإفصاح `UserDefaults`
  بالسبب `CA92.1`.
- `InfoPlist.strings` بالعربية والإنجليزية لاسم التطبيق. ثلاثة أوصاف استخدام
  مصرّح بها، كلها بصيغة «عند الضغط فقط»: الكاميرا لمسح كود العلبة، والميكروفون
  للبحث الصوتي، والتعرّف على الكلام لتحويل الاسم المنطوق إلى نص. لا إذن لمكتبة
  الصور.
- أيقونة 1024×1024 بدون شفافية لمتجر التطبيقات، شعار شاشة الإقلاع، وخلفية
  فاتحة/داكنة.
- شاشة الإقلاع النظامية `LaunchScreen.storyboard` ثم شاشة تحميل أصلية حتى
  يعلن تطبيق الويب جاهزيته.

### المعمارية

```
UIWindow
└── DawayaShellViewController
    ├── DawayaBridgeViewController      WebView + Capacitor
    │   ├── DawayaWebViewDelegateProxy  التنقل، التنزيل، اختيار الملفات
    │   └── DawayaShellPlugin           ready/speak/share/reminders/files
    ├── DawayaLoadingView               شاشة تحميل أصلية
    ├── DawayaOfflineView               حالة عدم اتصال + إعادة محاولة
    └── DawayaToastView                 تنبيهات التنزيل ووضع عدم الاتصال
```

الـ WebView يملأ الشاشة، وتستخدم CSS متغيّرات `env(safe-area-inset-*)` مع
`viewport-fit=cover`، لذا لا تُقطع العناصر عند النوتش أو Dynamic Island أو
شريط الرئيسية. الطبقات الأصلية تحترم `safeAreaLayoutGuide`.

---

## 2. المتطلبات

- macOS 14.5 أو أحدث (متطلب Xcode 16)
- Xcode 16.x وأدوات سطر الأوامر
- Node.js 22 أو أحدث (يُفضّل 24 LTS)
- عضوية Apple Developer Program (لإنشاء الأرشيف وTestFlight والمتجر)
- شهادة Apple Distribution مثبتة في سلسلة مفاتيح تسجيل الدخول للتصدير من
  سطر الأوامر

لا حاجة إلى CocoaPods؛ يتم ربط Capacitor عبر Swift Package Manager من
`ios/App/CapApp-SPM`.

---

## 3. التشغيل الأول على macOS

```bash
cd Source
npm ci                 # تثبيت Capacitor 8.5.3
npm run sync:web       # بناء www/ وحقن جسر iOS
npm run sync:ios       # نسخ الويب إلى مشروع Xcode وربط SPM
npm run verify         # 15 فحصًا ساكنًا
open ios/App/App.xcodeproj
```

هذه الأوامر تحتاج Node. الجهاز الذي أنتج النسخ الحالية لا يملك node ولا
`node_modules`، فنفّذت الخطوات نفسها بدونهما: `bash scripts/sync-web.sh` يعيد بناء
`www/` وينسخه إلى `ios/App/App/public`، والأرشفة تتم بـ `xcodebuild` (القسم 6).
لم يُشغَّل `npm run verify` على هذا الجهاز لذلك.

عدّل مصدر الويب في `webapp/` ثم أعد `npm run sync:ios`. لا تعدّل
`ios/App/App/public` مباشرة؛ Capacitor يستبدله.

| الأمر | الوظيفة |
| --- | --- |
| `npm run sync:web` | إعادة بناء `www/` وحقن الجسر |
| `npm run sync:ios` | مزامنة الويب وإعدادات Capacitor مع Xcode |
| `npm run open:ios` | فتح مشروع Xcode |
| `npm run verify` | فحص ساكن شامل |

---

## 4. إعداد التوقيع في Xcode

1. افتح `ios/App/App.xcodeproj`.
2. اختر هدف **App** ← **Signing & Capabilities**.
3. فعّل **Automatically manage signing**.
4. اختر **Team**.
5. غيّر **Bundle Identifier** إذا كان `com.dawaya.medicineguide` غير مسجّل
   باسمك:
   - غيّر أيضًا `appId` في `capacitor.config.json`؛
   - نفّذ `npm run sync:ios`؛
   - أنشئ **App ID** صريحًا مطابقًا في بوابة المطوّر.
6. اضبط **Version** (`MARKETING_VERSION` مثل `1.0.0`) و**Build**
   (`CURRENT_PROJECT_VERSION` مثل `1`). زد رقم البناء مع كل رفع إلى App Store
   Connect.
7. إن طلب Xcode تحديد فريق لحزمة **CapApp-SPM**، اختر الفريق نفسه.

لا تُحتاج أي قدرات مدفوعة:

- يطلب التطبيق إذن الإشعارات عند إضافة تذكير، والكاميرا والميكروفون والتعرّف
  على الكلام من زرّي «مسح الكود» و«البحث الصوتي» فقط. لا يطلب مكتبة صور أو
  جهات اتصال أو موقعًا، ونتائج المسح والنص المنسوخ يبقيان على الجهاز.
- التذكيرات **محلية** عبر `UNCalendarNotificationTrigger`، ولا حاجة إلى Push
  Notifications أو Background Modes.
- التنزيلات في مجلد Documents مع تفعيل مشاركة الملفات.
- يبقى App Transport Security على الإعداد الآمن الافتراضي
  (`NSAllowsArbitraryLoads` و`NSAllowsLocalNetworking` كلاهما `false`).

### إنشاء الشهادة وملف التزويد يدويًا (اختياري)

التوقيع التلقائي هو الموصى به. للتوقيع اليدوي أو CI:

1. **طلب توقيع الشهادة (CSR)**
   - Keychain Access ← Certificate Assistant ← *Request a Certificate From a
     Certificate Authority*.
   - استخدم بريد حساب Apple Developer، واحفظ الطلب على القرص.
2. **شهادة Apple Distribution**
   - [developer.apple.com/account](https://developer.apple.com/account) ←
     Certificates, Identifiers & Profiles ← Certificates ← **+**.
   - اختر **Apple Distribution**، وارفع CSR، ونزّل `.cer` ثم افتحه لتثبيته.
3. **App ID**
   - Identifiers ← **+** ← App IDs ← App.
   - Bundle ID صريح: `com.dawaya.medicineguide` (أو معرّفك).
   - لا حاجة لتفعيل قدرات إضافية لهذا البناء.
4. **Provisioning Profile**
   - Profiles ← **+** ← **App Store** (توزيع).
   - اختر App ID والشهادة، ثم نزّل الملف وافتحه لتثبيته.
5. **حساب Xcode**
   - Xcode ← Settings ← Accounts ← أضف Apple ID والفريق.
   - للتوقيع اليدوي: أوقف التوقيع التلقائي واختر الشهادة والملف.

---

## 5. إنشاء ملف `.ipa` موقّع

### الطريقة أ — Xcode (الأسهل)

1. اختر **Any iOS Device (arm64)** كوجهة.
2. **Product ← Archive**.
3. في Organizer: **Distribute App ← App Store Connect ← Upload**.
4. تحقّق (Validate) ثم ارفع.
5. في [App Store Connect](https://appstoreconnect.apple.com) ← تطبيقك ←
   **TestFlight**، انتظر المعالجة، وأجب عن الامتثال للتصدير (الملف يعلن مسبقًا
   `ITSAppUsesNonExemptEncryption = false`)، ثم أضف المختبرين.

### الطريقة ب — سطر الأوامر

من جذر المشروع، واستبدل `YOUR_TEAM_ID` بمعرّف الفريق المكوّن من 10 أحرف:

```bash
export TEAM_ID=YOUR_TEAM_ID
mkdir -p build

# 1. حل حزمة Swift الخاصة بـ Capacitor (عند أول بناء)
xcodebuild -resolvePackageDependencies \
  -project ios/App/App.xcodeproj -scheme App

# 2. إنشاء أرشيف Release؛ -allowProvisioningUpdates يتيح لـ Xcode
#    إنشاء/تنزيل ملف تزويد App Store تلقائيًا.
xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$PWD/build/Dawaya.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates

# 3. تصدير IPA لمتجر التطبيقات
plutil -replace teamID -string "$TEAM_ID" ExportOptions.plist
xcodebuild -exportArchive \
  -archivePath "$PWD/build/Dawaya.xcarchive" \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath "$PWD/build/export" \
  -allowProvisioningUpdates

# الناتج App.ipa لأن اسم الهدف App؛ أعد تسميته للتوضيح:
mv build/export/App.ipa build/export/Dawaya.ipa
```

فحوصات مفيدة:

```bash
unzip -l build/export/Dawaya.ipa | head -30
plutil -p build/Dawaya.xcarchive/Info.plist

xcrun altool --validate-app -f build/export/Dawaya.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

يتطلب `altool` مفتاح App Store Connect API في
`~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`. أنشئ المفتاح من
App Store Connect ← Users and Access ← Integrations. إذا لم يكن `altool`
متوفرًا في إصدار Xcode لديك، استخدم تطبيق **Transporter** أو Xcode Organizer؛
ملف IPA نفسه هو نفسه.

### التصدير بتوقيع يدوي

عدّل `ExportOptions.plist`:

```xml
<key>signingStyle</key>
<string>manual</string>
<key>provisioningProfiles</key>
<dict>
  <key>com.dawaya.medicineguide</key>
  <string>Dawaya App Store</string>
</dict>
```

ثم نفّذ أمر `xcodebuild -exportArchive` نفسه دون
`-allowProvisioningUpdates`.

### قائمة تحقق TestFlight والمتجر

- [ ] معرّف الحزمة مطابق لسجل التطبيق في App Store Connect.
- [ ] رقم البناء أكبر من الرفع السابق.
- [ ] الأيقونة 1024×1024 بدون شفافية (يتحقق منها `npm run verify`).
- [ ] توفير رابط سياسة الخصوصية ورابط الدعم في App Store Connect.
- [ ] إجابات الخصوصية: **لا تُجمع بيانات**، والتتبّع **لا**. لا تحليلات ولا
      إعلانات ولا حسابات ولا تقارير أعطال؛ الشبكة الوحيدة هي تحديث الأخبار
      الاختياري الذي يبدأه المستخدم والروابط التي يضغطها. كل نص تكتبه يمرّ
      بحارس محلي يزيل أرقام الهواتف والأرقام القومية والبريد الإلكتروني قبل
      الاستخدام، ولا يطلب أي نموذج بريدك الإلكتروني.
- [ ] إخلاء المسؤولية الطبي ظاهر (موجود في الواجهة وصفحة حول).
- [ ] ملاحظات المراجعة توضح المزايا الأصلية: النطق على الجهاز، الإشعارات
      المحلية، العمل دون اتصال، والتعامل مع الملفات.
- [ ] الامتثال للتصدير: لا تشفير غير مستثنى (المفتاح مضبوط على `false`).
- [ ] اختبار على iPhone حقيقي: النطق، التذكيرات، التنزيل في الملفات، الوضع
      الداكن، العربية RTL، وضع الطيران، شاشة الخصوصية، ومسح البيانات.

> **إرشاد App Review 4.2:** قد ترفض Apple التطبيقات التي تكون مجرد موقع
> معاد تغليفه. هذا البناء يضيف طبقات أصلية (عدم اتصال، صوت، إشعارات، ملفات،
> شاشة تحميل). مع ذلك، اشرح القيمة الأصلية بدقة في ملاحظات المراجعة، وفكّر في
> إضافة مزايا أصلية إضافية مستقبلًا.

---

## 6. سلوك التشغيل

### الإقلاع والتحميل

1. تظهر شاشة `LaunchScreen.storyboard` النظامية فورًا (الشعار + خلفية فاتحة/داكنة).
2. تظهر `DawayaLoadingView` الأصلية فوق WebView.
3. ينتظر `ios-shell.js` حدث `window.load` ثم حدث `dawaya:dataset-updated` من
   تطبيق الويب (حتى 6 ثوانٍ) قبل إرسال `ready`. يبقي ذلك شاشة التحميل حتى
   يجهز فهرس الأدوية. توجد مهلة JS مقدارها 15 ثانية ومهلة أصلية 20 ثانية لمنع
   دوران لا نهائي.

### الاتصال وعدم الاتصال

- يكتشف `NWPathMonitor` فقدان الاتصال؛ التنبيه الأصلي قابل للإغلاق والبيانات
  المضمّنة تبقى متاحة.
- وضع عدم الاتصال في تطبيق الويب يعطّل بوابة الشبكة بالكامل. إيقافه يعيد فقط
  تحديث الأخبار المسموح به والذي يبدأه المستخدم.
- **المتابعة دون اتصال** تخفي التنبيه حتى عودة الاتصال؛ لا يُنزّل شيء في
  الخلفية.
- المحتوى قابل للتمرير ويحترم المنطقة الآمنة ومترجم بالعربية.

### التخزين والتنزيلات

- يستخدم WebView مخزن `WKWebsiteDataStore.default()`، فتبقى الكوكيز و`localStorage`
  (السمة، اللغة، الأدوية المضافة) بعد إعادة التشغيل. التذكيرات منسوخة في
  مخزن Keychain الآمن.
- تنزيلات Blob/Data تُلتقط عبر `ios-shell.js` وتُحفظ في
  **الملفات ← على iPhone ← Dawaya ← Downloads**.
- تنزيلات `WKDownload` تُحفظ في المجلد نفسه، مع تنبيهات نجاح/فشل.
- لا توجد واجهة رفع ملفات، ولا يسجّل التطبيق منتقي ملفات.

### الصوت والمشاركة والتذكيرات

- `DawayaNative.speak/stop` مرتبط بـ `AVSpeechSynthesizer` على الجهاز، ويُبلّغ
  الويب عند الانتهاء الطبيعي.
- المشاركة عبر `UIActivityViewController` مع مرساة مناسبة على iPad، وتحدث فقط
  بعد ضغط المستخدم.
- يحفظ الويب التذكيرات في `localStorage["dawaya-reminders-v1"]`، ويراقب الجسر
  الكتابات ويزامن حتى 20 إشعارًا يوميًا. يُطلب الإذن فقط عند إضافة تذكير جديد،
  وليس عند الحذف أو المزامنة الصامتة.

### السمة والمناطق الآمنة

- يراقب الجسر تغييرات السمة واللغة ويرسلها إلى `setAppearance`.
- تحدّث الواجهة الأصلية `overrideUserInterfaceStyle` وشريط الحالة وألوان
  الطبقات واتجاه التخطيط.
- WebView يملأ الشاشة، وCSS يتعامل مع النوتش وDynamic Island وشريط الرئيسية.

---

## 7. عقد الجسر

عبر `Capacitor.Plugins.DawayaShell`:

| الطريقة | البيانات | النتيجة |
| --- | --- | --- |
| `ready` | — | إخفاء شاشة التحميل |
| `setAppearance` | `{ theme, language }` | تحديث الواجهة وشريط الحالة |
| `speak` | `{ text, lang, rate }` | `{ ok }` |
| `stopSpeaking` | — | — |
| `share` | `{ title, text, url }` | `{ presented }` |
| `setOfflineMode` | `{ enabled }` | — |
| `syncReminders` | `{ reminders, language, requestAuthorization }` | `{ authorized, scheduled, supported }` |
| `saveFile` | `{ filename, base64, mimeType }` | `{ saved, filename }` |

أحداث من الأصلي إلى الويب:

- `window.__dawayaNativeSpeechEvent('end'|'stop')`
- `window.__dawayaConnectivityEvent('online'|'offline')`

---

## 8. الإعدادات الرئيسية

| الإعداد | الموقع | القيمة الحالية |
| --- | --- | --- |
| معرّف التطبيق | `capacitor.config.json` وتوقيع Xcode | `com.dawaya.medicineguide` |
| اسم العرض | `Info.plist` و`InfoPlist.strings` | Dawaya / دوايا |
| مجلد الويب | `capacitor.config.json` | `www` |
| الخلفية | الإعدادات والأصول | `#F8F9FA` / `#121212` |
| شريط الحالة | `DawayaShellViewController` | يتبع سمة الويب |
| أقل إصدار iOS | Xcode و`Package.swift` | 15.0 |
| الاتجاهات | `Info.plist` | عمودي/أفقي (iPhone)، الكل (iPad) |
| قاعدة البيانات | `webapp/app.js` `BUNDLED_DATA_URL` | `assets/egyptian-drugs.json` المضمّن |
| حد التذكيرات | `ios-shell.js` `MAX_REMINDERS` | 20 |

لا يوجد تنزيل عند بدء التشغيل. الطلبات الخارجية محصورة بالمضيفين المسموح بهم
في `privacy.config.json` (WHO وFDA وPubMed) وبعد ضغط المستخدم على **تحديث
الأخبار** فقط؛ وكل الروابط الأخرى تُفتح في المتصفح.

---

## 9. التحقق والحدود المعروفة

`npm run verify` ينفّذ 15 فحصًا ساكنًا (يتطلب Node، غير المتوفر على جهاز البناء هذا):

- وجود الملفات وإصدارات Capacitor المثبتة؛
- اتساق إعدادات Capacitor وعدم وجود رابط خادم خارجي؛
- صحة صياغة جسر JavaScript وترتيب حقن السكربتات؛
- تطابق أصول `public/` مع مصادر `webapp/`؛
- نصوص الخصوصية، ATS، شاشة الإقلاع، ومخطط المشهد؛
- نصوص الخصوصية العربية والإنجليزية؛
- إفصاحات بيان الخصوصية؛
- تضمين كل ملفات Swift في طور المصادر؛
- موارد Xcode ومجموعة الترجمة وشاشة الإقلاع؛
- مخطط Xcode المشترك وربطه بهدف التطبيق؛
- أبعاد أيقونة المتجر وخلوّها من الشفافية؛
- تسجيل الإضافة ومندوب الإشعارات؛
- خيارات تصدير App Store Connect.

حدود هذه التسليمة:

1. **التوقيع.** يجب توقيع الأرشيف بفريق Apple الخاص بك؛ سكربتات المستودع تبني
   الأرشيف وتثبّته على جهاز موصول.
2. **App Store 4.2**: راجع الملاحظة أعلاه.
3. لا توجد واجهة رفع ملفات في تطبيق الويب، ولا يسجّل الغلاف الأصلي منتقي ملفات.
4. **لقطات الشاشة** لا يمكن منعها على iOS كما يفعل `FLAG_SECURE` في Android؛
   شاشة الخصوصية توضح هذا القيد.

### استكشاف الأخطاء

| العَرَض | الحل |
| --- | --- |
| شاشة بيضاء في المحاكي | نفّذ `npm run sync:ios`، وافتح Web Inspector من Safari ← Develop، وتأكد من وجود `public/index.html` في الهدف. |
| إضافة `DawayaShell` غير موجودة | تأكد من ضم جميع ملفات Swift إلى Compile Sources، ونظّف مجلد البناء، ثم أعد المزامنة. |
| خطأ توقيع `No profiles` | اختر الفريق، وتأكد من وجود Bundle ID في البوابة، وفعّل التوقيع التلقائي، وأضف `-allowProvisioningUpdates`. |
| الأرشيف للمحاكي فقط | اختر **Any iOS Device (arm64)** أو `-destination 'generic/platform=iOS'`. |
| التنزيلات غير ظاهرة | الملفات ← **على iPhone ← Dawaya ← Downloads**؛ المحاكي له حاويته الخاصة. |
| التذكيرات لا تظهر | اسمح بالإشعارات، ولا تتجاوز 20 تذكيرًا، وافتح صفحة التذكيرات لإعادة المزامنة. |
| تنبيه عدم الاتصال لا يختفي | أوقف **وضع عدم الاتصال** من شاشة الخصوصية أو أعد الاتصال. البيانات المضمّنة تبقى متاحة في الحالتين. |
| بناء TestFlight غير ظاهر | انتظر المعالجة، وأكمل الامتثال للتصدير، وتأكد من رقم بناء جديد. |
| محتوى ويب قديم بعد التعديل | نفّذ `npm run sync:ios` دائمًا، ونظّف مجلد بناء Xcode. |

---

## 10. التسليم

تُبنى إصدارات IPA من هذا الشجرة عبر `scripts/sync-web.sh` ثم خطوات أرشيف
وتصدير Xcode أعلاه، وتُثبّت على iPhone موصول للتحقق. تُنشر ملفات IPA وAPK
وDMG وEXE الموقّعة مع `VERSION.txt` و`SHA256SUMS.txt`.
