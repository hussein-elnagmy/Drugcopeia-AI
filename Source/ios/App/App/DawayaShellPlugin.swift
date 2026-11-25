import AVFoundation
import Capacitor
import Foundation
import Speech
import UIKit

/// JS bridge exposed as `Capacitor.Plugins.DawayaShell`. Every method is a
/// promise so `ios-shell.js` can await native work; expected failures resolve
/// with `{ ok: false }` instead of rejecting, which keeps the web UI in control
/// of the message it shows.
///
/// Nothing here may take user-entered health content off the device: there is
/// no remote search and no in-app remote browser. The camera and the microphone
/// open only on an explicit tap, and both feeds are consumed by the system
/// frameworks on this device (AVFoundation barcodes, SFSpeechRecognizer).
@objc(DawayaShellPlugin)
final class DawayaShellPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "DawayaShellPlugin"
    let jsName = "DawayaShell"

    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: "promise"),
        CAPPluginMethod(name: "setAppearance", returnType: "promise"),
        CAPPluginMethod(name: "speak", returnType: "promise"),
        CAPPluginMethod(name: "stopSpeaking", returnType: "promise"),
        CAPPluginMethod(name: "share", returnType: "promise"),
        CAPPluginMethod(name: "syncReminders", returnType: "promise"),
        CAPPluginMethod(name: "saveFile", returnType: "promise"),
        CAPPluginMethod(name: "presentDrugDetail", returnType: "promise"),
        CAPPluginMethod(name: "presentWebPage", returnType: "promise"),
        CAPPluginMethod(name: "presentInAppBrowser", returnType: "promise"),
        CAPPluginMethod(name: "openMail", returnType: "promise"),
        CAPPluginMethod(name: "secureAvailable", returnType: "promise"),
        CAPPluginMethod(name: "secureRead", returnType: "promise"),
        CAPPluginMethod(name: "secureWrite", returnType: "promise"),
        CAPPluginMethod(name: "secureClear", returnType: "promise"),
        CAPPluginMethod(name: "secureClearAll", returnType: "promise"),
        CAPPluginMethod(name: "setOfflineMode", returnType: "promise"),
        CAPPluginMethod(name: "scanCode", returnType: "promise"),
        CAPPluginMethod(name: "readPhoto", returnType: "promise"),
        CAPPluginMethod(name: "startVoiceSearch", returnType: "promise"),
        CAPPluginMethod(name: "stopVoiceSearch", returnType: "promise")
    ]

    weak var shell: DawayaShellViewController?
    private var voiceSearch: DawayaVoiceSearch?

    // Capacitor invokes plugin methods on a background queue, so every call
    // that reaches UIKit has to be hopped onto the main thread first.
    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    // MARK: - Lifecycle and appearance

    @objc func ready(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.shell?.handleWebReady()
            call.resolve()
        }
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        let preference = call.getString("preference", "system")
        let language = call.getString("language", "en")
        onMain { [weak self] in
            self?.shell?.applyAppearance(preference: preference, languageCode: language)
            call.resolve()
        }
    }

    // MARK: - Text to speech

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text", "")
        let language = call.getString("lang", "en-US")
        let rate = call.getFloat("rate", 0.95)
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["ok": false])
                return
            }
            call.resolve(["ok": shell.speak(text: text, language: language, rate: rate)])
        }
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.shell?.stopSpeaking()
            call.resolve()
        }
    }

    // MARK: - Sharing

    @objc func share(_ call: CAPPluginCall) {
        let title = call.getString("title", "")
        let text = call.getString("text", "")
        let url = call.getString("url", "")
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.reject("The native shell is unavailable.", "UNAVAILABLE")
                return
            }
            let presented = shell.presentShare(title: title, text: text, url: url)
            if presented {
                call.resolve(["presented": true])
            } else {
                call.reject("There is nothing to share.", "EMPTY_SHARE")
            }
        }
    }

    // MARK: - Reminders

    @objc func syncReminders(_ call: CAPPluginCall) {
        let payloads = call.getArray("reminders")?.compactMap { $0 as? [String: Any] } ?? []
        let reminders = payloads.compactMap(DawayaReminder.init(payload:))
        let language = DawayaLanguage(code: call.getString("language", "en"))
        let requestAuthorization = call.getBool("requestAuthorization", false)

        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["authorized": false, "scheduled": 0])
                return
            }
            shell.syncReminders(
                reminders,
                language: language,
                requestAuthorization: requestAuthorization
            ) { authorized, scheduled in
                call.resolve([
                    "authorized": authorized,
                    "scheduled": scheduled,
                    "supported": true
                ])
            }
        }
    }

    // MARK: - Native drug detail

    @objc func presentDrugDetail(_ call: CAPPluginCall) {
        let payload = call.getObject("drug") ?? [:]
        guard let detail = DrugDetail(payload: payload) else {
            call.resolve(["presented": false, "error": "invalid-payload"])
            return
        }
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["presented": false, "error": "unavailable"])
                return
            }
            call.resolve(["presented": shell.presentDrugDetail(detail)])
        }
    }

    // MARK: - Links and email

    /// Opens a link. Remote pages are never rendered inside the app: anything
    /// that is not the app's own bundled content is handed to the operating
    /// system's external browser, and with Offline mode on nothing opens at all.
    /// See `DawayaShellViewController.openLink`.
    @objc func presentWebPage(_ call: CAPPluginCall) {
        let raw = call.getString("url", "")
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" || scheme == "capacitor" || scheme == "file" else {
            call.resolve(["presented": false, "target": "blocked", "error": "invalid-url"])
            return
        }
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["presented": false, "target": "blocked", "error": "unavailable"])
                return
            }
            shell.openLink(url) { presented, target in
                call.resolve(["presented": presented, "target": target])
            }
        }
    }

    /// Opens a link on an explicit user tap in a browser view over the app.
    ///
    /// Used for every link the reader taps — news, a reference, a source citation, a pack
    /// photograph — so the page they came from stays underneath. `DawayaShellViewController
    /// .presentInAppBrowser` explains why these screens are allowed to leave the app's own
    /// content and how the address is handed to the device's browser.
    @objc func presentInAppBrowser(_ call: CAPPluginCall) {
        let raw = call.getString("url", "")
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            call.resolve(["presented": false, "target": "blocked", "error": "invalid-url"])
            return
        }
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["presented": false, "target": "blocked", "error": "unavailable"])
                return
            }
            shell.presentInAppBrowser(url) { presented, target in
                call.resolve(["presented": presented, "target": target])
            }
        }
    }

    /// Opens the user's mail app with a `mailto:` link, or copies the message if
    /// no mail account is configured. There is deliberately no web fallback:
    /// putting the body into a `mail.google.com` URL would send the message,
    /// the recipient and whatever health details it holds to Google.
    @objc func openMail(_ call: CAPPluginCall) {
        let recipient = call.getString("to", "")
        let subject = call.getString("subject", "")
        let body = call.getString("body", "")
        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.resolve(["opened": false, "copied": false])
                return
            }
            shell.openMail(to: recipient, subject: subject, body: body) { opened, copied in
                call.resolve(["opened": opened, "copied": copied])
            }
        }
    }

    // MARK: - Secure storage

    @objc func secureAvailable(_ call: CAPPluginCall) {
        onMain {
            call.resolve(["available": DawayaSecureStore.isAvailable, "backend": "ios-keychain"])
        }
    }

    @objc func secureRead(_ call: CAPPluginCall) {
        let key = call.getString("key", "")
        guard DawayaSecureStore.allows(key) else {
            call.reject("This key may not be read from the secure store.", "KEY_NOT_ALLOWED")
            return
        }
        onMain {
            do {
                let stored = try DawayaSecureStore.read(key)
                // An empty string means "nothing stored for this key".
                call.resolve(["value": stored ?? ""])
            } catch {
                call.reject("The secure store could not be read.", "SECURE_READ_FAILED", error)
            }
        }
    }

    @objc func secureWrite(_ call: CAPPluginCall) {
        let key = call.getString("key", "")
        let value = call.getString("value", "")
        guard DawayaSecureStore.allows(key) else {
            call.reject("This key may not be stored in the secure store.", "KEY_NOT_ALLOWED")
            return
        }
        onMain {
            do {
                try DawayaSecureStore.write(key, value: value)
                call.resolve(["stored": true])
            } catch {
                call.reject("The secure store could not be written.", "SECURE_WRITE_FAILED", error)
            }
        }
    }

    @objc func secureClear(_ call: CAPPluginCall) {
        let key = call.getString("key", "")
        guard DawayaSecureStore.allows(key) else {
            call.reject("This key may not be cleared from the secure store.", "KEY_NOT_ALLOWED")
            return
        }
        onMain {
            do {
                try DawayaSecureStore.clear(key)
                call.resolve(["cleared": true])
            } catch {
                call.reject("The secure store could not be cleared.", "SECURE_CLEAR_FAILED", error)
            }
        }
    }

    @objc func secureClearAll(_ call: CAPPluginCall) {
        onMain {
            do {
                try DawayaSecureStore.clearAll()
                call.resolve(["cleared": true])
            } catch {
                call.reject("The secure store could not be cleared.", "SECURE_CLEAR_FAILED", error)
            }
        }
    }

    // MARK: - Offline mode

    /// The user's Offline mode switch. Flips the navigation gate and the
    /// offline layer; the web app persists the setting itself.
    // MARK: - Box-code scanning

    @objc func scanCode(_ call: CAPPluginCall) {
        let language = call.getString("language", "en") == "ar" ? "ar" : "en"
        onMain { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.resolve(["error": "unavailable"])
                return
            }
            DawayaCodeScanner.present(from: presenter, language: language) { outcome in
                switch outcome {
                case .code(let value):
                    call.resolve(["code": value])
                case .cancelled:
                    call.resolve(["cancelled": true])
                case .permissionDenied:
                    call.resolve(["error": "permission"])
                case .unavailable:
                    call.resolve(["error": "unavailable"])
                }
            }
        }
    }

    // MARK: - Pack photographs

    /// Reads a photograph the page already holds: the barcode printed on the pack and
    /// the words around it. The picture stays in this process for the length of the
    /// call - Vision runs on the device and nothing is uploaded or written.
    @objc func readPhoto(_ call: CAPPluginCall) {
        let base64 = call.getString("image", "") ?? ""
        guard let picture = Data(base64Encoded: base64) else {
            call.resolve(["error": "image-decode-failed", "codes": [], "text": ""])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let read = PhotoReader.read(data: picture)
            DispatchQueue.main.async(execute: { call.resolve(read) })
        }
    }

    // MARK: - Voice search

    @objc func startVoiceSearch(_ call: CAPPluginCall) {
        let language = call.getString("language", "en-US") ?? "en-US"
        onMain { [weak self] in
            guard let self, let shell = self.shell else {
                call.resolve(["error": "unavailable"])
                return
            }
            self.voiceSearch?.stop(cancel: true)
            let voice = DawayaVoiceSearch(language: language) { text in
                shell.emitVoiceEvent(["type": "partial", "text": text])
            }
            self.voiceSearch = voice
            voice.start { [weak self] result in
                self?.voiceSearch = nil
                call.resolve(result)
            }
        }
    }

    @objc func stopVoiceSearch(_ call: CAPPluginCall) {
        onMain { [weak self] in
            self?.voiceSearch?.stop(cancel: true)
            self?.voiceSearch = nil
            call.resolve(["stopped": true])
        }
    }

    @objc func setOfflineMode(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled", true)
        onMain { [weak self] in
            self?.shell?.setOfflineMode(enabled)
            call.resolve(["applied": true])
        }
    }

    // MARK: - Files

    @objc func saveFile(_ call: CAPPluginCall) {
        let filename = call.getString("filename", "Dawaya file")
        let base64 = call.getString("base64", "")
        let mimeType = call.getString("mimeType", "application/octet-stream")

        onMain { [weak self] in
            guard let shell = self?.shell else {
                call.reject("The native shell is unavailable.", "UNAVAILABLE")
                return
            }
            shell.saveFile(filename: filename, base64: base64, mimeType: mimeType) { result in
                switch result {
                case .success(let url):
                    call.resolve(["saved": true, "filename": url.lastPathComponent])
                case .failure(let error):
                    call.reject("The file could not be saved.", "SAVE_FAILED", error)
                }
            }
        }
    }
}

// MARK: - Box-code scanner

/// A full-screen camera sheet that reads a barcode or QR code and resolves with
/// the first value it sees. The frames never leave AVFoundation: the metadata
/// output decodes them in-process and the session stops as soon as a code is
/// read. There is no gallery import and no frame capture.
final class DawayaCodeScanner: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    enum Outcome {
        case code(String)
        case cancelled
        case permissionDenied
        case unavailable
    }

    private static var active: DawayaCodeScanner?

    private let language: String
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.dawaya.scan")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var completion: ((Outcome) -> Void)?
    private var delivered = false

    private let titleLabel = UILabel()
    private let helpLabel = UILabel()
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let closeButton = UIButton(type: .system)
    private let reticle = UIView()

    static func present(
        from presenter: UIViewController,
        language: String,
        completion: @escaping (Outcome) -> Void
    ) {
        guard active == nil, presenter.presentedViewController == nil else {
            completion(.unavailable)
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            show(from: presenter, language: language, completion: completion)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        show(from: presenter, language: language, completion: completion)
                    } else {
                        completion(.permissionDenied)
                    }
                }
            }
        default:
            completion(.permissionDenied)
        }
    }

    private static func show(
        from presenter: UIViewController,
        language: String,
        completion: @escaping (Outcome) -> Void
    ) {
        guard presenter.view.window != nil else {
            completion(.unavailable)
            return
        }
        let scanner = DawayaCodeScanner(language: language, completion: completion)
        active = scanner
        scanner.modalPresentationStyle = .fullScreen
        presenter.present(scanner, animated: true)
    }

    private init(language: String, completion: @escaping (Outcome) -> Void) {
        self.language = language
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let arabic = language == "ar"

        titleLabel.text = arabic ? "امسح كود العلبة" : "Scan a box code"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        titleLabel.numberOfLines = 0

        helpLabel.text = arabic
            ? "ضع الباركود أو رمز QR داخل الإطار. تُقرأ الأكواد على هذا الجهاز."
            : "Hold the barcode or QR code inside the frame. Codes are read on this device."
        helpLabel.textColor = UIColor.white.withAlphaComponent(0.85)
        helpLabel.font = .systemFont(ofSize: 14)
        helpLabel.numberOfLines = 0
        helpLabel.textAlignment = .center

        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 15, weight: .medium)
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.isHidden = true

        spinner.color = .white
        spinner.startAnimating()

        closeButton.setTitle(arabic ? "إغلاق" : "Close", for: .normal)
        closeButton.setTitleColor(.white, for: .normal)
        closeButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        reticle.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        reticle.layer.borderWidth = 2
        reticle.layer.cornerRadius = 16
        reticle.isUserInteractionEnabled = false

        [titleLabel, helpLabel, statusLabel, spinner, closeButton, reticle].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: guide.topAnchor, constant: 18),
            titleLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -12),

            closeButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
            closeButton.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),

            reticle.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -24),
            reticle.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.82),
            reticle.heightAnchor.constraint(equalTo: reticle.widthAnchor, multiplier: 0.62),

            helpLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            helpLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            helpLabel.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -26),

            statusLabel.leadingAnchor.constraint(equalTo: helpLabel.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: helpLabel.trailingAnchor),
            statusLabel.bottomAnchor.constraint(equalTo: helpLabel.topAnchor, constant: -10),

            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopSession()
    }

    override var prefersStatusBarHidden: Bool { true }

    @objc private func closeTapped() {
        finish(.cancelled)
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device)
        else {
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
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
        spinner.stopAnimating()
        statusLabel.isHidden = true
        sessionQueue.async { [weak self] in
            self?.session.startRunning()
        }
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
        let done = completion
        completion = nil
        stopSession()
        DawayaCodeScanner.active = nil
        dismiss(animated: true) {
            done?(outcome)
        }
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
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            finish(.code(value))
            return
        }
    }
}

// MARK: - Voice search

/// Wraps SFSpeechRecognizer for one search phrase. Recognition and the audio
/// engine stop on the first final result, on a timeout, or when the page calls
/// stopVoiceSearch; a single completion carries the text or the reason.
final class DawayaVoiceSearch {
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
        let requested = Locale(identifier: language)
        if let direct = SFSpeechRecognizer(locale: requested) {
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
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
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
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

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
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let done = completion
        completion = nil
        onPartial = nil
        DispatchQueue.main.async { done?(payload) }
    }
}
