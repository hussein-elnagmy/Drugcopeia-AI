import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

/// JS bridge exposed as `Capacitor.Plugins.DawayaLLM`.
///
/// The assistant's JavaScript detects this plugin through the normal Capacitor
/// plugin registry; every call mirrors the contract in `webapp/ai/llm-bridge.js`.
/// Model bytes never cross into JavaScript: downloads and imports are handled by
/// `LlamaModelDownloader`, generation by `LlamaEngine`. Tokens are pushed back as
/// `window.__dawayaLLMEvent` calls on the same request id the pipeline supplied.
@objc(DawayaLLMPlugin)
final class DawayaLLMPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "DawayaLLMPlugin"
    let jsName = "DawayaLLM"

    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: "promise"),
        CAPPluginMethod(name: "status", returnType: "promise"),
        CAPPluginMethod(name: "download", returnType: "promise"),
        CAPPluginMethod(name: "pauseDownload", returnType: "promise"),
        CAPPluginMethod(name: "resumeDownload", returnType: "promise"),
        CAPPluginMethod(name: "cancelDownload", returnType: "promise"),
        CAPPluginMethod(name: "verifyDownload", returnType: "promise"),
        CAPPluginMethod(name: "importModel", returnType: "promise"),
        CAPPluginMethod(name: "deleteModel", returnType: "promise"),
        CAPPluginMethod(name: "load", returnType: "promise"),
        CAPPluginMethod(name: "unload", returnType: "promise"),
        CAPPluginMethod(name: "generate", returnType: "promise"),
        CAPPluginMethod(name: "cancelGeneration", returnType: "promise")
    ]

    private var pendingImport: CAPPluginCall?

    /// Tokens are pooled and pushed on a beat instead of one web view call each.
    private var tokenBuffer = ""
    private var tokenRequest = ""
    private var tokenFlushQueued = false
    private static let tokenFlushInterval = 0.05

    /// The checksum pinned in the model config; the same value native verification uses.
    private static let modelConfigSha: String = {
        guard let url = Bundle.main.url(forResource: "model-config", withExtension: "json", subdirectory: "public/assets/ai"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let model = json["model"] as? [String: Any],
              let sha = model["sha256"] as? String else {
            return ""
        }
        return sha
    }()

    // MARK: - Capabilities and model state

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve(LlamaEngine.shared.capabilities())
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(LlamaEngine.shared.status())
    }

    // MARK: - Download lifecycle

    @objc func download(_ call: CAPPluginCall) {
        var options: [String: Any] = [:]
        for (key, value) in call.options {
            if let name = key as? String { options[name] = value }
        }
        do {
            let id = try LlamaModelDownloader.shared.start(options: options) { [weak self] event in
                self?.emit(event)
            }
            call.resolve(["id": id])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func pauseDownload(_ call: CAPPluginCall) {
        LlamaModelDownloader.shared.pause()
        call.resolve(["ok": true])
    }

    @objc func resumeDownload(_ call: CAPPluginCall) {
        do {
            let id = try LlamaModelDownloader.shared.resume()
            call.resolve(["id": id])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        LlamaModelDownloader.shared.cancel()
        call.resolve(["ok": true])
    }

    @objc func verifyDownload(_ call: CAPPluginCall) {
        call.resolve(LlamaEngine.shared.verify(sha: Self.modelConfigSha))
    }

    @objc func importModel(_ call: CAPPluginCall) {
        guard let controller = bridge?.viewController else {
            call.reject("no-view-controller")
            return
        }
        let types: [UTType] = [UTType(filenameExtension: "gguf") ?? .data]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        pendingImport = call
        DispatchQueue.main.async {
            controller.present(picker, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingImport else { return }
        pendingImport = nil
        guard let url = urls.first else {
            call.resolve(["ok": false, "error": "cancelled"])
            return
        }
        call.resolve(LlamaEngine.shared.importCopy(from: url, expectingSha: Self.modelConfigSha))
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingImport?.resolve(["ok": false, "error": "cancelled"])
        pendingImport = nil
    }

    @objc func deleteModel(_ call: CAPPluginCall) {
        LlamaModelDownloader.shared.cancel()
        call.resolve(LlamaEngine.shared.deleteModel())
    }

    // MARK: - Load and generation

    @objc func load(_ call: CAPPluginCall) {
        let params = call.options["params"] as? [String: Any]
        call.resolve(LlamaEngine.shared.load(params: params))
    }

    @objc func unload(_ call: CAPPluginCall) {
        LlamaEngine.shared.unload()
        call.resolve(["ok": true])
    }

    @objc func generate(_ call: CAPPluginCall) {
        let requestId = call.getString("requestId") ?? "r\(Int(Date().timeIntervalSince1970))"
        let prompt = call.getString("prompt") ?? ""
        let params = LlamaGenerationParams(call.options["params"] as? [String: Any])
        /* Generation blocks until the stop token: keep it off the bridge queue. */
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = LlamaEngine.shared.generate(requestId: requestId, prompt: prompt, params: params) { piece in
                self?.emitToken(requestId: requestId, piece: piece)
            }
            guard let self else {
                call.resolve(result)
                return
            }
            DispatchQueue.main.async {
                self.flushTokens()
                call.resolve(result)
            }
        }
    }

    @objc func cancelGeneration(_ call: CAPPluginCall) {
        LlamaEngine.shared.cancel(requestId: call.getString("requestId"))
        call.resolve(["ok": true])
    }

    // MARK: - Token and progress events

    /// A word at a time is what the reader should see, but a web view call per token
    /// costs more than the token itself on a small phone, so pieces pile up in the
    /// buffer and one call carries whatever arrived since the last beat.
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
        emit(["type": "token", "requestId": tokenRequest, "token": piece])
    }

    private func emit(_ event: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.evaluateJavaScript(
                "window.__dawayaLLMEvent && window.__dawayaLLMEvent(\(json));",
                completionHandler: nil
            )
        }
    }
}
