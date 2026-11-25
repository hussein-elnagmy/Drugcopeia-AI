import Capacitor
import UIKit
import WebKit

/// Capacitor's web view controller, tuned for an edge-to-edge native shell.
/// It also installs the delegate proxy (downloads and file uploads) and
/// registers the `DawayaShell` plugin before the page loads.
final class DawayaBridgeViewController: CAPBridgeViewController {
    weak var shell: DawayaShellViewController?
    private(set) var downloadHandler: DawayaDownloadHandler?
    private var delegateProxy: DawayaWebViewDelegateProxy?
    private var shellPlugin: DawayaShellPlugin?

    init() {
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("Use init()")
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // Explicitly use the persistent store so cookies, localStorage and the
        // cached drug dataset survive relaunches.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        return configuration
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        // Rubber-banding translates the whole rendered page, which drags the
        // fixed bottom nav off its slot and dismisses the keyboard mid-search.
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.keyboardDismissMode = .none
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        return webView
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Re-assert on every layout: WebKit has re-enabled bouncing after a
        // load in the past, and a bouncing scroll view translates the page.
        guard let scrollView = webView?.scrollView else { return }
        scrollView.bounces = false
        scrollView.alwaysBounceVertical = false
        scrollView.alwaysBounceHorizontal = false
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        guard let capacitorBridge = bridge as? CapacitorBridge,
              let webView = webView else {
            return
        }

        let proxy = DawayaWebViewDelegateProxy(
            handler: capacitorBridge.webViewDelegationHandler,
            shell: shell
        )
        delegateProxy = proxy
        downloadHandler = proxy.downloadHandler
        webView.navigationDelegate = proxy
        webView.uiDelegate = proxy

        let plugin = DawayaShellPlugin()
        plugin.shell = shell
        capacitorBridge.registerPluginInstance(plugin)
        shellPlugin = plugin

        /* The on-device assistant runtime is a second plugin: JS detects it as
           Capacitor.Plugins.DawayaLLM and streams tokens through the same hub. */
        capacitorBridge.registerPluginInstance(DawayaLLMPlugin())

        shell?.configureDownloadHandler(proxy.downloadHandler)
    }
}
