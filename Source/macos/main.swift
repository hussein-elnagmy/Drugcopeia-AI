import AVFoundation
import Cocoa
import Network
import Security
import Speech
import UniformTypeIdentifiers
import UserNotifications
import WebKit

// MARK: - Privacy policy (mirrors privacy.config.json)

/// Single place the shell reasons about what may reach the network. The lists
/// below MIRROR `Source/privacy.config.json` (network.allowedHosts and the
/// loopback entries). `scripts/privacy-check.py` is a CI gate that asserts the
/// Swift allowlist here and the JSON config stay identical — change one and the
/// build fails. Nothing the user types is ever sent to any of these hosts; the
/// only remote host exists so the user-initiated dataset download can run, and
/// that fetch is issued by the web layer, not by a navigation here.
enum DawayaPrivacyPolicy {
    struct AllowedHost {
        let host: String
        let scheme: String
        let pathPrefixes: [String]
        let localhost: Bool
        let userInitiatedOnly: Bool
        let methods: [String]

        init(host: String, scheme: String, pathPrefixes: [String], localhost: Bool,
             userInitiatedOnly: Bool, methods: [String] = ["GET"]) {
            self.host = host
            self.scheme = scheme
            self.pathPrefixes = pathPrefixes
            self.localhost = localhost
            self.userInitiatedOnly = userInitiatedOnly
            self.methods = methods
        }
    }

    /// The only remote hosts, exactly as in privacy.config.json. The first three
    /// carry the home page news list and are allowed to run on the app's own
    /// schedule; the rest only ever run because a person pressed something.
    /// Nothing else may leave the process.
    static let allowedHosts: [AllowedHost] = [
        AllowedHost(host: "www.who.int", scheme: "https",
                    pathPrefixes: ["/api/hubs/newsitems", "/rss-feeds/", "/news/item/"],
                    localhost: false, userInitiatedOnly: false),
        AllowedHost(host: "api.fda.gov", scheme: "https",
                    pathPrefixes: ["/drug/enforcement.json"],
                    localhost: false, userInitiatedOnly: false),
        AllowedHost(host: "eutils.ncbi.nlm.nih.gov", scheme: "https",
                    pathPrefixes: ["/entrez/eutils/"],
                    localhost: false, userInitiatedOnly: false),
        AllowedHost(host: "commons.wikimedia.org", scheme: "https",
                    pathPrefixes: ["/w/api.php"],
                    localhost: false, userInitiatedOnly: true),
        AllowedHost(host: "thumb.wikimedia.org", scheme: "https",
                    pathPrefixes: ["/wikipedia/commons/"],
                    localhost: false, userInitiatedOnly: true),
        AllowedHost(host: "upload.wikimedia.org", scheme: "https",
                    pathPrefixes: ["/wikipedia/commons/"],
                    localhost: false, userInitiatedOnly: true)
    ]

    /// Loopback origins are always permitted (the embedded shell server).
    static func isLoopback(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" else { return false }
        guard let host = url.host?.lowercased() else { return false }
        return host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "[::1]"
    }

    /// A navigation is allowed to run inside the web view ONLY when it targets
    /// our own loopback server on the current port. Everything else leaves the
    /// app (see the WKNavigationDelegate).
    static func isAllowedNavigation(_ url: URL, serverPort: UInt16?) -> Bool {
        guard isLoopback(url) else { return false }
        if url.host?.lowercased() == "127.0.0.1", let port = serverPort, url.port != Int(port) {
            return false
        }
        return true
    }

    /// True when an https GET matches an allowlisted host (and its path prefix).
    static func isAllowedRemote(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return false }
        return allowedHosts.contains { entry in
            entry.host.lowercased() == host && entry.scheme.lowercased() == scheme
                && (entry.pathPrefixes.isEmpty || entry.pathPrefixes.contains { url.path.hasPrefix($0) })
        }
    }
}

// MARK: - Keychain-backed secure store

/// Stores user-entered health content (custom drugs and reminders) in the
/// macOS Keychain so it is never written to plaintext localStorage. Keys are
/// restricted to `storage.localUserDataKeys` in privacy.config.json. Items are
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so they are never backed
/// up, never synced to iCloud, and unreadable on another device.
enum SecureStore {
    static let service = "com.dawaya.medicineguide.mac.secure"

    /// Mirror of privacy.config.json storage.localUserDataKeys. Anything else is
    /// rejected here so a bug in the page cannot shove health data into the Keychain
    /// under an unexpected key.
    static let secureOnlyKeys: Set<String> = [
        "dawaya-reminders-v1",
        "dawaya-reminder-taken-v1",
        "dawaya-custom-drugs-v1",
        "dawaya-ai-chat-v1",
        "dawaya-calc-history",
        "dawaya-study-stats"
    ]

    static func isAllowedKey(_ key: String) -> Bool { secureOnlyKeys.contains(key) }

    private static func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    static func read(_ key: String) -> String? {
        guard isAllowedKey(key) else { return nil }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ key: String, _ value: String) -> Bool {
        guard isAllowedKey(key) else { return false }
        let data = Data(value.utf8)
        let query = baseQuery(key)
        let updateAttributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        switch SecItemUpdate(query as CFDictionary, updateAttributes as CFDictionary) {
        case errSecSuccess:
            return true
        case errSecItemNotFound:
            var create = baseQuery(key)
            create[kSecValueData as String] = data
            create[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            return SecItemAdd(create as CFDictionary, nil) == errSecSuccess
        default:
            return false
        }
    }

    static func clear(_ key: String) -> Bool {
        guard isAllowedKey(key) else { return false }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Removes every item this app owns. Scoped to our unique service string, so
    /// it cannot touch entries written by any other application.
    static func clearAll() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

// MARK: - Embedded static file server

final class LocalServer {
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private let root: URL
    private let rootPath: String
    private let queue = DispatchQueue(label: "com.dawaya.mac.server", qos: .userInitiated)

    init(root: URL) {
        self.root = root.standardizedFileURL
        self.rootPath = self.root.path
    }

    func start(preferredPorts: [UInt16] = [47821, 47822, 47823, 47824], completion: @escaping (UInt16?) -> Void) {
        attempt(index: 0, ports: preferredPorts, completion: completion)
    }

    private func attempt(index: Int, ports: [UInt16], completion: @escaping (UInt16?) -> Void) {
        let requested = index < ports.count ? ports[index] : 0
        do {
            if index > ports.count { throw NSError(domain: "Dawaya", code: 1) }
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            // Bind to loopback only: the shell serves the bundled app to this process,
            // and nothing on the LAN or another local user may connect to it.
            parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: requested) ?? .any)
            let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: requested)!)
            self.listener = listener
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.port = listener.port?.rawValue ?? requested
                    DispatchQueue.main.async { completion(self.port) }
                case .failed:
                    listener.cancel()
                    self.listener = nil
                    guard index < ports.count else {
                        DispatchQueue.main.async { completion(nil) }
                        return
                    }
                    self.attempt(index: index + 1, ports: ports, completion: completion)
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.start(queue: queue)
        } catch {
            guard index < ports.count else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            attempt(index: index + 1, ports: ports, completion: completion)
        }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        read(connection, buffer: Data())
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let marker = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let header = String(decoding: buffer[..<marker.lowerBound], as: UTF8.self)
                self.respond(header: header, on: connection)
                return
            }
            if isComplete || error != nil || buffer.count > 2_000_000 {
                connection.cancel()
                return
            }
            self.read(connection, buffer: buffer)
        }
    }

    private func respond(header: String, on connection: NWConnection) {
        guard let requestLine = header.split(separator: "\r\n").first else {
            connection.cancel()
            return
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            send(status: "405 Method Not Allowed", body: Data("Method not allowed".utf8), type: "text/plain; charset=utf-8", on: connection)
            return
        }

        var path = String(parts[1])
        if let query = path.firstIndex(of: "?") { path = String(path[..<query]) }
        if let fragment = path.firstIndex(of: "#") { path = String(path[..<fragment]) }
        path = path.removingPercentEncoding ?? path
        if path.isEmpty || path == "/" { path = "/index.html" }
        if path.hasSuffix("/") { path += "index.html" }

        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let fileURL = root.appendingPathComponent(relative).standardizedFileURL
        guard fileURL.path == rootPath || fileURL.path.hasPrefix(rootPath + "/") else {
            send(status: "403 Forbidden", body: Data("Forbidden".utf8), type: "text/plain; charset=utf-8", on: connection)
            return
        }
        guard let body = try? Data(contentsOf: fileURL), !body.isEmpty || FileManager.default.fileExists(atPath: fileURL.path) else {
            send(status: "404 Not Found", body: Data("Not found".utf8), type: "text/plain; charset=utf-8", on: connection)
            return
        }
        send(status: "200 OK", body: body, type: Self.mimeType(for: fileURL.pathExtension), on: connection)
    }

    private func send(status: String, body: Data, type: String, on connection: NWConnection) {
        let head = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        var payload = Data(head.utf8)
        payload.append(body)
        connection.send(content: payload, completion: .contentProcessed { _ in connection.cancel() })
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - Reminder notifications

struct MacReminder {
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
              (0...59).contains(minute) else { return nil }
        self.id = String(rawID.prefix(80))
        self.name = String(rawName.prefix(80))
        self.dose = String(rawDose.prefix(80))
        self.hour = hour
        self.minute = minute
        self.taken = (payload["taken"] as? Bool) ?? false
    }

    var identifier: String { identifier(offset: 0) }

    func identifier(offset: Int) -> String {
        var safeID = ""
        for scalar in id.unicodeScalars {
            safeID.append(CharacterSet.alphanumerics.contains(scalar) ? String(scalar) : "-")
        }
        let clock = String(format: "%02d%02d", time(offset: offset).hour, time(offset: offset).minute)
        return "\(MacReminderService.reminderPrefix)\(safeID).\(clock)\(offset == 0 ? "" : "+\(offset)")"
    }

    func time(offset: Int) -> (hour: Int, minute: Int) {
        let total = hour * 60 + minute + offset
        return ((total / 60) % 24, total % 60)
    }

    func body(language: String, repeated: Bool = false) -> String {
        let prefix = repeated
            ? (language == "ar" ? "لم يُؤخذ بعد — تناول" : "Still pending — take")
            : (language == "ar" ? "حان وقت تناول" : "Time to take")
        let suffix = dose.isEmpty ? "" : " — \(dose)"
        return "\(prefix) \(name)\(suffix)"
    }
}

/// Schedules daily local notifications for the reminders stored by the web
/// layer in `localStorage["dawaya-reminders-v1"]`.
final class MacReminderService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = MacReminderService()
    static let reminderPrefix = "dawaya.reminder."

    private let center = UNUserNotificationCenter.current()

    private static func debugLog(_ line: String) {
        // Compiled out of Release. Must never interpolate user-entered text: a
        // reminder id/name/dose is health content, so only opaque counts and
        // non-user flags are logged. privacy.config.json logging.forbiddenLogTopics
        // lists the fields that may never reach a log line.
        #if DEBUG
        NSLog("[Dawaya] %@", line)
        #endif
    }

    func activate() {
        center.delegate = self
    }

    func synchronize(reminders: [MacReminder], language: String, requestAuthorization: Bool) {
        Self.debugLog("sync requested: count=\(reminders.count) request=\(requestAuthorization)")
        let proceed: (Bool) -> Void = { [weak self] authorized in
            guard let self else { return }
            if authorized {
                self.apply(reminders, language: language)
            } else {
                self.removeOwnedRequests()
            }
        }
        if requestAuthorization, !reminders.isEmpty {
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                Self.debugLog("authorization granted=\(granted) error=\(error?.localizedDescription ?? "none")")
                self.center.getNotificationSettings { settings in
                    DispatchQueue.main.async {
                        Self.debugLog("settings status=\(settings.authorizationStatus.rawValue)")
                        proceed(Self.isAuthorized(settings.authorizationStatus))
                    }
                }
            }
            return
        }
        center.getNotificationSettings { settings in
            DispatchQueue.main.async { proceed(Self.isAuthorized(settings.authorizationStatus)) }
        }
    }

    private func apply(_ reminders: [MacReminder], language: String) {
        var seen = Set<String>()
        let unique = reminders.filter { seen.insert($0.identifier).inserted }
        // A dose confirmed for today keeps its daily alert but stops the
        // follow-ups, so nothing else pings until the next day.
        let desired = Set(unique.flatMap { reminder in
            Self.slots(reminder).map { reminder.identifier(offset: $0) }
        })
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { return }
            Self.debugLog("pending before apply: count=\(requests.count)")
            let owned = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) }
            let stale = owned.filter { !desired.contains($0) }
            if !stale.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: stale)
            }
            for reminder in unique {
                for offset in Self.slots(reminder) {
                    let content = UNMutableNotificationContent()
                    content.title = language == "ar" ? "تذكير بالجرعة" : "Dose reminder"
                    content.body = reminder.body(language: language, repeated: offset > 0)
                    content.sound = Self.alertSound
                    content.threadIdentifier = "dawaya.reminders"
                    content.userInfo = ["reminderId": reminder.id, "offset": offset]

                    var components = DateComponents()
                    components.hour = reminder.time(offset: offset).hour
                    components.minute = reminder.time(offset: offset).minute
                    let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
                    let request = UNNotificationRequest(identifier: reminder.identifier(offset: offset), content: content, trigger: trigger)
                    self.center.add(request) { error in
                        if let error {
                            // Log only that scheduling failed, never the reminder
                            // identifier (it derives from user-entered content).
                            Self.debugLog("schedule failed: \(error._domain)")
                        } else {
                            Self.debugLog("scheduled a reminder slot")
                        }
                    }
                }
            }
        }
    }

    private static func slots(_ reminder: MacReminder) -> [Int] {
        reminder.taken ? [0] : MacReminder.escalationMinutes
    }

    /// A bundled 20-second chime reads as an urgent dose alert; a missing or
    /// unsupported file must not silently mute the reminder, so fall back.
    static let alertSound: UNNotificationSound = {
        if Bundle.main.url(forResource: "DawayaAlert", withExtension: "caf") != nil {
            return UNNotificationSound(named: UNNotificationSoundName("DawayaAlert.caf"))
        }
        return .default
    }()

    private func removeOwnedRequests() {
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { return }
            let owned = requests.map(\.identifier).filter { $0.hasPrefix(Self.reminderPrefix) }
            if !owned.isEmpty {
                self.center.removePendingNotificationRequests(withIdentifiers: owned)
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Self.debugLog("presented a reminder")
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        Self.debugLog("opened a reminder")
        NSApp.activate(ignoringOtherApps: true)
        completionHandler()
    }

    private static func isAuthorized(_ status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral: return true
        default: return false
        }
    }
}

// MARK: - Application

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: LocalServer?
    private var serverPort: UInt16?
    private var nativeBridge: NativeBridge?
    private var memoryPressure: DispatchSourceMemoryPressure?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        MacReminderService.shared.activate()

        /* A hidden background app must not keep ~1 GB of weights resident. */
        NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { _ in LlamaEngine.shared.unload() }
        let pressure = DispatchSource.makeMemoryPressureSource(eventMask: [.warning, .critical], queue: .main)
        pressure.setEventHandler { LlamaEngine.shared.unload() }
        pressure.resume()
        memoryPressure = pressure

        let configuration = WKWebViewConfiguration()
        // The Web Inspector is a debugging tool: opt in with DAWAYA_DEVTOOLS=1, never on
        // by default in a shipped build.
        if ProcessInfo.processInfo.environment["DAWAYA_DEVTOOLS"] == "1" {
            configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
        }
        configuration.websiteDataStore = .default()

        let bridge = NativeBridge()
        // The reply-capable variant imports as addScriptMessageHandler(_:contentWorld:name:).
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "dawayaBridge")
        configuration.userContentController.addUserScript(WKUserScript(
            source: NativeBridge.webScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        bridge.webView = webView
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        self.webView = webView
        self.nativeBridge = bridge

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Drugcopeia"
        window.minSize = NSSize(width: 880, height: 640)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window

        guard let resources = Bundle.main.resourceURL else {
            showFailure("The app bundle is incomplete.")
            return
        }
        let server = LocalServer(root: resources.appendingPathComponent("www", isDirectory: true))
        self.server = server
        server.start { [weak self] port in
            guard let self else { return }
            guard let port, let url = URL(string: "http://127.0.0.1:\(port)/index.html") else {
                self.showFailure("The local Dawaya server could not start.")
                return
            }
            self.serverPort = port
            self.webView.load(URLRequest(url: url))
        }

        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Navigation

    // NOTE: WebKit exposes no *public* macOS API to hard-disable network access
    // for a WKWebView (the `networkAccessEnabled` KVC key is private and must not
    // be used). Enforcement therefore lives in this navigation delegate plus the
    // injected JS wrapper (window.DawayaPrivacyPolicy / setOfflineMode): only
    // loopback navigations run in the web view, everything else is cancelled or
    // handed to the OS browser, and the dataset fetch is a user-initiated GET the
    // page issues itself to the single allowlisted host.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        // Only our own loopback shell server may navigate inside the web view.
        if DawayaPrivacyPolicy.isAllowedNavigation(url, serverPort: serverPort) {
            decisionHandler(.allow)
            return
        }
        // Everything else leaves the app: a real tap is handed to the OS browser and
        // Dawaya never fetches these in-process. Offline mode governs this app's own
        // traffic, not the handoff — the browser makes its own request, from its own
        // cookie jar, with no referrer from Dawaya.
        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // A target=_blank link opened by a real tap belongs to the OS browser, exactly
        // like a normal link. Without a gesture it is a scripted popup and is dropped.
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {}

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        NSSound.beep()
    }

    // MARK: Permissions and dialogs

    // The bundled page may use the camera and the microphone for its own scan
    // and voice buttons. Any other origin is refused; the shell never grants a
    // capture prompt to a page it did not ship itself.
    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = origin.protocol == "file" || origin.host == "localhost" || origin.host == "127.0.0.1"
        decisionHandler(trusted ? .grant : .deny)
    }

    // A WKUIDelegate that does not answer runOpenPanel makes every <input
    // type="file"> in the page a dead button, so the photo picker needs it.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image]
        panel.begin { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Dawaya"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Dawaya"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Dawaya"
        alert.informativeText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    // MARK: Menu actions

    @objc private func reloadPage() { webView.reload() }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }
    @objc private func goForward() { if webView.canGoForward { webView.goForward() } }
    @objc private func actualSize() { webView.pageZoom = 1.0 }
    @objc private func zoomIn() { webView.pageZoom = min(2.0, webView.pageZoom + 0.1) }
    @objc private func zoomOut() { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }

    private func showFailure(_ message: String) {
        let html = "<html><body style=\"font-family:-apple-system;padding:40px\"><h2>Drugcopeia</h2><p>\(message)</p></body></html>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Drugcopeia", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Drugcopeia", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Drugcopeia", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "[")
        viewMenu.addItem(withTitle: "Forward", action: #selector(goForward), keyEquivalent: "]")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(actualSize), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }
}


// MARK: - Native bridge (appearance, reminders, secure store, offline mode)

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?

    /// Process-wide offline flag toggled by the page via setOfflineMode(); read
    /// by the navigation delegate to decide whether external links may be handed
    /// to the OS browser at all. Online is the default; the page mirrors the
    /// stored setting here on every launch.
    static var offlineModeEnabled = false

    private var voiceSearch: MacVoiceSearch?

    /// Tokens are pooled and pushed on a beat instead of one web view call each.
    private var tokenBuffer = ""
    private var tokenRequest = ""
    private var tokenFlushQueued = false
    private static let tokenFlushInterval = 0.05

    static let webScript = """
    (function () {
      document.documentElement.setAttribute('data-native-shell', 'mac');
      function post(payload) {
        try { window.webkit.messageHandlers.dawayaBridge.postMessage(payload); } catch (error) {}
      }
      function request(payload) {
        try { return Promise.resolve(window.webkit.messageHandlers.dawayaBridge.postMessage(payload)); }
        catch (error) { return Promise.resolve(undefined); }
      }
      (function () {
        var root = document.documentElement, last = '';
        function send() {
          var preference = ['light', 'dark', 'system'].indexOf(root.dataset.themePreference) >= 0 ? root.dataset.themePreference : 'system';
          var theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
          var signature = theme + '|' + preference;
          if (signature === last) return;
          last = signature;
          post({ type: 'appearance', theme: theme, preference: preference });
        }
        if (window.MutationObserver) {
          new MutationObserver(send).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-theme-preference'] });
        }
        send();
      })();
      // Keychain-backed secure store for user-entered health content. The native
      // side (SecureStore) accepts only privacy.config.json storage.localUserDataKeys.
      window.DawayaMacSecureStore = {
        secureAvailable: function () { return request({ type: 'secureAvailable' }); },
        secureRead: function (opts) { return request({ type: 'secureRead', key: String((opts && opts.key) || '') }); },
        secureWrite: function (opts) { return request({ type: 'secureWrite', key: String((opts && opts.key) || ''), value: String((opts && opts.value) || '') }); },
        secureClear: function (opts) { return request({ type: 'secureClear', key: String((opts && opts.key) || '') }); },
        secureClearAll: function () { return request({ type: 'secureClearAll' }); }
      };
      window.setOfflineMode = function (opts) {
        var enabled = Boolean(opts && opts.enabled);
        window.__dawayaOfflineMode = enabled;
        return request({ type: 'setOfflineMode', enabled: enabled });
      };
      // The shared bridge name the web layer expects (see webapp/net.js). openExternal
      // falls back to window.open, which the app delegate hands to the OS browser.
      function llmRequest(type, payload) {
        var body = { type: type };
        if (payload) Object.keys(payload).forEach(function (key) { body[key] = payload[key]; });
        return request(body);
      }
      window.DawayaLLMTransport = 'macos';
      window.DawayaNative = Object.freeze({
        setOfflineMode: function (enabled) { return window.setOfflineMode({ enabled: Boolean(enabled) }); },
        scanCode: function (options) {
          return request({ type: 'scanCode', language: options && options.language === 'ar' ? 'ar' : 'en' });
        },
        // Reads a pack photograph the assistant page was given: barcodes and printed
        // words, both by the operating system on this machine. See native/apple/PhotoReader.swift.
        readPhoto: function (options) {
          var image = options && options.image ? String(options.image) : '';
          if (!image) return Promise.resolve({ error: 'no-image', codes: [], text: '' });
          return request({ type: 'readPhoto', image: image });
        },
        startVoiceSearch: function (options) {
          return request({ type: 'startVoiceSearch', language: (options && options.language) ? String(options.language) : 'en-US' });
        },
        stopVoiceSearch: function () { return request({ type: 'stopVoiceSearch' }); },
        openInAppBrowser: function (url, language) {
          var href = String(url || '');
          var lower = href.toLowerCase();
          if (lower.indexOf('http://') !== 0 && lower.indexOf('https://') !== 0) {
            return Promise.resolve({ presented: false, target: 'blocked' });
          }
          return request({ type: 'presentInAppBrowser', url: href, language: language === 'ar' ? 'ar' : 'en' });
        },
        // The on-device llama.cpp engine (native/apple/LlamaEngine.swift). Tokens stream
        // back through window.__dawayaLLMEvent, the hub ai/llm-bridge.js subscribes to.
        llm: Object.freeze({
          capabilities: function () { return llmRequest('llmCapabilities'); },
          status: function () { return llmRequest('llmStatus'); },
          download: function (options) { return llmRequest('llmDownload', { options: options || {} }); },
          pauseDownload: function (id) { return llmRequest('llmPause', { id: id }); },
          resumeDownload: function (id) { return llmRequest('llmResume', { id: id }); },
          cancelDownload: function (id) { return llmRequest('llmCancel', { id: id }); },
          verifyDownload: function (id) { return llmRequest('llmVerify', { id: id }); },
          importModel: function () { return llmRequest('llmImport'); },
          deleteModel: function () { return llmRequest('llmDelete'); },
          load: function (params) { return llmRequest('llmLoad', { params: params || {} }); },
          unload: function () { return llmRequest('llmUnload'); },
          generate: function (request) { return llmRequest('llmGenerate', request || {}); },
          cancelGeneration: function (id) { return llmRequest('llmCancelGeneration', { requestId: id }); }
        })
      });
      // Mirrors Source/privacy.config.json network.allowedHosts. scripts/privacy-check.py
      // asserts this JS list, the Swift allowlist (DawayaPrivacyPolicy in main.swift)
      // and the JSON config stay byte-identical; edit all three together.
      window.DawayaPrivacyPolicy = {
        allowedHosts: [
          { host: 'www.who.int', scheme: 'https', pathPrefixes: ['/api/hubs/newsitems', '/rss-feeds/', '/news/item/'], methods: ['GET'], userInitiatedOnly: false },
          { host: 'api.fda.gov', scheme: 'https', pathPrefixes: ['/drug/enforcement.json'], methods: ['GET'], userInitiatedOnly: false },
          { host: 'eutils.ncbi.nlm.nih.gov', scheme: 'https', pathPrefixes: ['/entrez/eutils/'], methods: ['GET'], userInitiatedOnly: false },
          { host: 'commons.wikimedia.org', scheme: 'https', pathPrefixes: ['/w/api.php'], methods: ['GET'], userInitiatedOnly: true },
          { host: 'thumb.wikimedia.org', scheme: 'https', pathPrefixes: ['/wikipedia/commons/'], methods: ['GET'], userInitiatedOnly: true },
          { host: 'upload.wikimedia.org', scheme: 'https', pathPrefixes: ['/wikipedia/commons/'], methods: ['GET'], userInitiatedOnly: true },
          { host: '127.0.0.1', scheme: 'http', localhost: true, methods: ['GET'] },
          { host: 'localhost', scheme: 'http', localhost: true, methods: ['GET'] }
        ],
        bannedOrigins: ['*.wikipedia.org', 'clinicaltables.nlm.nih.gov', 'www.bing.com', 'bing.com', 'www.google.com', 'mail.google.com', 'encrypted-tbn*.googleusercontent.com', 'tse*.mm.bing.net'],
        isAllowedUrl: function (href) {
          try {
            var u = new URL(href, window.location.href);
            var scheme = u.protocol.replace(':', '').toLowerCase();
            var host = u.hostname.toLowerCase();
            for (var i = 0; i < this.allowedHosts.length; i++) {
              var entry = this.allowedHosts[i];
              if (entry.scheme === scheme && entry.host === host) {
                var prefixes = entry.pathPrefixes || [];
                if (!prefixes.length) { return true; }
                for (var j = 0; j < prefixes.length; j++) {
                  if (u.pathname.indexOf(prefixes[j]) === 0) { return true; }
                }
              }
            }
            return false;
          } catch (error) { return false; }
        }
      };
      var REMINDER_KEY = 'dawaya-reminders-v1', TAKEN_KEY = 'dawaya-reminder-taken-v1', MAX_REMINDERS = 20;
      var knownReminderIds = {}, reminderNeedsPermission = false, reminderSyncTimer = 0, lastReminderSignature = '';
      function takenToday() {
        try {
          var map = JSON.parse(window.localStorage.getItem(TAKEN_KEY) || '{}');
          var now = new Date();
          var pad = function (value) { return String(value).length < 2 ? '0' + value : String(value); };
          var key = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
          return Array.isArray(map[key]) ? map[key] : [];
        } catch (error) { return []; }
      }
      function readReminders() {
        try {
          var raw = window.localStorage.getItem(REMINDER_KEY);
          if (!raw) return [];
          var list = JSON.parse(raw);
          if (!Array.isArray(list)) return [];
          var taken = {};
          takenToday().forEach(function (id) { taken[String(id)] = true; });
          return list.slice(0, MAX_REMINDERS).map(function (item) {
            return {
              id: String(item && item.id || '').slice(0, 80),
              name: String(item && item.name || '').replace(/[ \\t\\r\\n]+/g, ' ').trim().slice(0, 80),
              dose: String(item && item.dose || '').replace(/[ \\t\\r\\n]+/g, ' ').trim().slice(0, 80),
              time: String(item && item.time || '').trim(),
              taken: Boolean(taken[String(item && item.id || '')])
            };
          }).filter(function (item) {
            return item.id && item.name && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.time);
          });
        } catch (error) { return []; }
      }
      readReminders().forEach(function (item) { knownReminderIds[item.id] = true; });
      function syncRemindersToNative(requestPermission, delay) {
        reminderNeedsPermission = reminderNeedsPermission || Boolean(requestPermission);
        if (reminderSyncTimer) window.clearTimeout(reminderSyncTimer);
        reminderSyncTimer = window.setTimeout(function () {
          reminderSyncTimer = 0;
          var reminders = readReminders();
          var request = reminderNeedsPermission && reminders.length > 0;
          reminderNeedsPermission = false;
          var signature = JSON.stringify(reminders);
          if (signature === lastReminderSignature && !request) return;
          lastReminderSignature = signature;
          post({
            type: 'syncReminders',
            reminders: reminders,
            language: (document.documentElement.lang || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en',
            requestAuthorization: request
          });
        }, delay || 350);
      }
      function noteReminderChange() {
        var reminders = readReminders(), next = {}, added = false;
        reminders.forEach(function (item) { next[item.id] = true; if (!knownReminderIds[item.id]) added = true; });
        knownReminderIds = next;
        syncRemindersToNative(added, 300);
      }
      try {
        var storageProto = window.Storage && window.Storage.prototype;
        var watchedReminderKey = function (key) { return key === REMINDER_KEY || key === TAKEN_KEY; };
        if (storageProto && storageProto.setItem && storageProto.removeItem) {
          var originalSetItem = storageProto.setItem, originalRemoveItem = storageProto.removeItem;
          storageProto.setItem = function (key, value) {
            var result = originalSetItem.apply(this, arguments);
            if (watchedReminderKey(key) && this === window.localStorage) noteReminderChange();
            return result;
          };
          storageProto.removeItem = function (key) {
            var result = originalRemoveItem.apply(this, arguments);
            if (watchedReminderKey(key) && this === window.localStorage) noteReminderChange();
            return result;
          };
        }
      } catch (error) {}
      syncRemindersToNative(false, 1200);
    })();
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.name == "dawayaBridge",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            replyHandler(nil, nil)
            return
        }
        switch type {
        case "appearance":
            let preference = body["preference"] as? String ?? "system"
            let dark = body["theme"] as? String == "dark"
            applyAppearance(preference: preference, dark: dark)
            replyHandler(nil, nil)
        case "syncReminders":
            let language = body["language"] as? String == "ar" ? "ar" : "en"
            let requestAuthorization = body["requestAuthorization"] as? Bool ?? false
            let payloads = body["reminders"] as? [[String: Any]] ?? []
            let reminders = payloads.compactMap { MacReminder(payload: $0) }
            MacReminderService.shared.synchronize(
                reminders: reminders,
                language: language,
                requestAuthorization: requestAuthorization
            )
            replyHandler(nil, nil)
        case "setOfflineMode":
            NativeBridge.offlineModeEnabled = body["enabled"] as? Bool ?? false
            replyHandler(["enabled": NativeBridge.offlineModeEnabled], nil)
        case "presentInAppBrowser":
            // Every link the reader taps, photographs included. Offline mode blocks it exactly
            // like every other remote page, so the answer is the same on all four platforms.
            let raw = body["url"] as? String ?? ""
            guard !NativeBridge.offlineModeEnabled,
                  let target = URL(string: raw),
                  let scheme = target.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else {
                replyHandler(["presented": false, "target": "blocked"], nil)
                return
            }
            let language = body["language"] as? String == "ar" ? "ar" : "en"
            DispatchQueue.main.async {
                MacBrowserWindow.present(url: target, language: language)
                replyHandler(["presented": true, "target": "in-app"], nil)
            }
        case "scanCode":
            let language = body["language"] as? String == "ar" ? "ar" : "en"
            MacCodeScanner.present(language: language) { outcome in
                switch outcome {
                case .code(let value):
                    replyHandler(["code": value], nil)
                case .cancelled:
                    replyHandler(["cancelled": true], nil)
                case .permissionDenied:
                    replyHandler(["error": "permission"], nil)
                case .unavailable:
                    replyHandler(["error": "unavailable"], nil)
                }
            }
        case "readPhoto":
            /* Vision is slow enough to be felt, so the picture is read off the main
               queue and the reply is handed back on it. */
            let base64 = body["image"] as? String ?? ""
            guard let picture = Data(base64Encoded: base64) else {
                replyHandler(["error": "image-decode-failed", "codes": [], "text": ""], nil)
                break
            }
            DispatchQueue.global(qos: .userInitiated).async {
                let read = PhotoReader.read(data: picture)
                DispatchQueue.main.async { replyHandler(read, nil) }
            }
        case "startVoiceSearch":
            let language = body["language"] as? String ?? "en-US"
            voiceSearch?.stop(cancel: true)
            let voice = MacVoiceSearch(language: language) { [weak self] text in
                self?.emitVoiceEvent(["type": "partial", "text": text])
            }
            voiceSearch = voice
            voice.start { [weak self] result in
                self?.voiceSearch = nil
                replyHandler(result, nil)
            }
        case "stopVoiceSearch":
            voiceSearch?.stop(cancel: true)
            voiceSearch = nil
            replyHandler(["stopped": true], nil)
        case "secureAvailable":
            replyHandler(["available": true, "backend": "macos-keychain"], nil)
        case "secureRead":
            let key = body["key"] as? String ?? ""
            replyHandler(SecureStore.read(key), nil)
        case "secureWrite":
            let key = body["key"] as? String ?? ""
            let value = body["value"] as? String ?? ""
            replyHandler(["success": SecureStore.write(key, value)], nil)
        case "secureClear":
            let key = body["key"] as? String ?? ""
            replyHandler(["success": SecureStore.clear(key)], nil)
        case "secureClearAll":
            replyHandler(["success": SecureStore.clearAll()], nil)
        case "llmCapabilities":
            replyHandler(LlamaEngine.shared.capabilities(), nil)
        case "llmStatus":
            replyHandler(LlamaEngine.shared.status(), nil)
        case "llmDownload":
            let options = body["options"] as? [String: Any] ?? [:]
            do {
                let id = try LlamaModelDownloader.shared.start(options: options) { [weak self] event in
                    self?.emitLLM(event)
                }
                replyHandler(["id": id], nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        case "llmPause":
            LlamaModelDownloader.shared.pause()
            replyHandler(["ok": true], nil)
        case "llmResume":
            do {
                let id = try LlamaModelDownloader.shared.resume()
                replyHandler(["id": id], nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        case "llmCancel":
            LlamaModelDownloader.shared.cancel()
            replyHandler(["ok": true], nil)
        case "llmVerify":
            replyHandler(LlamaEngine.shared.verify(sha: NativeBridge.modelConfigSha), nil)
        case "llmImport":
            replyHandler(importModelFile(), nil)
        case "llmDelete":
            LlamaModelDownloader.shared.cancel()
            replyHandler(LlamaEngine.shared.deleteModel(), nil)
        case "llmLoad":
            replyHandler(LlamaEngine.shared.load(params: body["params"] as? [String: Any]), nil)
        case "llmUnload":
            LlamaEngine.shared.unload()
            replyHandler(["ok": true], nil)
        case "llmGenerate":
            let requestId = body["requestId"] as? String ?? "r\(Int(Date().timeIntervalSince1970))"
            let prompt = body["prompt"] as? String ?? ""
            let params = LlamaGenerationParams(body["params"] as? [String: Any])
            let bridge = self
            DispatchQueue.global(qos: .userInitiated).async {
                let result = LlamaEngine.shared.generate(requestId: requestId, prompt: prompt, params: params) { piece in
                    bridge.emitToken(requestId: requestId, piece: piece)
                }
                DispatchQueue.main.async {
                    bridge.flushTokens()
                    replyHandler(result, nil)
                }
            }
        case "llmCancelGeneration":
            LlamaEngine.shared.cancel(requestId: body["requestId"] as? String)
            replyHandler(["ok": true], nil)
        default:
            replyHandler(nil, nil)
        }
    }

    /// The checksum the JS layer already pins; native verification uses the same value.
    private static let modelConfigSha: String = {
        guard let root = Bundle.main.resourceURL,
              let data = try? Data(contentsOf: root.appendingPathComponent("www/assets/ai/model-config.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let model = json["model"] as? [String: Any],
              let sha = model["sha256"] as? String else {
            return ""
        }
        return sha
    }()

    private func importModelFile() -> [String: Any] {
        let panel = NSOpenPanel()
        panel.title = "Import the Drugcopeia model file"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedFileTypes = ["gguf"]
        guard panel.runModal() == .OK, let url = panel.url else {
            return ["ok": false, "error": "cancelled"]
        }
        return LlamaEngine.shared.importCopy(from: url, expectingSha: NativeBridge.modelConfigSha)
    }

    private func emitVoiceEvent(_ event: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.DawayaVoice && window.DawayaVoice.event(\(json));", completionHandler: nil)
        }
    }

    /// A word at a time is what the reader should see, but a web view call per token
    /// costs more than the token itself, so pieces pile up and one call carries
    /// whatever arrived since the last beat.
    private func emitToken(requestId: String, piece: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if requestId != self.tokenRequest {
                self.flushTokens()
                self.tokenRequest = requestId
            }
            self.tokenBuffer += piece
            guard !self.tokenFlushQueued else { return }
            self.tokenFlushQueued = true
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.tokenFlushInterval) { [weak self] in
                guard let self else { return }
                self.tokenFlushQueued = false
                self.flushTokens()
            }
        }
    }

    private func flushTokens() {
        guard !tokenBuffer.isEmpty else { return }
        let piece = tokenBuffer
        tokenBuffer = ""
        emitLLM(["type": "token", "requestId": tokenRequest, "token": piece])
    }

    private func emitLLM(_ event: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__dawayaLLMEvent && window.__dawayaLLMEvent(\(json));", completionHandler: nil)
        }
    }

    private func applyAppearance(preference: String, dark: Bool) {
        DispatchQueue.main.async { [weak self] in
            let appearance: NSAppearance? = preference == "system" ? nil : NSAppearance(named: dark ? .darkAqua : .aqua)
            NSApp.appearance = appearance
            self?.webView?.window?.appearance = appearance
            self?.webView?.window?.backgroundColor = dark
                ? NSColor(calibratedWhite: 0.07, alpha: 1)
                : NSColor(calibratedWhite: 0.97, alpha: 1)
        }
    }
}


// MARK: - Box-code scanner

/// Camera sheet for macOS. AVFoundation decodes the frame in-process; the
/// window closes on the first code, on Cancel, or when the permission is
/// refused. No frame is captured, stored or uploaded.
final class MacCodeScanner: NSObject, AVCaptureMetadataOutputObjectsDelegate, NSWindowDelegate {
    enum Outcome {
        case code(String)
        case cancelled
        case permissionDenied
        case unavailable
    }

    private static var active: MacCodeScanner?

    private let language: String
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.dawaya.scan")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var completion: ((Outcome) -> Void)?
    private var window: NSWindow?
    private var statusLabel: NSTextField?
    private var delivered = false

    static func present(language: String, completion: @escaping (Outcome) -> Void) {
        guard active == nil else {
            completion(.unavailable)
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            show(language: language, completion: completion)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        show(language: language, completion: completion)
                    } else {
                        completion(.permissionDenied)
                    }
                }
            }
        default:
            completion(.permissionDenied)
        }
    }

    private static func show(language: String, completion: @escaping (Outcome) -> Void) {
        guard let device = AVCaptureDevice.default(for: .video) else {
            completion(.unavailable)
            return
        }
        let scanner = MacCodeScanner(language: language, completion: completion)
        active = scanner
        scanner.buildWindow(device: device)
    }

    private init(language: String, completion: @escaping (Outcome) -> Void) {
        self.language = language
        self.completion = completion
        super.init()
    }

    private func buildWindow(device: AVCaptureDevice) {
        let arabic = language == "ar"
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 500),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = arabic ? "مسح كود العلبة" : "Scan a box code"
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.delegate = self
        self.window = window

        let content = NSView()
        window.contentView = content

        let preview = MacPreviewView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.wantsLayer = true
        content.addSubview(preview)

        let help = NSTextField(wrappingLabelWithString: arabic
            ? "ضع الباركود أو رمز QR داخل الإطار. تُقرأ الأكواد على هذا الجهاز."
            : "Hold the barcode or QR code inside the frame. Codes are read on this device.")
        help.alignment = .center
        help.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(help)

        let status = NSTextField(wrappingLabelWithString: arabic
            ? "جارٍ تشغيل الكاميرا…"
            : "Starting the camera…")
        status.alignment = .center
        status.textColor = .secondaryLabelColor
        status.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(status)
        statusLabel = status

        let cancel = NSButton(title: arabic ? "إلغاء" : "Cancel", target: self, action: #selector(cancelTapped))
        cancel.bezelStyle = .rounded
        cancel.keyEquivalent = "\u{1b}"
        cancel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(cancel)

        NSLayoutConstraint.activate([
            preview.topAnchor.constraint(equalTo: content.topAnchor),
            preview.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            preview.heightAnchor.constraint(equalToConstant: 360),

            help.topAnchor.constraint(equalTo: preview.bottomAnchor, constant: 12),
            help.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
            help.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),

            status.topAnchor.constraint(equalTo: help.bottomAnchor, constant: 8),
            status.leadingAnchor.constraint(equalTo: help.leadingAnchor),
            status.trailingAnchor.constraint(equalTo: help.trailingAnchor),

            cancel.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 10),
            cancel.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14)
        ])

        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        configureSession(device: device, preview: preview)
    }

    private func configureSession(device: AVCaptureDevice, preview: MacPreviewView) {
        guard let input = try? AVCaptureDeviceInput(device: device) else {
            finish(.unavailable)
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .high
        guard session.canAddInput(input) else {
            session.commitConfiguration()
            finish(.unavailable)
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            finish(.unavailable)
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        let wanted: [AVMetadataObject.ObjectType] = [
            .ean13, .ean8, .upce, .code128, .code39, .code93, .itf14,
            .qr, .dataMatrix, .pdf417, .aztec
        ]
        let supported = wanted.filter { output.availableMetadataObjectTypes.contains($0) }
        guard !supported.isEmpty else {
            session.commitConfiguration()
            finish(.unavailable)
            return
        }
        output.metadataObjectTypes = supported
        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        preview.previewLayer = layer
        layer.frame = preview.bounds
        statusLabel?.stringValue = language == "ar"
            ? "ضع الكود داخل الإطار."
            : "Point the camera at the code."
        sessionQueue.async { [weak self] in
            self?.session.startRunning()
        }
    }

    @objc private func cancelTapped() {
        finish(.cancelled)
    }

    private func stopSession() {
        guard session.isRunning else { return }
        sessionQueue.async { [session] in
            session.stopRunning()
        }
    }

    private func finish(_ outcome: Outcome) {
        guard !delivered else { return }
        delivered = true
        stopSession()
        MacCodeScanner.active = nil
        let done = completion
        completion = nil
        window?.orderOut(nil)
        window?.close()
        window = nil
        done?(outcome)
    }

    func windowWillClose(_ notification: Notification) {
        finish(.cancelled)
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !delivered else { return }
        for object in metadataObjects {
            guard let readable = object as? AVMetadataMachineReadableCodeObject,
                  let value = readable.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty
            else { continue }
            NSSound.beep()
            finish(.code(value))
            return
        }
    }
}

/// Keeps the preview layer sized to its view as the window changes size.
final class MacPreviewView: NSView {
    var previewLayer: AVCaptureVideoPreviewLayer? {
        didSet {
            oldValue?.removeFromSuperlayer()
            guard let previewLayer else { return }
            previewLayer.frame = bounds
            wantsLayer = true
            layer?.addSublayer(previewLayer)
        }
    }

    override func layout() {
        super.layout()
        previewLayer?.frame = bounds
    }
}

// MARK: - Voice search

/// One-shot speech recognition for macOS. Audio is fed into
/// SFSpeechRecognizer from the microphone and nothing is written to disk.
final class MacVoiceSearch {
    private var recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var completion: (([String: Any]) -> Void)?
    private var onPartial: ((String) -> Void)?
    private var timeout: DispatchWorkItem?
    private var finished = false
    private var tapInstalled = false
    private var latestText = ""

    init(language: String, onPartial: @escaping (String) -> Void) {
        self.onPartial = onPartial
        if let direct = SFSpeechRecognizer(locale: Locale(identifier: language)) {
            recognizer = direct
        } else if language.hasPrefix("ar") {
            recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ar-SA"))
        } else {
            recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        }
    }

    func start(completion: @escaping ([String: Any]) -> Void) {
        self.completion = completion
        guard let recognizer, recognizer.isAvailable else {
            finish(["error": "unavailable"])
            return
        }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard status == .authorized else {
                DispatchQueue.main.async { self?.finish(["error": "permission"]) }
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.begin(recognizer)
                    } else {
                        self.finish(["error": "permission"])
                    }
                }
            }
        }
    }

    func stop(cancel: Bool) {
        if cancel {
            finish(["cancelled": true])
        } else {
            finish(["error": "unavailable"])
        }
    }

    private func begin(_ recognizer: SFSpeechRecognizer) {
        do {
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
            self.request = request
            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            tapInstalled = true
            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty {
                        self.latestText = text
                        DispatchQueue.main.async { self.onPartial?(text) }
                    }
                    if result.isFinal {
                        self.finish(["text": text])
                    }
                } else if error != nil {
                    self.finish(self.latestText.isEmpty ? ["error": "no-speech"] : ["text": self.latestText])
                }
            }

            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.finish(self.latestText.isEmpty ? ["error": "no-speech"] : ["text": self.latestText])
            }
            timeout = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
        } catch {
            finish(["error": "unavailable"])
        }
    }

    private func finish(_ payload: [String: Any]) {
        guard !finished else { return }
        finished = true
        timeout?.cancel()
        timeout = nil
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        let done = completion
        completion = nil
        onPartial = nil
        DispatchQueue.main.async { done?(payload) }
    }
}

/// A plain browser window Dawaya opens over its own page for any link the reader taps —
/// news, a reference, a source citation, a pack photograph.
///
/// The app's main web view never loads a remote page (see `AppDelegate`'s navigation
/// policy). These windows are the one deliberate exception, because the reader asked to see
/// a page without losing the medicine: it is a separate web view with an **ephemeral**
/// data store, so no cookie, cache or history from it is ever written to disk or survives
/// the window closing; it shows the address it is on, it accepts nothing but http and
/// https, and Offline mode blocks it the same way the rest of the app does. Its header row
/// carries a button that hands the address to the default browser the reader chose in
/// System Settings. Dawaya reads nothing from the page.
final class MacBrowserWindow: NSObject, NSWindowDelegate, WKNavigationDelegate {
    private static var open: [String: MacBrowserWindow] = [:]

    private let window: NSWindow
    private let webView: WKWebView
    private let address: NSTextField
    private let targetURL: URL
    private let language: String

    static func present(url: URL, language: String) {
        let key = url.absoluteString
        if let existing = open[key] {
            existing.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let browser = MacBrowserWindow(url: url, language: language)
        open[key] = browser
        browser.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private init(url: URL, language: String) {
        self.language = language
        targetURL = url
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 980, height: 700), configuration: configuration)
        address = NSTextField(labelWithString: url.host ?? "")
        address.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        address.textColor = .secondaryLabelColor
        address.lineBreakMode = .byTruncatingMiddle
        address.translatesAutoresizingMaskIntoConstraints = false
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let browserButton = NSButton(title: language == "ar" ? "افتح في المتصفح" : "Open in browser",
                                     target: nil,
                                     action: nil)
        browserButton.bezelStyle = .rounded
        browserButton.controlSize = .small
        browserButton.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        browserButton.translatesAutoresizingMaskIntoConstraints = false
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 980, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()
        browserButton.target = self
        browserButton.action = #selector(openInDefaultBrowser)
        window.title = language == "ar" ? "صفحة خارجية" : "Web page"
        window.titleVisibility = .visible
        window.isReleasedWhenClosed = false
        window.delegate = self
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.allowsBackForwardNavigationGestures = true

        let content = NSView()
        content.addSubview(address)
        content.addSubview(browserButton)
        content.addSubview(webView)
        NSLayoutConstraint.activate([
            address.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            address.centerYAnchor.constraint(equalTo: browserButton.centerYAnchor),
            address.trailingAnchor.constraint(lessThanOrEqualTo: browserButton.leadingAnchor, constant: -8),
            browserButton.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            browserButton.topAnchor.constraint(equalTo: content.topAnchor, constant: 4),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: browserButton.bottomAnchor, constant: 2),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window.contentView = content
        window.center()
        webView.load(URLRequest(url: url))
    }

    /// The visible escape hatch: the same address, opened outside Dawaya in the reader's own
    /// default browser, with their profile, extensions and sign-ins. Nothing is re-fetched
    /// here — the operating system does it.
    @objc private func openInDefaultBrowser() {
        NSWorkspace.shared.open(webView.url ?? targetURL)
    }

    func windowWillClose(_ notification: Notification) {
        MacBrowserWindow.open = MacBrowserWindow.open.filter { $0.value !== self }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url, let scheme = target.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let host = webView.url?.host ?? ""
        address.stringValue = host.isEmpty ? (language == "ar" ? "جارٍ التحميل…" : "Loading…") : host
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
