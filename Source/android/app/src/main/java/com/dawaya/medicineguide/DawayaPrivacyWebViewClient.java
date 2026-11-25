package com.dawaya.medicineguide;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Privacy gate wrapped around Capacitor's own {@code BridgeWebViewClient}, using the
 * same delegation pattern as the iOS {@code DawayaWebViewDelegateProxy}: this class
 * decides whether traffic may happen at all, then forwards everything else untouched.
 *
 * <p>Every decision comes from {@link DawayaPrivacyPolicy} (mirrored from
 * privacy.config.json). Two properties are load-bearing and must not be weakened:
 * <ul>
 *   <li>Denials never log. A blocked URL is often the user's own search term, and an
 *       Android log entry leaves the app through logcat and bug reports.</li>
 *   <li>Deny is the default for both request interception and navigation, so a bug in
 *       the web layer cannot turn into an outbound request.</li>
 * </ul>
 */
public class DawayaPrivacyWebViewClient extends WebViewClient {

    /** Body of a denied response: valid, empty JSON. It carries no URL and no reason. */
    private static final byte[] DENIED_BODY = "{}".getBytes(StandardCharsets.UTF_8);

    private final WebViewClient delegate;

    public DawayaPrivacyWebViewClient(WebViewClient delegate) {
        this.delegate = delegate;
    }

    // MARK: - Subresource and fetch traffic

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request == null) return denied();
        String[] target = resolveTarget(request.getUrl());
        if (target == null) return denied();
        // Chromium reports no gesture for a fetch() even when a real tap started it, so
        // navigations own the user-initiated rule; here the fixed method and path prefix
        // of the allowlist entry bound the one remote channel, the database update.
        if (!isAllowed(safeMethod(request), target)) return denied();
        return delegate == null ? denied() : delegate.shouldInterceptRequest(view, request);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        String[] target = resolveTarget(Uri.parse(url == null ? "" : url));
        if (target == null || !isAllowed("GET", target)) return denied();
        return delegate == null ? denied() : delegate.shouldInterceptRequest(view, url);
    }

    // MARK: - Navigation policy

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return true;
        Uri url = request.getUrl();
        String scheme = lower(url.getScheme());
        String host = lower(url.getHost());
        String path = url.getPath();

        // The app's own bundled pages and in-process resources load normally.
        if (DawayaPrivacyPolicy.isBundledOrigin(scheme, host)
            || DawayaPrivacyPolicy.isLocalScheme(scheme)
            || DawayaPrivacyPolicy.isBundledFile(scheme, path)) {
            return delegate != null && delegate.shouldOverrideUrlLoading(view, request);
        }

        if ("http".equals(scheme) || "https".equals(scheme)) {
            boolean userInitiated = request.hasGesture();
            if (DawayaPrivacyPolicy.isAllowedNavigation(scheme, host, path, userInitiated)) {
                // The allowlisted update channel stays inside the WebView; it is never a
                // page the user has to look at.
                return false;
            }
            // A source link (MedlinePlus, NHS, FDA, ...) is handed to the OS browser, and
            // only for a real tap: without a gesture it is a redirect or an injected frame
            // and must not reach anything. No identifiers are appended to the URL.
            if (userInitiated) openExternally(view, url);
            return true;
        }

        // javascript:, mailto:, tel:, intent:, and any custom app scheme: refused. The app
        // has no reason to start another app, and a mailto: body could carry the query.
        return true;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        Uri parsed = Uri.parse(url == null ? "" : url);
        String scheme = lower(parsed.getScheme());
        String host = lower(parsed.getHost());
        if (DawayaPrivacyPolicy.isBundledOrigin(scheme, host)
            || DawayaPrivacyPolicy.isLocalScheme(scheme)
            || DawayaPrivacyPolicy.isBundledFile(scheme, parsed.getPath())) {
            return delegate != null && delegate.shouldOverrideUrlLoading(view, url);
        }
        // This overload carries no gesture information at all, so nothing is ever handed to
        // a browser from here; only the allowlisted update host may load.
        return !(("http".equals(scheme) || "https".equals(scheme))
            && DawayaPrivacyPolicy.isAllowedNavigation(scheme, host, parsed.getPath(), false));
    }

    // MARK: - Untouched Capacitor behaviour, forwarded as-is

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        if (delegate != null) delegate.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        if (delegate != null) delegate.onPageFinished(view, url);
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        if (delegate != null) delegate.onPageCommitVisible(view, url);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (delegate != null) delegate.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (delegate != null) delegate.onReceivedHttpError(view, request, errorResponse);
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        return delegate != null && delegate.onRenderProcessGone(view, detail);
    }

    // MARK: - Helpers

    /**
     * The {scheme, host, path} a request really targets, or null when it is refused.
     * CapacitorHttp hides a remote URL behind the app origin, so that wrapper is unwrapped
     * and re-checked; a URL carrying a tracking or identity parameter is refused outright.
     */
    private static String[] resolveTarget(Uri url) {
        if (url == null) return null;
        String scheme = lower(url.getScheme());
        String host = lower(url.getHost());
        String path = url.getPath();
        if (scheme == null) return null;
        if (DawayaPrivacyPolicy.isProxiedPath(path)) {
            String wrapped = url.getQueryParameter(DawayaPrivacyPolicy.PROXY_URL_PARAM);
            if (wrapped == null) return null;
            Uri target = Uri.parse(wrapped);
            String targetScheme = lower(target.getScheme());
            String targetHost = lower(target.getHost());
            if (targetScheme == null || targetHost == null || targetHost.isEmpty()) return null;
            return new String[] { targetScheme, targetHost, target.getPath() };
        }
        if (DawayaPrivacyPolicy.isLocalScheme(scheme)) {
            // data:, blob:, about: resolve inside the process and never open a socket.
            return new String[] { scheme, "", path };
        }
        if (DawayaPrivacyPolicy.isBundledFile(scheme, path)) {
            return new String[] { scheme, "", path };
        }
        if (DawayaPrivacyPolicy.hasForbiddenParameter(url.toString())) return null;
        return new String[] { scheme, host == null ? "" : host, path };
    }

    /** Local resources stay allowed; anything else must match the http(s) allowlist. */
    private static boolean isAllowed(String method, String[] target) {
        if (DawayaPrivacyPolicy.isLocalScheme(target[0]) || "file".equals(target[0])) return true;
        return DawayaPrivacyPolicy.isAllowedRequest(method, target[0], target[1], target[2], true);
    }

    private static String safeMethod(WebResourceRequest request) {
        String method = request.getMethod();
        return method == null ? "GET" : method;
    }

    /**
     * 403 with an empty JSON body: no URL, no reason phrase echoing what the user typed,
     * and no headers that could be used to correlate a session.
     */
    private static WebResourceResponse denied() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
            "application/json",
            "utf-8",
            403,
            "Forbidden",
            headers,
            new ByteArrayInputStream(DENIED_BODY)
        );
    }

    /** Hands a link to the operating system's browser: ACTION_VIEW, data only, no extras. */
    private static void openExternally(WebView view, Uri url) {
        Context context = view == null ? null : view.getContext();
        if (context == null) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // No browser on the device: the tap does nothing. The app must not fall back
            // to fetching the page in-process.
        } catch (SecurityException ignored) {
            // A locked-down OEM build refused the handoff; the same reasoning applies.
        }
    }

    private static String lower(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.US);
    }
}
