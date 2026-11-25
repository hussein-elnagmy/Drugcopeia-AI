import Capacitor
import UIKit
import UniformTypeIdentifiers
import WebKit

/// WKWebView delegate proxy.
///
/// Capacitor installs its own navigation/UI delegate, but it does not implement
/// downloads. This proxy forwards every unhandled delegate message to Capacitor
/// and adds downloads on top.
///
/// It is also the native navigation gate: any http(s) navigation that is not the
/// app's own bundled page and not on the privacy allowlist is cancelled and
/// handed to the operating system's external browser.
///
/// Honest limitation — a `WKNavigationDelegate` only sees main-frame and
/// target-frame *navigations*. It cannot see or block subresource traffic
/// (fetch, XHR, WebSocket, img, script, iframe src), because WebKit does not
/// route those through `decidePolicyFor`. The primary gate therefore has to stay
/// in JavaScript — `webapp/net.js` wraps `fetch`/`XMLHttpRequest` and refuses
/// every non-allowlisted target before a request exists. What happens here is
/// defence in depth against navigations and redirects, not the whole story.
final class DawayaWebViewDelegateProxy: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var handler: WebViewDelegationHandler?
    private weak var shell: DawayaShellViewController?
    let downloadHandler = DawayaDownloadHandler()

    init(handler: WebViewDelegationHandler, shell: DawayaShellViewController?) {
        self.handler = handler
        self.shell = shell
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return handler?.responds(to: aSelector) ?? false
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let handler, handler.responds(to: aSelector) {
            return handler
        }
        return super.forwardingTarget(for: aSelector)
    }

    // MARK: - Navigation policy

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased() else {
            handler?.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
            return
        }

        if Self.externalSchemes.contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        // The privacy gate. `capacitor://`, `file://`, `blob:` and `data:` are the
        // app's own bundled content; loopback and the allowlist may load in
        // process. Everything else is refused inside the web view and, unless the
        // user turned Offline mode on, opened in the external browser they chose.
        // A download is checked here too: saving a remote file would pull it into
        // our sandbox and name it in a request we are not supposed to make.
        if DawayaPrivacyPolicy.isHTTP(url), !DawayaPrivacyPolicy.isAllowed(url: url) {
            decisionHandler(.cancel)
            // A source link goes to the browser the user chose, not to our web view.
            // Offline mode governs this app's own traffic; the handoff itself makes no
            // request from Dawaya. Without a real tap (redirect, injected frame) nothing
            // is opened at all.
            if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
            }
            return
        }

        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }

        handler?.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // A redirect can land on a host the navigation policy never saw, so the
        // response gets the same allowlist check before anything is rendered.
        if let responseURL = navigationResponse.response.url,
           DawayaPrivacyPolicy.isHTTP(responseURL),
           !DawayaPrivacyPolicy.isAllowed(url: responseURL) {
            decisionHandler(.cancel)
            return
        }

        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().contains("attachment") {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: - Downloads

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = downloadHandler
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = downloadHandler
    }

    // MARK: - Load lifecycle

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        handler?.webView(webView, didStartProvisionalNavigation: navigation)
        shell?.webViewDidStartLoading()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        handler?.webView(webView, didFinish: navigation)
        shell?.webViewDidFinishLoading()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handler?.webView(webView, didFail: navigation, withError: error)
        shell?.webViewDidFail(with: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handler?.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
        shell?.webViewDidFail(with: error)
    }

    /// Only the two schemes the feedback/support links need. Everything else is
    /// refused: another app is never started from a URL this page did not author.
    private static let externalSchemes: Set<String> = [
        "mailto", "tel"
    ]
}

/// Saves WKWebView downloads into `Documents/Downloads`. That folder lives in
/// the app's own sandbox: with file sharing disabled it is not browsable from
/// the Files app, so the in-app export/share flow is how the user hands a file
/// to someone else.
final class DawayaDownloadHandler: NSObject, WKDownloadDelegate {
    var onStart: (() -> Void)?
    var onFinish: ((URL) -> Void)?
    var onFailure: (() -> Void)?

    private var destinations: [ObjectIdentifier: URL] = [:]

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        var filename = suggestedFilename
        if (filename as NSString).pathExtension.isEmpty,
           let mime = response.mimeType,
           let type = UTType(mimeType: mime),
           let preferred = type.preferredFilenameExtension {
            filename += ".\(preferred)"
        }

        let directory = DawayaFileStore.downloadsDirectory
        guard FileManager.default.isWritableFile(atPath: directory.path) else {
            completionHandler(nil)
            return
        }

        let destination = DawayaFileStore.uniqueURL(filename: filename, in: directory)
        destinations[ObjectIdentifier(download)] = destination
        DispatchQueue.main.async { [weak self] in
            self?.onStart?()
        }
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let destination = destinations.removeValue(forKey: ObjectIdentifier(download))
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let destination {
                self.onFinish?(destination)
            } else {
                self.onFailure?()
            }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        DispatchQueue.main.async { [weak self] in
            self?.onFailure?()
        }
    }
}
