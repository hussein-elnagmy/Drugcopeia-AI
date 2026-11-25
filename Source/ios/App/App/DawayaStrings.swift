import Foundation

enum DawayaLanguage: String {
    case english = "en"
    case arabic = "ar"

    init(code: String?) {
        let value = (code ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self = value.hasPrefix("ar") ? .arabic : .english
    }

    var isRightToLeft: Bool { self == .arabic }

    private func text(_ english: String, _ arabic: String) -> String {
        self == .arabic ? arabic : english
    }

    var loadingSubtitle: String {
        text("Preparing your medicine guide…", "جارٍ تجهيز دليل الدواء…")
    }

    var offlineTitle: String {
        text("You're offline", "لا يوجد اتصال بالإنترنت")
    }

    var offlineMessage: String {
        text(
            "Dawaya can't reach the internet right now. Your saved medicines, reminders, and clinical tools still work on this device.",
            "تعذّر على Dawaya الاتصال بالإنترنت الآن. الأدوية المحفوظة والتذكيرات والأدوات الإكلينيكية ما زالت تعمل على هذا الجهاز."
        )
    }

    var offlineFootnote: String {
        text(
            "The live medicine database will refresh when you're back online.",
            "ستُحدَّث قاعدة بيانات الأدوية عند عودة الاتصال."
        )
    }

    var retry: String {
        text("Try again", "إعادة المحاولة")
    }

    var retrying: String {
        text("Checking connection…", "جارٍ التحقق من الاتصال…")
    }

    var continueOffline: String {
        text("Continue offline", "المتابعة دون اتصال")
    }

    var stillOffline: String {
        text("Still offline. Check Wi-Fi or cellular data.", "لا يزال الاتصال غير متاح. تحقّق من شبكة Wi-Fi أو بيانات الجوّال.")
    }

    var offlineModeNotice: String {
        text("Offline mode — live data won't refresh until you reconnect.", "وضع عدم الاتصال — لن تتحدّث البيانات الحيّة حتى يعود الاتصال.")
    }

    var downloadPreparing: String {
        text("Preparing download…", "جارٍ تجهيز التنزيل…")
    }

    var downloadSaved: String {
        text(
            "Saved in the app's Downloads folder.",
            "تم الحفظ في مجلد التنزيلات داخل التطبيق."
        )
    }

    var downloadFailed: String {
        text("The download could not be completed.", "تعذّر إكمال التنزيل.")
    }

    var mailDraftCopied: String {
        text(
            "No mail app is set up, so the message was copied. Paste it wherever you want to send it.",
            "لا يوجد تطبيق بريد مُفعّل، لذلك تم نسخ الرسالة. الصقها في أي مكان تريد إرسالها منه."
        )
    }

    var exportFile: String {
        text("Export file", "تصدير الملف")
    }

    var notificationTitle: String {
        text("Dose reminder", "تذكير بالجرعة")
    }

    var notificationBodyPrefix: String {
        text("Time to take", "حان وقت تناول")
    }

    var notificationRepeatPrefix: String {
        text("Still pending — take", "لم يُؤخذ بعد — تناول")
    }

    var openInDefaultBrowser: String {
        text("Open in browser", "افتح في المتصفح")
    }
}

/// Localized copy handed to native views. Views keep one instance for their
/// lifetime instead of re-reading the web view's language on every update.
@dynamicMemberLookup
struct DawayaStrings {
    let language: DawayaLanguage

    init(language: DawayaLanguage) {
        self.language = language
    }

    subscript<T>(dynamicMember keyPath: KeyPath<DawayaLanguage, T>) -> T {
        language[keyPath: keyPath]
    }
}
