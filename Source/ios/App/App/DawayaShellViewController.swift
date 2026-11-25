import SafariServices
import SwiftUI
import UIKit
import WebKit

/// Root container for the native experience.
///
/// It owns a Capacitor web view controller plus three native layers:
/// a launch/loading screen, an offline notice, and download toasts.
/// All overlays respect the safe area while the web view itself stays
/// edge-to-edge so the web app's `env(safe-area-inset-*)` layout remains exact.
///
/// The shell never performs a network request of its own: connectivity is read
/// from `NWPathMonitor`, which is a local state query, and the bundled app is
/// loaded straight from disk.
final class DawayaShellViewController: UIViewController {
    private let bridgeController = DawayaBridgeViewController()
    private let loadingView = DawayaLoadingView()
    private let offlineView = DawayaOfflineView()
    private let toastView = DawayaToastView()

    private let networkMonitor = DawayaNetworkMonitor()
    private let speechService = DawayaSpeechService()
    private let notificationService = DawayaNotificationService()

    private var theme: DawayaTheme
    private var themePreference = "system"

    private var networkStatus: DawayaNetworkMonitor.Status = .unknown
    private var isWebReady = false
    private var isOfflineVisible = false
    private var userChoseOffline = false
    private var offlineWorkItem: DispatchWorkItem?
    private var loadingTimeoutWork: DispatchWorkItem?
    private var loadFallbackWork: DispatchWorkItem?

    // MARK: - Lifecycle

    init() {
        theme = DawayaTheme(
            isDark: UITraitCollection.current.userInterfaceStyle == .dark,
            language: DawayaLanguage(code: Locale.preferredLanguages.first)
        )
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("Use init()")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = theme.background
        applyTheme(theme)
        configureServices()
        installBridge()
        installOverlays()
        configureNetworkMonitor()
        observeAppLifecycle()
        loadingView.startAnimating()
        scheduleLoadingTimeout()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        setNeedsStatusBarAppearanceUpdate()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        theme.statusBarStyle
    }

    override var childForStatusBarStyle: UIViewController? {
        nil
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        // In "system" mode the shell leaves the interface style unspecified so
        // the web view's prefers-color-scheme keeps following iOS. Re-apply the
        // native overlay palette whenever the device appearance switches.
        guard themePreference == "system", previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle else { return }
        applyTheme(DawayaTheme(isDark: traitCollection.userInterfaceStyle == .dark, language: theme.language))
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        networkMonitor.stop()
        speechService.stop()
        offlineWorkItem?.cancel()
        loadingTimeoutWork?.cancel()
        loadFallbackWork?.cancel()
    }

    // MARK: - Hierarchy

    private func installBridge() {
        addChild(bridgeController)
        bridgeController.shell = self
        bridgeController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bridgeController.view)
        NSLayoutConstraint.activate([
            bridgeController.view.topAnchor.constraint(equalTo: view.topAnchor),
            bridgeController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bridgeController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bridgeController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        bridgeController.didMove(toParent: self)
    }

    private func installOverlays() {
        offlineView.isHidden = true
        for overlay in [loadingView, offlineView, toastView] as [UIView] {
            overlay.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(overlay)
        }
        NSLayoutConstraint.activate([
            loadingView.topAnchor.constraint(equalTo: view.topAnchor),
            loadingView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            loadingView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            loadingView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            offlineView.topAnchor.constraint(equalTo: view.topAnchor),
            offlineView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offlineView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            offlineView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            toastView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            toastView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            toastView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
    }

    // MARK: - Services

    private func configureServices() {
        offlineView.onRetry = { [weak self] in
            self?.retryFromOffline(userInitiated: true)
        }
        offlineView.onContinueOffline = { [weak self] in
            self?.continueOffline()
        }
        speechService.onFinish = { [weak self] in
            self?.notifySpeech("end")
        }
    }

    func configureDownloadHandler(_ handler: DawayaDownloadHandler) {
        handler.onStart = { [weak self] in
            guard let self else { return }
            self.showToast(self.theme.strings.downloadPreparing, style: .progress)
        }
        handler.onFinish = { [weak self] url in
            guard let self else { return }
            let message = "\(self.theme.strings.downloadSaved)\n\(url.lastPathComponent)"
            self.showToast(message, style: .success, autoHideAfter: 6)
        }
        handler.onFailure = { [weak self] in
            guard let self else { return }
            self.showToast(self.theme.strings.downloadFailed, style: .failure, autoHideAfter: 5)
        }
    }

    // MARK: - Web lifecycle (called by the delegate proxy and plugin)

    func handleWebReady() {
        guard !isWebReady else { return }
        isWebReady = true
        loadFallbackWork?.cancel()
        loadingTimeoutWork?.cancel()
        hideLoading(animated: true)
        if networkStatus == .offline, !userChoseOffline {
            showOffline()
        }
    }

    func webViewDidStartLoading() {
        // No UI action: the native loading layer already covers initial launch.
    }

    func webViewDidFinishLoading() {
        guard !isWebReady else { return }
        loadFallbackWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.isWebReady else { return }
            self.isWebReady = true
            self.hideLoading(animated: true)
            if self.networkStatus == .offline, !self.userChoseOffline {
                self.showOffline()
            }
        }
        loadFallbackWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    func webViewDidFail(with error: Error) {
        // The bundled page lives on the device, so a failure here is almost always
        // the privacy gate cancelling a navigation. Only the domain and code are
        // logged: WebKit's localized description can carry the full URL, and a
        // source URL may name the medicine the user searched for.
        let nsError = error as NSError
        NSLog("[Dawaya] Web view navigation stopped in \(nsError.domain) (\(nsError.code))")
    }

    // MARK: - Appearance

    func applyAppearance(preference requestedPreference: String, languageCode: String) {
        let preference = ["light", "dark", "system"].contains(requestedPreference.lowercased()) ? requestedPreference.lowercased() : "system"
        let dark = preference == "dark" || (preference == "system" && traitCollection.userInterfaceStyle == .dark)
        let newTheme = DawayaTheme(
            isDark: dark,
            language: DawayaLanguage(code: languageCode)
        )
        applyTheme(newTheme, preference: preference)
    }

    private func applyTheme(_ newTheme: DawayaTheme, preference: String? = nil) {
        if let preference { themePreference = preference }
        theme = newTheme
        switch themePreference {
        case "dark": overrideUserInterfaceStyle = .dark
        case "light": overrideUserInterfaceStyle = .light
        default: overrideUserInterfaceStyle = .unspecified
        }
        view.backgroundColor = newTheme.background
        loadingView.apply(theme: newTheme)
        offlineView.apply(theme: newTheme)
        toastView.apply(theme: newTheme)
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: - Loading and offline layers

    private func scheduleLoadingTimeout() {
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.isWebReady else { return }
            self.isWebReady = true
            self.hideLoading(animated: true)
            if self.networkStatus == .offline, !self.userChoseOffline {
                self.showOffline()
            }
        }
        loadingTimeoutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
    }

    private func hideLoading(animated: Bool) {
        loadingTimeoutWork?.cancel()
        loadingTimeoutWork = nil
        guard !loadingView.isHidden else { return }
        loadingView.stopAnimating()

        guard animated else {
            loadingView.isHidden = true
            return
        }
        UIView.animate(withDuration: 0.28, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.loadingView.alpha = 0
        } completion: { _ in
            self.loadingView.isHidden = true
            self.loadingView.alpha = 1
        }
    }

    private func showOffline() {
        guard !isOfflineVisible else { return }
        offlineWorkItem?.cancel()
        isOfflineVisible = true
        offlineView.setBusy(false)
        offlineView.isHidden = false
        offlineView.alpha = 0
        view.bringSubviewToFront(offlineView)
        if !toastView.isHidden {
            view.bringSubviewToFront(toastView)
        }
        UIView.animate(withDuration: 0.24, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.offlineView.alpha = 1
        }
        UIAccessibility.post(notification: .screenChanged, argument: offlineView)
    }

    private func hideOffline() {
        guard isOfflineVisible else { return }
        isOfflineVisible = false
        offlineView.setBusy(false)
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.offlineView.alpha = 0
        } completion: { _ in
            self.offlineView.isHidden = true
            self.offlineView.alpha = 1
        }
        UIAccessibility.post(notification: .screenChanged, argument: nil)
    }

    private func continueOffline() {
        userChoseOffline = true
        hideOffline()
        showToast(theme.strings.offlineModeNotice, style: .info, autoHideAfter: 5)
    }

    /// The user's Offline mode setting, forwarded by the plugin.
    ///
    /// It is the switch that closes the navigation gate for every non-bundled
    /// load (see `DawayaPrivacyPolicy`). The offline layer is only the notice
    /// that live data will not refresh: the app stays fully usable because the
    /// medicine database is bundled, so the notice is dismissible and never
    /// driven by a network probe.
    func setOfflineMode(_ enabled: Bool) {
        DawayaPrivacyPolicy.isOfflineMode = enabled
        if enabled {
            guard !userChoseOffline else { return }
            showOffline()
            return
        }
        userChoseOffline = false
        hideOffline()
        // Live traffic is permitted again. Tell the web layer the real local
        // path state so its own gate and its "update data" affordance match.
        let state = networkStatus == .offline ? "offline" : "online"
        evaluateJS("window.__dawayaConnectivityEvent&&window.__dawayaConnectivityEvent('\(state)');")
    }

    // MARK: - Connectivity

    private func configureNetworkMonitor() {
        networkMonitor.onStatusChange = { [weak self] status, _ in
            self?.handleNetworkStatus(status)
        }
        networkMonitor.start()
    }

    private func handleNetworkStatus(_ status: DawayaNetworkMonitor.Status) {
        guard status != .unknown else { return }
        networkStatus = status

        switch status {
        case .offline:
            evaluateJS("window.__dawayaConnectivityEvent&&window.__dawayaConnectivityEvent('offline');")
            guard !userChoseOffline else { return }
            offlineWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self,
                      self.isWebReady,
                      !self.userChoseOffline,
                      self.networkStatus == .offline else { return }
                self.showOffline()
            }
            offlineWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)

        case .online:
            offlineWorkItem?.cancel()
            evaluateJS("window.__dawayaConnectivityEvent&&window.__dawayaConnectivityEvent('online');")
            if userChoseOffline {
                userChoseOffline = false
                retryWebDatabaseLoad()
            }
            if isOfflineVisible, !DawayaPrivacyPolicy.isOfflineMode {
                retryFromOffline(userInitiated: false)
            }

        case .unknown:
            break
        }
    }

    /// "Try again". The shell does not send a single packet to decide anything:
    /// the answer comes from the local `NWPathMonitor` state and from the user's
    /// own Offline mode setting. Bundled content always loads regardless, so a
    /// retry only dismisses the notice and lets the web layer re-attempt its
    /// user-initiated database update.
    private func retryFromOffline(userInitiated: Bool) {
        if DawayaPrivacyPolicy.isOfflineMode {
            if userInitiated {
                showToast(theme.strings.offlineModeNotice, style: .info, autoHideAfter: 5)
            }
            return
        }
        guard networkStatus == .online else {
            if userInitiated {
                offlineView.showStillOffline()
            }
            return
        }
        userChoseOffline = false
        hideOffline()
        evaluateJS("window.__dawayaConnectivityEvent&&window.__dawayaConnectivityEvent('online');")
        retryWebDatabaseLoad()
    }

    private func retryWebDatabaseLoad() {
        guard let webView = bridgeController.webView else { return }
        let script = """
        (function(){try{
          window.dispatchEvent(new Event('online'));
          var retry=document.querySelector('[data-retry-database]');
          if(retry){retry.click();return true;}
          return false;
        }catch(_){return false;}})();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - Speech

    func speak(text: String, language: String, rate: Float) -> Bool {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return false }
        speechService.speak(text: content, language: language, rate: rate)
        return true
    }

    func stopSpeaking() {
        speechService.stop()
    }

    private func notifySpeech(_ type: String) {
        evaluateJS("window.__dawayaNativeSpeechEvent&&window.__dawayaNativeSpeechEvent('\(type)');")
    }

    /// Streams an interim or final voice-search result into the page. Only the
    /// recognised text travels; the audio stays inside SFSpeechRecognizer.
    func emitVoiceEvent(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        evaluateJS("window.DawayaVoice&&window.DawayaVoice.event(\(json));")
    }

    // MARK: - Native drug detail

    @discardableResult
    func presentDrugDetail(_ drug: DrugDetail) -> Bool {
        guard presentedViewController == nil, view.window != nil else { return false }

        let controller = UIHostingController(
            rootView: DrugDetailSheet(drug: drug) { [weak self] in
                self?.dismiss(animated: true)
            }
            .environment(
                \.layoutDirection,
                theme.language.isRightToLeft ? .rightToLeft : .leftToRight
            )
        )
        controller.modalPresentationStyle = .pageSheet
        controller.overrideUserInterfaceStyle = theme.isDark ? .dark : .light
        controller.view.semanticContentAttribute =
            theme.language.isRightToLeft ? .forceRightToLeft : .forceLeftToRight
        if let sheet = controller.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }
        present(controller, animated: true)
        return true
    }

    // MARK: - Links and email

    /// Opens a link on an explicit user tap by leaving the app for the system browser.
    ///
    /// This is the last-resort path, for a shell or a page that asked for no browser view.
    /// The reason it never renders remotely is unchanged: an `SFSafariViewController` keeps
    /// the request inside this process, shares the app's data store with the remote host and
    /// can be redirected anywhere — and the URL of a source page often names the medicine the
    /// user searched for. `presentInAppBrowser` is the deliberate, disclosed exception, and
    /// with Offline mode on neither path opens anything at all.
    func openLink(_ url: URL, completion: @escaping (Bool, String) -> Void) {
        guard view.window != nil else {
            completion(false, "blocked")
            return
        }

        if DawayaPrivacyPolicy.isBundled(url) {
            // Only the app's own bundled pages may load in-app.
            _ = bridgeController.webView?.load(URLRequest(url: url))
            completion(true, "in-app")
            return
        }

        guard DawayaPrivacyPolicy.isHTTP(url) else {
            completion(false, "blocked")
            return
        }

        guard !DawayaPrivacyPolicy.isOfflineMode else {
            showToast(theme.strings.offlineModeNotice, style: .info, autoHideAfter: 5)
            completion(false, "blocked")
            return
        }

        UIApplication.shared.open(url, options: [:]) { opened in
            completion(opened, opened ? "external" : "blocked")
        }
    }

    /// Presents a browser view over the app for any link the reader taps.
    ///
    /// `openLink` deliberately sends every remote page to the system browser, and this is
    /// the one screen that does the opposite, because the reader asked to look at a page
    /// without losing the medicine they were reading. It is still the operating system's own
    /// browser interface (`SFSafariViewController`), not a web view inside Dawaya: Dawaya
    /// cannot read the page, its cookies or its history, the address and Done control stay
    /// visible, and Offline mode blocks it the same way it blocks `openLink`.
    func presentInAppBrowser(_ url: URL, completion: @escaping (Bool, String) -> Void) {
        guard view.window != nil else {
            completion(false, "blocked")
            return
        }
        guard DawayaPrivacyPolicy.isHTTP(url) else {
            completion(false, "blocked")
            return
        }
        guard !DawayaPrivacyPolicy.isOfflineMode else {
            showToast(theme.strings.offlineModeNotice, style: .info, autoHideAfter: 5)
            completion(false, "blocked")
            return
        }
        let browser = DawayaBrowserViewController(
            url: url,
            actionTitle: theme.strings.openInDefaultBrowser
        )
        browser.modalPresentationStyle = .pageSheet
        present(browser, animated: true) { completion(true, "in-app") }
    }

    /// Opens the mail app with a `mailto:` link, or copies the message when the
    /// device has no mail account. The message never goes to a web compose
    /// endpoint: `mail.google.com?body=…` would have sent the whole draft,
    /// recipient and all, to Google's servers.
    func openMail(
        to recipient: String,
        subject: String,
        body: String,
        completion: @escaping (_ opened: Bool, _ copied: Bool) -> Void
    ) {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = recipient
        var items: [URLQueryItem] = []
        if !subject.isEmpty {
            items.append(URLQueryItem(name: "subject", value: subject))
        }
        if !body.isEmpty {
            items.append(URLQueryItem(name: "body", value: body))
        }
        components.queryItems = items.isEmpty ? nil : items
        guard let url = components.url else {
            completion(false, false)
            return
        }

        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            guard let self else {
                completion(opened, false)
                return
            }
            guard !opened else {
                completion(true, false)
                return
            }
            var draft = recipient
            if !subject.isEmpty { draft += "\n\n\(subject)" }
            if !body.isEmpty { draft += "\n\n\(body)" }
            UIPasteboard.general.string = draft
            self.showToast(self.theme.strings.mailDraftCopied, style: .info, autoHideAfter: 5)
            completion(false, true)
        }
    }

    // MARK: - Sharing and files

    func presentShare(title: String, text: String, url: String) -> Bool {
        var items: [Any] = []
        if let link = URL(string: url), !url.isEmpty {
            items.append(link)
        }
        if !text.isEmpty {
            items.append(text)
        }
        if items.isEmpty, !title.isEmpty {
            items.append(title)
        }
        guard !items.isEmpty else { return false }

        let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        let presenter = presentedViewController ?? self
        if let popover = activity.popoverPresentationController,
           let anchorView = presenter.view {
            popover.sourceView = anchorView
            popover.sourceRect = CGRect(
                x: anchorView.bounds.midX,
                y: anchorView.bounds.midY,
                width: 1,
                height: 1
            )
            popover.permittedArrowDirections = []
        }
        presenter.present(activity, animated: true)
        return true
    }

    func saveFile(
        filename: String,
        base64: String,
        mimeType: String,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        showToast(theme.strings.downloadPreparing, style: .progress)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let url = try DawayaFileStore.saveBase64(base64, filename: filename, mimeType: mimeType)
                DispatchQueue.main.async {
                    guard let self else { return }
                    let message = "\(self.theme.strings.downloadSaved)\n\(url.lastPathComponent)"
                    self.showToast(message, style: .success, autoHideAfter: 6)
                    completion(.success(url))
                }
            } catch {
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.showToast(self.theme.strings.downloadFailed, style: .failure, autoHideAfter: 5)
                    completion(.failure(error))
                }
            }
        }
    }

    // MARK: - Reminders

    func syncReminders(
        _ reminders: [DawayaReminder],
        language: DawayaLanguage,
        requestAuthorization: Bool,
        completion: @escaping (Bool, Int) -> Void
    ) {
        notificationService.synchronize(
            reminders: reminders,
            language: language,
            requestAuthorization: requestAuthorization,
            completion: completion
        )
    }

    // MARK: - Toasts

    private func showToast(
        _ message: String,
        style: DawayaToastView.Style,
        autoHideAfter: TimeInterval? = nil
    ) {
        toastView.show(message, style: style, autoHideAfter: autoHideAfter)
        view.bringSubviewToFront(toastView)
    }

    // MARK: - JavaScript events

    private func evaluateJS(_ script: String) {
        guard let webView = bridgeController.webView else { return }
        let run = {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
        if Thread.isMainThread {
            run()
        } else {
            DispatchQueue.main.async(execute: run)
        }
    }

    // MARK: - App lifecycle

    private func observeAppLifecycle() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func applicationDidEnterBackground() {
        if speechService.isSpeaking {
            speechService.stopForBackground()
            notifySpeech("stop")
        }
    }

    @objc private func applicationWillEnterForeground() {
        if isOfflineVisible {
            retryFromOffline(userInitiated: false)
        }
    }
}

/// The system browser view, with one control added above it: a button that hands the
/// same address to the device's default browser.
///
/// The page is still `SFSafariViewController` and stays whole — its address, its Done
/// button and everything it shows are the operating system's own, never covered by this
/// bar. Dawaya reads nothing from it: no cookies, no history, no page content. The
/// container exists so that a link can be read without losing the page it came from, and
/// so the reader can leave for their own browser in one tap when they want to.
final class DawayaBrowserViewController: UIViewController {
    private let targetURL: URL
    private let actionTitle: String
    private lazy var safari = SFSafariViewController(url: targetURL)

    init(url: URL, actionTitle: String) {
        targetURL = url
        self.actionTitle = actionTitle
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        let button = UIButton(type: .system)
        button.setTitle(actionTitle, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: #selector(openInDefaultBrowser), for: .touchUpInside)
        bar.addSubview(button)

        addChild(safari)
        safari.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(safari.view)
        view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 50),
            button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            button.trailingAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -14),
            button.centerYAnchor.constraint(equalTo: bar.bottomAnchor, constant: -25),
            safari.view.topAnchor.constraint(equalTo: bar.bottomAnchor),
            safari.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            safari.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            safari.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        safari.didMove(toParent: self)
    }

    @objc private func openInDefaultBrowser() {
        UIApplication.shared.open(targetURL)
    }
}
