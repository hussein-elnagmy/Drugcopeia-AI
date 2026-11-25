import Foundation
import UserNotifications

struct DawayaReminder: Equatable {
    let id: String
    let name: String
    let dose: String
    let hour: Int
    let minute: Int
    let taken: Bool

    /// Mirrors `DawayaCore.reminders.ESCALATION_MINUTES` in the web layer.
    static let escalationMinutes = [0, 10, 30]

    init?(payload: [String: Any]) {
        let rawID = (payload["id"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawName = (payload["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawDose = (payload["dose"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawTime = (payload["time"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        let parts = rawTime.split(separator: ":", omittingEmptySubsequences: false)
        guard !rawID.isEmpty,
              !rawName.isEmpty,
              parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else {
            return nil
        }

        self.id = String(rawID.prefix(80))
        self.name = String(rawName.prefix(80))
        self.dose = String(rawDose.prefix(80))
        self.hour = hour
        self.minute = minute
        self.taken = (payload["taken"] as? Bool) ?? false
    }

    var identifier: String { baseIdentifier(offset: 0) }

    func identifier(offset: Int) -> String { baseIdentifier(offset: offset) }

    private func baseIdentifier(offset: Int) -> String {
        var safeID = ""
        for scalar in id.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                safeID.append(String(scalar))
            } else {
                safeID.append("-")
            }
        }
        let total = hour * 60 + minute + offset
        let clock = String(format: "%02d%02d", (total / 60) % 24, total % 60)
        return "\(DawayaNotificationService.reminderPrefix)\(safeID).\(clock)\(offset == 0 ? "" : "+\(offset)")"
    }

    func time(offset: Int) -> (hour: Int, minute: Int) {
        let total = hour * 60 + minute + offset
        return ((total / 60) % 24, total % 60)
    }

    func body(language: DawayaLanguage, repeated: Bool) -> String {
        let strings = DawayaStrings(language: language)
        let suffix = dose.isEmpty ? "" : " — \(dose)"
        let prefix = repeated ? strings.notificationRepeatPrefix : strings.notificationBodyPrefix
        return "\(prefix) \(name)\(suffix)"
    }
}

/// Schedules daily local notifications for the medication reminders saved by
/// the web layer in `localStorage["dawaya-reminders-v1"]`.
///
/// Permission is requested only when the user actively adds or edits a
/// reminder (`requestAuthorization == true`), never on a silent background sync.
final class DawayaNotificationService {
    static let reminderPrefix = "dawaya.reminder."

    private let center = UNUserNotificationCenter.current()

    func synchronize(
        reminders: [DawayaReminder],
        language: DawayaLanguage,
        requestAuthorization: Bool,
        completion: @escaping (_ authorized: Bool, _ scheduled: Int) -> Void
    ) {
        if requestAuthorization, !reminders.isEmpty {
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                if let error {
                    NSLog("[Dawaya] Notification authorization failed: \(error.localizedDescription)")
                }
                DispatchQueue.main.async {
                    self.apply(reminders, language: language, authorized: granted, completion: completion)
                }
            }
            return
        }

        center.getNotificationSettings { settings in
            let authorized = Self.isAuthorized(settings.authorizationStatus)
            DispatchQueue.main.async {
                self.apply(reminders, language: language, authorized: authorized, completion: completion)
            }
        }
    }

    private func apply(
        _ reminders: [DawayaReminder],
        language: DawayaLanguage,
        authorized: Bool,
        completion: @escaping (Bool, Int) -> Void
    ) {
        guard authorized, !reminders.isEmpty else {
            removeAllOwnedNotifications()
            completion(authorized, 0)
            return
        }

        // The web enforces a maximum of 20, but deduplicating here protects
        // against rapid edits producing two requests for the same slot.
        var seen = Set<String>()
        let unique = reminders.filter { seen.insert($0.identifier).inserted }
        // A dose confirmed for today keeps its daily alert but stops the
        // follow-ups, so nothing else pings until the next day.
        let desired = Set(unique.flatMap { reminder in
            (reminder.taken ? [0] : DawayaReminder.escalationMinutes).map { reminder.identifier(offset: $0) }
        })

        // Read the pending list before replacing requests. Adding a request with
        // an existing identifier updates it in place, so only identifiers that
        // disappeared from the list need an explicit removal. This avoids an
        // asynchronous remove racing with (and deleting) the requests we add.
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { return }
            let owned = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) }
            let stale = owned.filter { !desired.contains($0) }
            if !stale.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: stale)
            }
            if !owned.isEmpty {
                self.center.removeDeliveredNotifications(withIdentifiers: owned)
            }

            let group = DispatchGroup()
            var scheduled = 0
            let lock = NSLock()

            for reminder in unique {
                for offset in (reminder.taken ? [0] : DawayaReminder.escalationMinutes) {
                    let content = UNMutableNotificationContent()
                    content.title = DawayaStrings(language: language).notificationTitle
                    content.body = reminder.body(language: language, repeated: offset > 0)
                    content.sound = Self.alertSound
                    content.threadIdentifier = "dawaya.reminders"
                    content.userInfo = ["reminderId": reminder.id, "offset": offset]

                    var components = DateComponents()
                    components.hour = reminder.time(offset: offset).hour
                    components.minute = reminder.time(offset: offset).minute
                    let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
                    let request = UNNotificationRequest(
                        identifier: reminder.identifier(offset: offset),
                        content: content,
                        trigger: trigger
                    )

                    group.enter()
                    self.center.add(request) { error in
                        if let error {
                            NSLog("[Dawaya] Could not schedule a reminder: \(error.localizedDescription)")
                        } else {
                            lock.lock()
                            scheduled += 1
                            lock.unlock()
                        }
                        group.leave()
                    }
                }
            }

            group.notify(queue: .main) {
                completion(true, scheduled)
            }
        }
    }

    /// A bundled 20-second chime reads as an urgent dose alert; a missing or
    /// unsupported file must not silently mute the reminder, so fall back.
    static let alertSound: UNNotificationSound = {
        if Bundle.main.url(forResource: "DawayaAlert", withExtension: "caf") != nil {
            return UNNotificationSound(named: UNNotificationSoundName("DawayaAlert.caf"))
        }
        return .default
    }()

    private func removeAllOwnedNotifications() {
        center.getPendingNotificationRequests { requests in
            let identifiers = requests
                .map(\.identifier)
                .filter { $0.hasPrefix(Self.reminderPrefix) }
            if !identifiers.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: identifiers)
            }
        }
        center.getDeliveredNotifications { notifications in
            let identifiers = notifications
                .map(\.request.identifier)
                .filter { $0.hasPrefix(Self.reminderPrefix) }
            if !identifiers.isEmpty {
                self.center.removeDeliveredNotifications(withIdentifiers: identifiers)
            }
        }
    }

    private static func isAuthorized(_ status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined, .denied:
            return false
        @unknown default:
            return false
        }
    }
}
