package com.dawaya.medicineguide;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The Android mirror of {@code Source/privacy.config.json}. That JSON file is the
 * single source of truth; {@code scripts/privacy-check.py} asserts in the build that the
 * hosts, schemes, path prefixes, methods and purposes declared there are exactly the
 * ALLOWED_HOSTS constants below, and that SECURE_ONLY_KEYS / PLAINTEXT_ALLOWED_KEYS match
 * {@code storage.localUserDataKeys} / {@code storage.plaintextAllowedKeys}. Editing one
 * side without the other fails the build gate, so never widen this list casually: every
 * entry is a promise that a request can leave the device.
 *
 * <p>Rules encoded here:
 * <ul>
 *   <li>Default deny. No host is reachable unless it appears in ALLOWED_HOSTS.</li>
 *   <li>Health content the user entered only ever goes to the keystore-backed secure
 *       store (SECURE_ONLY_KEYS), never to plaintext storage.</li>
 *   <li>Source links (MedlinePlus, NHS, FDA, WHO, eDa, ...) are deliberately NOT here:
 *       they are handed to the operating system's browser on a user tap and the app
 *       must never fetch them in-process.</li>
 * </ul>
 */
public final class DawayaPrivacyPolicy {

    /** One network exception, copied field by field from privacy.config.json. */
    public static final class AllowedHost {
        public final String host;
        public final String scheme;
        /** Empty means any path; otherwise the request path must start with one of these. */
        public final List<String> pathPrefixes;
        /** Loopback hosts never reach a network; they exist for the Windows shell. */
        public final boolean loopback;
        /** Only a request the user started from Settings may use this entry. */
        public final boolean userInitiatedOnly;
        public final List<String> methods;
        public final String purpose;

        private AllowedHost(
            String host,
            String scheme,
            List<String> pathPrefixes,
            boolean loopback,
            boolean userInitiatedOnly,
            List<String> methods,
            String purpose
        ) {
            this.host = host;
            this.scheme = scheme;
            this.pathPrefixes = Collections.unmodifiableList(pathPrefixes);
            this.loopback = loopback;
            this.userInitiatedOnly = userInitiatedOnly;
            this.methods = Collections.unmodifiableList(methods);
            this.purpose = purpose;
        }
    }

    /** privacy.config.json -> network.allowedHosts, in the same order. */
    public static final List<AllowedHost> ALLOWED_HOSTS = Collections.unmodifiableList(Arrays.asList(
        new AllowedHost(
            "www.who.int",
            "https",
            Arrays.asList("/api/hubs/newsitems", "/rss-feeds/", "/news/item/"),
            false,
            false,
            Arrays.asList("GET"),
            "Headline update for the home news list. Read-only GET the app runs itself: once when the home page opens, then at most every six hours while it is in the foreground, and never in offline mode."
        ),
        new AllowedHost(
            "api.fda.gov",
            "https",
            Arrays.asList("/drug/enforcement.json"),
            false,
            false,
            Arrays.asList("GET"),
            "FDA drug enforcement reports for the news list. Read-only GET on the same news schedule, fixed date range, no identifiers."
        ),
        new AllowedHost(
            "eutils.ncbi.nlm.nih.gov",
            "https",
            Arrays.asList("/entrez/eutils/"),
            false,
            false,
            Arrays.asList("GET"),
            "PubMed search and abstract fetch for the news list. Read-only GET on the same news schedule, fixed query text, no identifiers."
        ),
        new AllowedHost(
            "commons.wikimedia.org",
            "https",
            Arrays.asList("/w/api.php"),
            false,
            true,
            Arrays.asList("GET"),
            "The medicine page \"Photos\" search, only after the reader presses Show photos. Carries the product trade name and nothing else."
        ),
        new AllowedHost(
            "thumb.wikimedia.org",
            "https",
            Arrays.asList("/wikipedia/commons/"),
            false,
            true,
            Arrays.asList("GET"),
            "The small previews in the \"Photos\" grid, fetched only after the reader pressed Show photos."
        ),
        new AllowedHost(
            "upload.wikimedia.org",
            "https",
            Arrays.asList("/wikipedia/commons/"),
            false,
            true,
            Arrays.asList("GET"),
            "The full-size file shown in the \"Photos\" modal, fetched only when the reader taps a preview."
        ),
        new AllowedHost(
            "127.0.0.1",
            "http",
            Collections.<String>emptyList(),
            true,
            false,
            Arrays.asList("GET"),
            "Loopback shell server used only by the Windows build to serve the bundled app. Never leaves the device."
        ),
        new AllowedHost(
            "localhost",
            "http",
            Collections.<String>emptyList(),
            true,
            false,
            Arrays.asList("GET"),
            "Loopback alias of the Windows/development shell server. Never leaves the device."
        )
    ));

    /**
     * The origin the WebView itself is served from on Android. Capacitor mounts the
     * bundled {@code public/} assets at {@code https://localhost}; it is a filesystem
     * read, not a network call, which is why the JSON lists only the http loopback
     * entries. Requests to these hosts over http or https are local asset reads.
     */
    private static final Set<String> BUNDLED_ORIGIN_HOSTS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("localhost", "127.0.0.1"))
    );

    /** privacy.config.json -> storage.localUserDataKeys: user-entered content, app-private. */
    public static final Set<String> SECURE_ONLY_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "dawaya-reminders-v1",
        "dawaya-reminder-taken-v1",
        "dawaya-custom-drugs-v1",
        "dawaya-ai-chat-v1",
        "dawaya-calc-history",
        "dawaya-study-stats"
    )));

    /** privacy.config.json -> storage.plaintextAllowedKeys: UI settings, nothing typed. */
    public static final Set<String> PLAINTEXT_ALLOWED_KEYS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "dawaya-theme",
            "dawaya-language",
            "dawaya-type-scale",
            "dawaya-offline-mode",
            "dawaya-news-v1",
            "dawaya-ai-model-state-v1",
            "dawaya-ai-settings-v1"
        ))
    );

    /**
     * CapacitorHttp rewrites a remote URL into a request at the app origin
     * (path prefix below, real target in the "u" query parameter). The gate unwraps it
     * and re-checks the true destination, so the proxy can never smuggle a host past the
     * allowlist even if the plugin is ever enabled.
     */
    public static final String PROXY_PATH_PREFIX = "/_capacitor_http_interceptor_";
    public static final String PROXY_URL_PARAM = "u";

    /** Schemes that resolve inside the process and never touch a socket. */
    private static final Set<String> LOCAL_SCHEMES = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("data", "blob", "about"))
    );

    private DawayaPrivacyPolicy() {}

    /** Host names of the allowlist, for privacy screens and the CI report. */
    public static List<String> allowedHostNames() {
        String[] names = new String[ALLOWED_HOSTS.size()];
        for (int index = 0; index < ALLOWED_HOSTS.size(); index++) {
            names[index] = ALLOWED_HOSTS.get(index).host;
        }
        return Collections.unmodifiableList(Arrays.asList(names));
    }

    /** True for the bundled app origin: the WebView's own asset host and scheme. */
    public static boolean isBundledOrigin(String scheme, String host) {
        String safeScheme = normalize(scheme);
        String safeHost = normalize(host);
        if (!"https".equals(safeScheme) && !"http".equals(safeScheme)) return false;
        return BUNDLED_ORIGIN_HOSTS.contains(safeHost);
    }

    /** data:, blob: and about: are in-process resources, never network traffic. */
    public static boolean isLocalScheme(String scheme) {
        return LOCAL_SCHEMES.contains(normalize(scheme));
    }

    /**
     * Only the WebView's own bundled assets may be read through {@code file:}.
     * Anything else (a sibling app's files, external storage) is refused.
     */
    public static boolean isBundledFile(String scheme, String path) {
        if (!"file".equals(normalize(scheme))) return false;
        if (path == null) return false;
        return path.startsWith("/android_asset/") || path.startsWith("/android_res/");
    }

    /** True when the path is a CapacitorHttp proxy wrapper. */
    public static boolean isProxiedPath(String path) {
        return path != null && path.startsWith(PROXY_PATH_PREFIX);
    }

    /**
     * The core check: may this request leave the process?
     *
     * @param method      the HTTP method, e.g. GET
     * @param scheme      lower-case or mixed-case URL scheme
     * @param host        URL host
     * @param path        URL path, may be null
     * @param userInitiated whether a real user action started this request
     */
    public static boolean isAllowedRequest(
        String method,
        String scheme,
        String host,
        String path,
        boolean userInitiated
    ) {
        String safeScheme = normalize(scheme);
        String safeHost = normalize(host);
        String safeMethod = normalize(method);
        if (safeHost == null || safeHost.isEmpty()) return false;
        if (!"https".equals(safeScheme) && !"http".equals(safeScheme)) return false;
        if (isBundledOrigin(safeScheme, safeHost)) return true;
        for (AllowedHost entry : ALLOWED_HOSTS) {
            if (!entry.host.equals(safeHost) || !entry.scheme.equals(safeScheme)) continue;
            if (!entry.methods.contains(safeMethod)) continue;
            if (entry.userInitiatedOnly && !userInitiated) continue;
            if (!entry.pathPrefixes.isEmpty() && !matchesAnyPrefix(path, entry.pathPrefixes)) continue;
            return true;
        }
        return false;
    }

    /** Convenience overload for navigation checks, where the method is always GET. */
    public static boolean isAllowedNavigation(String scheme, String host, String path, boolean userInitiated) {
        return isAllowedRequest("GET", scheme, host, path, userInitiated);
    }

    /** Keys that hold user-entered health content and must use the keystore store. */
    public static boolean isSecureKey(String key) {
        return key != null && SECURE_ONLY_KEYS.contains(key.trim());
    }

    /** Settings keys that may live in plaintext SharedPreferences. */
    public static boolean isPlaintextKey(String key) {
        return key != null && PLAINTEXT_ALLOWED_KEYS.contains(key.trim());
    }

    /** True when the URL carries a tracking or identity parameter from the config. */
    public static boolean hasForbiddenParameter(String url) {
        if (url == null) return false;
        String[] forbidden = {
            "utm_source", "utm_medium", "utm_campaign", "client_id", "device_id", "did",
            "imei", "android_id", "adid", "idfa", "sid", "session_id", "user_id", "uid", "api_key"
        };
        String lower = url.toLowerCase(Locale.US);
        for (String parameter : forbidden) {
            if (lower.contains(parameter + "=")) return true;
        }
        return false;
    }

    private static boolean matchesAnyPrefix(String path, List<String> prefixes) {
        for (String prefix : prefixes) {
            if (startsWith(path, prefix)) return true;
        }
        return false;
    }

    private static boolean startsWith(String path, String prefix) {
        if (path == null) return false;
        String value = path;
        // A path that does not carry the prefix at all is refused; a bare host is a
        // directory listing the app never needs.
        if (!value.endsWith("/")) value = value + "/";
        return value.startsWith(prefix);
    }

    private static String normalize(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.US);
    }
}
