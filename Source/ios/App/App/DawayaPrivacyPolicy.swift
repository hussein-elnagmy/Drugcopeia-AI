import Foundation

/// The iOS mirror of the network allowlist plus the offline-mode flag the
/// navigation gate reads.
///
/// Keep in sync with `Source/privacy.config.json` (`network.*`) — that file is
/// the single source of truth and `scripts/privacy-check.py` fails the build when
/// the two drift apart. If you change a host, a path prefix or a forbidden
/// parameter here, change it there in the same commit.
///
/// IMPORTANT — this is defence in depth, not the primary gate. A WKWebView
/// cannot filter subresource traffic (fetch/XHR/WebSocket/img/script) from a
/// navigation delegate: `decidePolicyFor navigationAction` only sees main-frame
/// and target-frame navigations, and `decidePolicyFor navigationResponse` only
/// sees their responses. The real gate is the JavaScript wrapper in
/// `webapp/net.js`, which patches `fetch`/`XMLHttpRequest` and refuses any
/// non-allowlisted target before the request is built. What this policy does is
/// close the remaining hole: a link or redirect that tries to move the app's own
/// web view onto a remote host, or to keep it there.
enum DawayaPrivacyPolicy {
    /// `network.allowedHosts` minus the loopback aliases, which are handled
    /// separately because they never leave the device.
    static let allowedHosts: Set<String> = [
        "www.who.int", "api.fda.gov", "eutils.ncbi.nlm.nih.gov",
        "commons.wikimedia.org", "thumb.wikimedia.org", "upload.wikimedia.org"
    ]

    /// `network.allowedHosts[*].pathPrefix`, keyed by host. A request to an
    /// allowlisted host is only allowed in-process under its prefix.
    static let allowedPathPrefixes: [String: [String]] = [
        "www.who.int": ["/api/hubs/newsitems", "/rss-feeds/", "/news/item/"],
        "api.fda.gov": ["/drug/enforcement.json"],
        "eutils.ncbi.nlm.nih.gov": ["/entrez/eutils/"],
        "commons.wikimedia.org": ["/w/api.php"],
        "thumb.wikimedia.org": ["/wikipedia/commons/"],
        "upload.wikimedia.org": ["/wikipedia/commons/"]
    ]

    /// The scheme each allowlisted host may be reached over.
    static let allowedSchemesByHost: [String: String] = [
        "www.who.int": "https",
        "api.fda.gov": "https",
        "eutils.ncbi.nlm.nih.gov": "https",
        "commons.wikimedia.org": "https",
        "thumb.wikimedia.org": "https",
        "upload.wikimedia.org": "https"
    ]

    /// `network.allowedHosts` entries marked `localhost: true`. Used by the
    /// Windows loopback shell and by local development only.
    static let loopbackHosts: Set<String> = ["127.0.0.1", "::1", "localhost"]

    /// `network.forbiddenUrlParameters`. A URL carrying one of these is never
    /// fetched in-process; it is handed to the external browser instead.
    static let forbiddenQueryParameters: Set<String> = [
        "utm_source", "utm_medium", "utm_campaign", "client_id", "device_id",
        "did", "imei", "android_id", "adid", "idfa", "sid", "session_id",
        "user_id", "uid", "api_key"
    ]

    /// Schemes that resolve to content already on the device. On iOS Capacitor
    /// serves the bundle from `capacitor://localhost`, so the bundled app is
    /// never an http(s) navigation and ATS does not apply to it — which is why
    /// the Info.plist needs no `NSAllowsLocalNetworking`.
    static let bundledSchemes: Set<String> = ["capacitor", "file", "about", "blob", "data"]

    /// Set from the user's Offline mode setting (see
    /// `DawayaShellViewController.setOfflineMode`). Online is the default; the
    /// setting is mirrored from the page on every launch.
    static var isOfflineMode = false

    /// True when the URL points at the app's own bundled pages.
    static func isBundled(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "capacitor" || scheme == "file" {
            return url.host == nil || url.host?.lowercased() == "localhost"
        }
        return scheme == "about" || scheme == "blob" || scheme == "data"
    }

    /// True for the http/https schemes the gate has to reason about.
    static func isHTTP(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    /// The decision used by every in-process gate: may this URL be loaded
    /// inside the app at all?
    ///
    /// When `offline` is true nothing but the bundled content is allowed — a
    /// loopback fetch is cancelled too, so "Offline mode" means literally no
    /// network activity.
    static func isAllowed(url: URL, offline: Bool = DawayaPrivacyPolicy.isOfflineMode) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if bundledSchemes.contains(scheme) { return isBundled(url) }
        guard scheme == "http" || scheme == "https" else { return false }
        guard !offline else { return false }
        guard let host = url.host?.lowercased() else { return false }

        // Loopback stays usable for the Windows shell and local development;
        // it cannot leave the device.
        if loopbackHosts.contains(host) {
            return scheme == "http"
        }

        guard allowedHosts.contains(host),
              allowedSchemesByHost[host] == scheme else { return false }
        if let prefixes = allowedPathPrefixes[host] {
            let path = url.path.isEmpty ? "/" : url.path
            guard prefixes.contains(where: { path.hasPrefix($0) }) else { return false }
        }
        return !containsForbiddenParameter(url)
    }

    static func containsForbiddenParameter(_ url: URL) -> Bool {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return false
        }
        return items.contains { forbiddenQueryParameters.contains($0.name.lowercased()) }
    }

    /// True for links the app must hand to the operating system's external
    /// browser: medicine information sources (MedlinePlus, NHS, FDA, eDa, …)
    /// that are deliberately not on the allowlist.
    static func mustOpenExternally(_ url: URL) -> Bool {
        isHTTP(url) && !isAllowed(url: url)
    }
}
