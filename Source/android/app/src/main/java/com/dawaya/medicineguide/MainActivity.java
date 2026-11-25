package com.dawaya.medicineguide;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DawayaShellPlugin.class);
        registerPlugin(DawayaLLMPlugin.class);
        super.onCreate(savedInstanceState);
        // Screenshots, screen recordings and the recent-apps thumbnail are blanked:
        // the page can show the reader's reminders and the medicines they looked up.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        // The edge glow drags the fixed bottom bar out of place on an overscroll.
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Least privilege inside the bundled app: no file or content-provider reads, no
        // geolocation, no remote debugging. Everything is served from the asset origin.
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable) WebView.setWebContentsDebuggingEnabled(false);
        // Every request and navigation is checked against the privacy.config.json
        // allowlist before Capacitor's own client sees it.
        webView.setWebViewClient(new DawayaPrivacyWebViewClient(bridge.getWebViewClient()));
        // Offline is sticky: whatever the user last chose in Settings survives the restart,
        // so no query can leave the device before the web layer has even booted.
        DawayaShellPlugin.applyOfflineMode(webView, DawayaShellPlugin.persistedOfflineMode(this));
    }
}
