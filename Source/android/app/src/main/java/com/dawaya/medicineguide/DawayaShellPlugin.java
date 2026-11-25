package com.dawaya.medicineguide;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;

import androidx.appcompat.content.res.AppCompatResources;
import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android side of the Dawaya shell bridge.
 *
 * <p>It does local work only: reminders, the offline switch, the encrypted store and
 * one-shot voice search through the speech recogniser installed on the device. There
 * is no image search: the barcode camera runs in the WebView and decodes frames on the
 * device. This file never opens a socket of its own.
 *
 * <p>The secure store uses the AndroidKeyStore directly: a 256-bit AES/GCM key that
 * never leaves the hardware/keystore process, a fresh 12-byte IV per value prefixed to
 * the ciphertext, and the result base64-encoded into a private SharedPreferences file.
 * No third-party crypto dependency was added, because {@code androidx.security} is not
 * part of this project's dependency set and adding one would enlarge the attack surface.
 */
@CapacitorPlugin(
    name = "DawayaShell",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class DawayaShellPlugin extends Plugin {

    private static final String BACKEND = "android-keystore";
    private static final String KEYSTORE_TYPE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "dawaya_secure_store";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    /** The SharedPreferences file holding the encrypted blobs (MODE_PRIVATE). */
    private static final String SECURE_STORE = "dawaya-secure.bin";
    private static final String SHELL_PREFS = "dawaya-shell";
    private static final String PREF_OFFLINE_MODE = "offline-mode";
    /** The toolbar button on the in-app browser view, in both app languages. */
    private static final String BROWSER_ACTION_ENGLISH = "Open in browser";
    private static final String BROWSER_ACTION_ARABIC = "افتح في المتصفح";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private static final String ERROR_KEY = "key-not-allowed";
    private static final String ERROR_STORAGE = "secure-storage";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SpeechRecognizer speechRecognizer;
    private PluginCall pendingVoiceCall;
    private Runnable voiceTimeout;
    private String voiceLatest = "";

    // MARK: - Reminders (local alarms only)

    @PluginMethod
    public void syncReminders(PluginCall call) {
        boolean requestAuthorization = Boolean.TRUE.equals(call.getBoolean("requestAuthorization", false));
        if (requestAuthorization
            && Build.VERSION.SDK_INT >= 33
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
            return;
        }
        applyReminders(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        applyReminders(call);
    }

    private void applyReminders(PluginCall call) {
        JSArray reminders = call.getArray("reminders");
        JSONArray items = new JSONArray();
        if (reminders != null) {
            for (int index = 0; index < reminders.length() && items.length() < 20; index++) {
                JSONObject source = reminders.optJSONObject(index);
                if (source == null) continue;
                String id = source.optString("id", "").trim();
                String name = source.optString("name", "").replaceAll("\\s+", " ").trim();
                String dose = source.optString("dose", "").replaceAll("\\s+", " ").trim();
                String time = source.optString("time", "").trim();
                if (id.isEmpty() || name.isEmpty() || ReminderScheduler.parse(time) == null) continue;
                try {
                    JSONObject item = new JSONObject();
                    item.put("id", id.length() > 80 ? id.substring(0, 80) : id);
                    item.put("name", name.length() > 80 ? name.substring(0, 80) : name);
                    item.put("dose", dose.length() > 80 ? dose.substring(0, 80) : dose);
                    item.put("time", time);
                    item.put("taken", source.optBoolean("taken", false));
                    items.put(item);
                } catch (JSONException ignored) {
                    // Skip malformed reminder entries.
                }
            }
        }
        ReminderScheduler.sync(getContext(), items);
        ReminderReceiver.ensureChannel(getContext());
        JSObject result = new JSObject();
        result.put("scheduled", items.length());
        result.put("authorized", notificationsAuthorized());
        call.resolve(result);
    }

    private boolean notificationsAuthorized() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    // MARK: - Offline switch

    /**
     * {@code setOfflineMode({ enabled })}: flips the WebView's network access. Nothing is
     * reloaded, so the page, the scroll position and any text in the search field stay as
     * they are; the next request simply cannot leave the device.
     */
    @PluginMethod
    public void setOfflineMode(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        persistOfflineMode(getContext(), enabled);
        mainHandler.post(() -> {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            applyOfflineMode(webView, enabled);
        });
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    // MARK: - Voice search

    /**
     * {@code startVoiceSearch({ language })}: one phrase, recognised by the speech
     * service installed on the device. The recording is not written to disk and never
     * passes through Dawaya. The promise resolves with {@code text}, {@code cancelled},
     * {@code error: "permission"} or {@code error: "no-speech"}.
     */
    @PluginMethod
    public void startVoiceSearch(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        beginVoiceSearch(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginVoiceSearch(call);
        } else {
            JSObject result = new JSObject();
            result.put("error", "permission");
            call.resolve(result);
        }
    }

    private void beginVoiceSearch(PluginCall call) {
        mainHandler.post(() -> {
            cancelVoice();
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                JSObject result = new JSObject();
                result.put("error", "unavailable");
                call.resolve(result);
                return;
            }
            pendingVoiceCall = call;
            voiceLatest = "";
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    String reason = "unavailable";
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) reason = "permission";
                    else if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) reason = "no-speech";
                    finishVoice(reason, null);
                }

                @Override
                public void onResults(Bundle results) {
                    finishVoice(null, bestMatch(results));
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    String text = bestMatch(partialResults);
                    if (text.isEmpty()) return;
                    voiceLatest = text;
                    emitVoiceEvent("partial", text);
                }

                @Override public void onEvent(int eventType, Bundle params) {}
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-US"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            try {
                speechRecognizer.startListening(intent);
            } catch (Exception error) {
                finishVoice("unavailable", null);
                return;
            }
            voiceTimeout = () -> finishVoice(voiceLatest.isEmpty() ? "no-speech" : null, voiceLatest.isEmpty() ? null : voiceLatest);
            mainHandler.postDelayed(voiceTimeout, 15000);
        });
    }

    @PluginMethod
    public void stopVoiceSearch(PluginCall call) {
        mainHandler.post(() -> {
            cancelVoice();
            JSObject result = new JSObject();
            result.put("stopped", true);
            call.resolve(result);
        });
    }

    private String bestMatch(Bundle results) {
        ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return "";
        String text = matches.get(0);
        return text == null ? "" : text.trim();
    }

    private void emitVoiceEvent(String type, String text) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        JSObject payload = new JSObject();
        payload.put("type", type);
        payload.put("text", text == null ? "" : text);
        getBridge().getWebView().evaluateJavascript(
            "window.DawayaVoice&&window.DawayaVoice.event(" + payload.toString() + ");", null);
    }

    private void finishVoice(String error, String text) {
        if (voiceTimeout != null) mainHandler.removeCallbacks(voiceTimeout);
        voiceTimeout = null;
        PluginCall pending = pendingVoiceCall;
        pendingVoiceCall = null;
        destroyRecognizer();
        if (pending == null) return;
        JSObject result = new JSObject();
        if (error != null) {
            result.put("error", error);
        } else {
            result.put("text", text == null ? "" : text);
        }
        pending.resolve(result);
    }

    private void cancelVoice() {
        if (voiceTimeout != null) mainHandler.removeCallbacks(voiceTimeout);
        voiceTimeout = null;
        PluginCall pending = pendingVoiceCall;
        pendingVoiceCall = null;
        destroyRecognizer();
        if (pending != null) {
            JSObject result = new JSObject();
            result.put("cancelled", true);
            pending.resolve(result);
        }
    }

    private void destroyRecognizer() {
        if (speechRecognizer == null) return;
        try {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
        } catch (Exception ignored) {
            // The recogniser may already have stopped on its own.
        }
        speechRecognizer = null;
    }

    @Override
    protected void handleOnDestroy() {
        cancelVoice();
        super.handleOnDestroy();
    }

    /**
     * Opens a link in the user's own browser. Nothing remote is ever rendered inside the
     * WebView, and with Offline mode on nothing opens at all — the same contract as the
     * iOS and macOS shells, so a news card behaves identically on every platform.
     */
    @PluginMethod
    public void presentWebPage(PluginCall call) {
        String raw = call.getString("url", "");
        Uri uri = raw == null ? null : Uri.parse(raw);
        String scheme = uri == null || uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            call.resolve(result(false, "blocked", "invalid-url"));
            return;
        }
        if (persistedOfflineMode(getContext())) {
            call.resolve(result(false, "blocked", "offline"));
            return;
        }
        mainHandler.post(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve(result(true, "external", null));
            } catch (Exception error) {
                // No browser installed: the tap does nothing rather than falling back to an
                // in-app render of a page Dawaya cannot verify.
                call.resolve(result(false, "blocked", "no-browser"));
            }
        });
    }

    /**
     * Opens a link in a browser view over the app, used for every link the reader taps —
     * a news headline, a reference, a source citation, a pack photograph — so they stay on
     * the medicine they came from. It is the system Custom Tabs UI, not a WebView inside
     * Dawaya: Dawaya cannot read the page, its cookies or its history, and the address bar
     * and close control stay visible. The toolbar carries one button of our own that hands
     * the same address to the device's default browser. Offline mode blocks it exactly like
     * {@link #presentWebPage}, and a device with no Custom Tabs provider falls back to the
     * external browser rather than rendering a remote page inside Dawaya.
     */
    @PluginMethod
    public void presentInAppBrowser(PluginCall call) {
        String raw = call.getString("url", "");
        Uri uri = raw == null ? null : Uri.parse(raw);
        String scheme = uri == null || uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            call.resolve(result(false, "blocked", "invalid-url"));
            return;
        }
        if (persistedOfflineMode(getContext())) {
            call.resolve(result(false, "blocked", "offline"));
            return;
        }
        // The label follows the language of the page, not the device locale: the reader can
        // be browsing Dawaya in Arabic on an English-locale phone.
        String actionLabel = "ar".equalsIgnoreCase(call.getString("language", ""))
            ? BROWSER_ACTION_ARABIC
            : BROWSER_ACTION_ENGLISH;
        mainHandler.post(() -> {
            try {
                CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
                builder.setShowTitle(true);
                builder.setUrlBarHidingEnabled(false);
                Bitmap actionIcon = browserActionIcon();
                if (actionIcon != null) {
                    Intent toDefaultBrowser = new Intent(Intent.ACTION_VIEW, uri);
                    toDefaultBrowser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    PendingIntent openElsewhere = PendingIntent.getActivity(
                        getContext(), 0, toDefaultBrowser,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    builder.setActionButton(actionIcon, actionLabel, openElsewhere, true);
                }
                CustomTabsIntent browserIntent = builder.build();
                browserIntent.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                browserIntent.launchUrl(getContext(), uri);
                call.resolve(result(true, "in-app", null));
            } catch (Exception error) {
                try {
                    Intent fallback = new Intent(Intent.ACTION_VIEW, uri);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback);
                    call.resolve(result(true, "external", null));
                } catch (Exception missingBrowser) {
                    call.resolve(result(false, "blocked", "no-browser"));
                }
            }
        });
    }

    /**
     * The Custom Tab action button is delivered as a bitmap, so the vector is rasterised at
     * the toolbar's own density. A device whose resources cannot be read simply gets no
     * extra button — the page still opens and the browser's own UI is untouched.
     */
    private Bitmap browserActionIcon() {
        try {
            Drawable icon = AppCompatResources.getDrawable(getContext(), R.drawable.ic_open_in_browser);
            if (icon == null) return null;
            int side = Math.round(24 * getContext().getResources().getDisplayMetrics().density);
            Bitmap bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            icon.setBounds(0, 0, side, side);
            icon.draw(canvas);
            return bitmap;
        } catch (Exception unrenderable) {
            return null;
        }
    }

    private static JSObject result(boolean presented, String target, String error) {
        JSObject value = new JSObject();
        value.put("presented", presented);
        value.put("target", target);
        if (error != null) value.put("error", error);
        return value;
    }

    /**
     * The one public network switch on {@code WebSettings}. Android has no public
     * {@code setNetworkAccessEnabled(boolean)} (it is a hidden framework API and blocked to
     * third-party apps since API 28), so {@code setBlockNetworkLoads} is what actually stops
     * a socket: bundled assets keep loading, remote loads are refused.
     */
    public static void applyOfflineMode(WebView webView, boolean offline) {
        if (webView == null) return;
        webView.getSettings().setBlockNetworkLoads(offline);
    }

    /**
     * Whether the user left the app in Offline mode; read once at startup by MainActivity.
     * Online is the default; the page mirrors its stored switch here on every launch, so
     * the native gate and the page always agree.
     */
    public static boolean persistedOfflineMode(Context context) {
        return shellPrefs(context).getBoolean(PREF_OFFLINE_MODE, false);
    }

    private static void persistOfflineMode(Context context, boolean enabled) {
        // A boolean switch is not health content: offline mode is a plaintext-allowed key
        // in privacy.config.json -> storage.plaintextAllowedKeys.
        shellPrefs(context).edit().putBoolean(PREF_OFFLINE_MODE, enabled).apply();
    }

    private static SharedPreferences shellPrefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(SHELL_PREFS, Context.MODE_PRIVATE);
    }

    // MARK: - Secure store

    /** Tells the web layer whether the platform keystore backend is usable right now. */
    @PluginMethod
    public void secureAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", keystoreReady());
        result.put("backend", BACKEND);
        call.resolve(result);
    }

    /** {@code secureRead({ key })} -> { value }, or a null value when nothing is stored. */
    @PluginMethod
    public void secureRead(PluginCall call) {
        String key = call.getString("key", "");
        if (!DawayaPrivacyPolicy.isSecureKey(key)) {
            call.reject("key-not-allowed", ERROR_KEY);
            return;
        }
        try {
            String value = decryptValue(securePrefs(getContext()), key);
            JSObject result = new JSObject();
            result.put("value", value == null ? JSONObject.NULL : value);
            call.resolve(result);
        } catch (Exception error) {
            // The blob cannot be decrypted (keystore reset, file corrupted). Report the
            // failure class only: neither the key's content nor the value is ever echoed.
            call.reject("secure-unreadable", ERROR_STORAGE);
        }
    }

    /** {@code secureWrite({ key, value })}: encrypts with the AndroidKeyStore key. */
    @PluginMethod
    public void secureWrite(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value");
        if (!DawayaPrivacyPolicy.isSecureKey(key)) {
            call.reject("key-not-allowed", ERROR_KEY);
            return;
        }
        if (value == null) {
            call.reject("value-missing", ERROR_KEY);
            return;
        }
        try {
            encryptValue(securePrefs(getContext()), key, value);
            JSObject result = new JSObject();
            result.put("written", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("secure-unwritable", ERROR_STORAGE);
        }
    }

    /** {@code secureClear({ key })}: drops one entry; the key itself stays in the keystore. */
    @PluginMethod
    public void secureClear(PluginCall call) {
        String key = call.getString("key", "");
        if (!DawayaPrivacyPolicy.isSecureKey(key)) {
            call.reject("key-not-allowed", ERROR_KEY);
            return;
        }
        securePrefs(getContext()).edit().remove(key).commit();
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    /** Erase everything: the encrypted store file and the keystore key behind it. */
    @PluginMethod
    public void secureClearAll(PluginCall call) {
        Context context = getContext().getApplicationContext();
        securePrefs(context).edit().clear().commit();
        context.deleteSharedPreferences(SECURE_STORE);
        destroyKey();
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    private static SharedPreferences securePrefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(SECURE_STORE, Context.MODE_PRIVATE);
    }

    private void encryptValue(SharedPreferences store, String key, String value) throws Exception {
        byte[] iv = new byte[IV_BYTES];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, ensureKey(), new GCMParameterSpec(TAG_BITS, iv));
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] prefixed = new byte[iv.length + sealed.length];
        System.arraycopy(iv, 0, prefixed, 0, iv.length);
        System.arraycopy(sealed, 0, prefixed, iv.length, sealed.length);
        // commit(), not apply(): a reminder saved seconds before a crash must survive.
        store.edit().putString(key, Base64.encodeToString(prefixed, Base64.NO_WRAP)).commit();
    }

    private String decryptValue(SharedPreferences store, String key) throws Exception {
        String encoded = store.getString(key, null);
        if (encoded == null || encoded.isEmpty()) return null;
        byte[] prefixed = Base64.decode(encoded, Base64.NO_WRAP);
        if (prefixed.length <= IV_BYTES) throw new IllegalStateException("sealed blob is truncated");
        byte[] iv = new byte[IV_BYTES];
        System.arraycopy(prefixed, 0, iv, 0, IV_BYTES);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, ensureKey(), new GCMParameterSpec(TAG_BITS, iv));
        byte[] plain = cipher.doFinal(prefixed, IV_BYTES, prefixed.length - IV_BYTES);
        return new String(plain, StandardCharsets.UTF_8);
    }

    /** True when the keystore is reachable and its key exists or can be created. */
    private boolean keystoreReady() {
        try {
            ensureKey();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private SecretKey ensureKey() throws Exception {
        KeyStore keyStore = keyStore();
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_TYPE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // No biometric and no unlock prompt: the guide must stay usable offline, and
            // the value is not protected against the person holding the phone, only
            // against anything outside the app sandbox.
            .setUserAuthenticationRequired(false)
            .setUserPresenceRequired(false)
            // We supply our own random IV per value and prefix it, which the platform's
            // automatic IV would otherwise reject.
            .setRandomizedEncryptionRequired(false)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build());
        generator.generateKey();
        KeyStore.Entry created = keyStore.getEntry(KEY_ALIAS, null);
        if (!(created instanceof KeyStore.SecretKeyEntry)) {
            throw new IllegalStateException("keystore key was not created");
        }
        return ((KeyStore.SecretKeyEntry) created).getSecretKey();
    }

    private void destroyKey() {
        try {
            KeyStore keyStore = keyStore();
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // A keystore that cannot be opened holds nothing readable either.
        }
    }

    private KeyStore keyStore() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_TYPE);
        keyStore.load(null);
        return keyStore;
    }
}
