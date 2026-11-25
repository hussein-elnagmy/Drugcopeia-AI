package com.dawaya.medicineguide;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.app.ActivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Dawaya AI - Android on-device runtime.
 *
 * The bundled llama.cpp server (arm64) is started as a child process from the
 * app's native library directory and reached over a raw 127.0.0.1 socket with a
 * random port and API key. The app's network-security config keeps cleartext
 * HTTP stacks disabled, so the loopback protocol here uses plain sockets and
 * never leaves the device. Model bytes are handled only by this class: downloads
 * are restricted to the hosts in assets/ai/model-config.json, verification is
 * native, and prompt text is sent to the local server only.
 */
@CapacitorPlugin(name = "DawayaLLM")
public class DawayaLLMPlugin extends Plugin {
    private static final String TAG = "DawayaLLM";
    private static final int IMPORT_REQUEST = 4917;
    private static final String STATE_PREFS = "dawaya-ai-model-state";
    private static final String USER_AGENT = "Dawaya/1.7.6 (offline medicine guide; model download)";

    private static final ExecutorService IO = Executors.newCachedThreadPool();

    private JSONObject config;
    private volatile Process server;
    private volatile int serverPort;
    private volatile String serverKey;
    private volatile boolean loaded;
    private volatile Socket activeSocket;

    private volatile boolean downloading;
    private volatile boolean paused;
    private volatile boolean downloadCancelled;
    private volatile boolean generationCancelled;
    private volatile String downloadId;

    /* Tokens are pooled and pushed on a beat instead of one web view call each. */
    private final Handler tokenHandler = new Handler(Looper.getMainLooper());
    private final StringBuilder tokenBuffer = new StringBuilder();
    private String tokenRequest = "";
    private boolean tokenFlushQueued = false;
    private static final long TOKEN_FLUSH_MS = 50;
    private volatile Thread downloadThread;
    private volatile long downloaded;
    private volatile long totalBytes;

    private PluginCall pendingImport;

    // MARK: - config helpers

    private synchronized JSONObject config() {
        if (config != null) return config;
        try (InputStream in = getContext().getAssets().open("public/assets/ai/model-config.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            config = new JSONObject(out.toString("UTF-8"));
        } catch (Exception error) {
            Log.w(TAG, "model config unavailable");
            config = new JSONObject();
        }
        return config;
    }

    private JSONObject modelConfig() {
        JSONObject value = config().optJSONObject("model");
        return value != null ? value : new JSONObject();
    }

    private JSONObject generationConfig() {
        JSONObject value = config().optJSONObject("generation");
        return value != null ? value : new JSONObject();
    }

    private String modelSha() {
        return modelConfig().optString("sha256", "").toLowerCase();
    }

    private File modelsDir() {
        File dir = new File(getContext().getNoBackupFilesDir(), "models");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File modelFile() {
        String name = modelConfig().optString("fileName", "model.gguf");
        return new File(modelsDir(), new File(name).getName());
    }

    private File partFile() {
        return new File(modelFile().getAbsolutePath() + ".part");
    }

    private SharedPreferences state() {
        return getContext().getSharedPreferences(STATE_PREFS, Activity.MODE_PRIVATE);
    }

    private String serverBinary() {
        File binary = new File(getContext().getApplicationInfo().nativeLibraryDir, "libllamaserver.so");
        return binary.exists() ? binary.getAbsolutePath() : "";
    }

    // MARK: - capabilities / status

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject result = new JSObject();
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Activity.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        if (manager != null) manager.getMemoryInfo(memory);
        StatFs stat = new StatFs(getContext().getFilesDir().getAbsolutePath());
        JSONObject device = config().optJSONObject("device");
        int minRamMb = device != null ? device.optInt("minRamMB", 2600) : 2600;
        long totalRam = memory.totalMem;
        boolean arm64 = false;
        for (String abi : Build.SUPPORTED_ABIS) {
            if ("arm64-v8a".equals(abi)) arm64 = true;
        }
        boolean binary = !serverBinary().isEmpty();
        boolean supported = arm64 && binary;
        String reason = "";
        if (!binary) reason = "runtime-missing";
        else if (!arm64) reason = "unsupported-abi";
        else if (totalRam > 0 && totalRam < minRamMb * 1024L * 1024L) {
            supported = false;
            reason = "low-memory";
        }
        result.put("supported", supported);
        result.put("reason", reason);
        result.put("backends", new org.json.JSONArray().put("cpu"));
        result.put("totalRamBytes", totalRam);
        result.put("freeRamBytes", memory.availMem);
        result.put("cores", Runtime.getRuntime().availableProcessors());
        result.put("storageBytes", stat.getAvailableBytes());
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        File file = modelFile();
        boolean present = file.exists() && file.length() > 0;
        String state = "not-downloaded";
        if (loaded) state = "ready";
        else if (downloading) state = "downloading";
        else if (present) state = "ready-to-load";
        result.put("state", state);
        result.put("fileName", file.getName());
        result.put("sizeBytes", present ? file.length() : 0);
        result.put("downloadedBytes", partFile().exists() ? partFile().length() : 0);
        result.put("checksumVerified", state().getBoolean("checksumVerified", false));
        result.put("path", present ? file.getAbsolutePath() : "");
        call.resolve(result);
    }

    // MARK: - download lifecycle

    @PluginMethod
    public void download(PluginCall call) {
        if (downloading) {
            JSObject result = new JSObject();
            result.put("id", downloadId);
            call.resolve(result);
            return;
        }
        paused = false;
        downloadCancelled = false;
        downloading = true;
        downloadId = "d" + System.currentTimeMillis();
        JSObject result = new JSObject();
        result.put("id", downloadId);
        call.resolve(result);
        startDownloadThread();
    }

    private void startDownloadThread() {
        Thread thread = new Thread(this::downloadLoop, "dawaya-model-download");
        downloadThread = thread;
        thread.start();
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) {
        paused = true;
        downloading = false;
        emit("download-paused", downloadId);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void resumeDownload(PluginCall call) {
        if (!downloading) {
            paused = false;
            downloadCancelled = false;
            downloading = true;
            startDownloadThread();
        }
        JSObject result = new JSObject();
        result.put("id", downloadId);
        call.resolve(result);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancelled = true;
        paused = false;
        downloading = false;
        partFile().delete();
        state().edit().putBoolean("downloaded", false).putBoolean("checksumVerified", false).apply();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void verifyDownload(PluginCall call) {
        JSObject result = verify();
        call.resolve(result);
    }

    private void downloadLoop() {
        String urlText = modelConfig().optString("url", "");
        totalBytes = modelConfig().optLong("sizeBytes", 0);
        long existing = partFile().exists() ? partFile().length() : 0;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlText);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !isAllowedHost(url.getHost())) {
                failDownload("host-not-allowed");
                return;
            }
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(45000);
            if (existing > 0) connection.setRequestProperty("Range", "bytes=" + existing + "-");
            connection.setInstanceFollowRedirects(true);
            int code = connection.getResponseCode();
            if (!isAllowedHost(connection.getURL().getHost())) {
                failDownload("redirect-not-allowed");
                return;
            }
            if (code == HttpURLConnection.HTTP_OK && existing > 0) {
                existing = 0;
                partFile().delete();
            }
            if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
                failDownload("http-" + code);
                return;
            }
            if (connection.getContentLengthLong() > 0) totalBytes = existing + connection.getContentLengthLong();
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 RandomAccessFile out = new RandomAccessFile(partFile(), "rw")) {
                out.seek(existing);
                downloaded = existing;
                byte[] buffer = new byte[256 * 1024];
                long lastEmit = 0;
                long started = System.currentTimeMillis();
                int read;
                while ((read = in.read(buffer)) > 0) {
                    if (downloadCancelled) return;
                    if (paused) {
                        emit("download-paused", downloadId);
                        return;
                    }
                    out.write(buffer, 0, read);
                    downloaded += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 400) {
                        lastEmit = now;
                        double rate = (downloaded - existing) / Math.max(0.001, (now - started) / 1000.0);
                        emitProgress(rate);
                    }
                }
            }
            File target = modelFile();
            if (target.exists()) target.delete();
            if (!partFile().renameTo(target)) {
                failDownload("rename-failed");
                return;
            }
            state().edit().putBoolean("downloaded", true).apply();
            JSObject done = new JSObject();
            done.put("type", "download-completed");
            done.put("id", downloadId);
            done.put("sizeBytes", target.length());
            emitObject(done);
        } catch (Exception error) {
            if (!paused && !downloadCancelled) failDownload(String.valueOf(error.getMessage()));
        } finally {
            downloading = false;
            if (connection != null) connection.disconnect();
        }
    }

    private void emitProgress(double rate) {
        JSObject event = new JSObject();
        event.put("type", "download-progress");
        event.put("id", downloadId);
        event.put("downloadedBytes", downloaded);
        event.put("totalBytes", totalBytes);
        event.put("bytesPerSecond", (long) rate);
        emitObject(event);
    }

    private void failDownload(String reason) {
        downloading = false;
        state().edit().putBoolean("downloaded", false).apply();
        emit("download-error", reason);
    }

    private JSObject verify() {
        JSObject result = new JSObject();
        try {
            String digest = sha256(modelFile());
            String expected = modelSha();
            boolean ok = expected.isEmpty() || expected.equalsIgnoreCase(digest);
            if (!ok) {
                modelFile().delete();
                state().edit().putBoolean("checksumVerified", false).putBoolean("downloaded", false).apply();
                JSObject event = new JSObject();
                event.put("type", "checksum-failed");
                event.put("id", downloadId);
                event.put("expected", expected);
                event.put("actual", digest);
                emitObject(event);
                result.put("ok", false);
                result.put("sha256", digest);
                return result;
            }
            state().edit().putBoolean("checksumVerified", true).putBoolean("downloaded", true).apply();
            result.put("ok", true);
            result.put("sha256", digest);
        } catch (Exception error) {
            result.put("ok", false);
            result.put("error", String.valueOf(error.getMessage()));
        }
        return result;
    }

    // MARK: - import

    @PluginMethod
    public void importModel(PluginCall call) {
        pendingImport = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/octet-stream", "application/gguf" });
        try {
            getActivity().startActivityForResult(intent, IMPORT_REQUEST);
        } catch (Exception error) {
            pendingImport = null;
            call.resolve(new JSObject().put("ok", false).put("error", "picker-unavailable"));
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != IMPORT_REQUEST) return;
        PluginCall call = pendingImport;
        pendingImport = null;
        if (call == null) return;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("ok", false).put("error", "cancelled"));
            return;
        }
        Uri uri = data.getData();
        IO.execute(() -> {
            File target = modelFile();
            try (InputStream in = getContext().getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[256 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            } catch (Exception error) {
                target.delete();
                call.resolve(new JSObject().put("ok", false).put("error", "copy-failed"));
                return;
            }
            JSObject verified = verify();
            if (!verified.optBoolean("ok", false)) {
                target.delete();
                call.resolve(new JSObject().put("ok", false).put("error", "checksum-mismatch"));
                return;
            }
            call.resolve(new JSObject()
                .put("ok", true)
                .put("checksumVerified", true)
                .put("fileName", target.getName())
                .put("sizeBytes", target.length()));
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        unloadInternal();
        modelFile().delete();
        partFile().delete();
        state().edit().clear().apply();
        call.resolve(new JSObject().put("ok", true));
    }

    // MARK: - server lifecycle

    @PluginMethod
    public void load(PluginCall call) {
        JSObject params = call.getObject("params");
        IO.execute(() -> {
            JSObject result = ensureServer(params);
            call.resolve(result);
        });
    }

    private synchronized JSObject ensureServer(JSONObject params) {
        JSObject result = new JSObject();
        if (loaded && server != null && server.isAlive()) {
            result.put("ok", true);
            result.put("already", true);
            return result;
        }
        String binary = serverBinary();
        if (binary.isEmpty()) {
            result.put("ok", false);
            result.put("error", "runtime-missing");
            return result;
        }
        File model = modelFile();
        if (!model.exists()) {
            result.put("ok", false);
            result.put("error", "model-missing");
            return result;
        }
        if (!state().getBoolean("checksumVerified", false)) {
            result.put("ok", false);
            result.put("error", "model-unverified");
            return result;
        }
        int threads = params != null ? params.optInt("n_threads", 0) : 0;
        if (threads <= 0) threads = Math.max(1, Runtime.getRuntime().availableProcessors() - 1);
        int ctx = params != null ? params.optInt("n_ctx", 0) : 0;
        if (ctx <= 0) ctx = generationConfig().optInt("n_ctx", 2048);
        try {
            serverPort = freePort();
            serverKey = randomKey();
            List<String> command = new ArrayList<>();
            command.add(binary);
            command.add("--model");
            command.add(model.getAbsolutePath());
            command.add("--host");
            command.add("127.0.0.1");
            command.add("--port");
            command.add(String.valueOf(serverPort));
            command.add("--ctx-size");
            command.add(String.valueOf(ctx));
            command.add("--threads");
            command.add(String.valueOf(threads));
            command.add("--parallel");
            command.add("1");
            command.add("--api-key");
            command.add(serverKey);
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.environment().put("LD_LIBRARY_PATH", getContext().getApplicationInfo().nativeLibraryDir);
            builder.redirectErrorStream(true);
            long started = System.currentTimeMillis();
            server = builder.start();
            /* Drain the server's output so a full pipe can never stall generation. */
            IO.execute(() -> {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(server.getInputStream()))) {
                    while (reader.readLine() != null) { /* discard */ }
                } catch (Exception ignored) {
                }
            });
            long deadline = System.currentTimeMillis() + 120000;
            while (System.currentTimeMillis() < deadline) {
                if (!server.isAlive()) break;
                if (healthy()) {
                    loaded = true;
                    result.put("ok", true);
                    result.put("loadMs", System.currentTimeMillis() - started);
                    result.put("backend", "cpu");
                    return result;
                }
                Thread.sleep(350);
            }
            result.put("ok", false);
            result.put("error", "runtime-load-failed");
        } catch (Exception error) {
            result.put("ok", false);
            result.put("error", String.valueOf(error.getMessage()));
        }
        server = null;
        loaded = false;
        return result;
    }

    @PluginMethod
    public void unload(PluginCall call) {
        unloadInternal();
        call.resolve(new JSObject().put("ok", true));
    }

    private synchronized void unloadInternal() {
        if (server != null) {
            server.destroy();
            server = null;
        }
        loaded = false;
    }

    // MARK: - generation

    @PluginMethod
    public void generate(PluginCall call) {
        String requestId = call.getString("requestId", "r" + System.currentTimeMillis());
        String prompt = call.getString("prompt", "");
        JSONObject params = call.getObject("params");
        generationCancelled = false;
        IO.execute(() -> {
            JSObject serverReady = ensureServer(params);
            if (!serverReady.optBoolean("ok", false)) {
                call.resolve(new JSObject().put("error", serverReady.optString("error", "runtime-load-failed")).put("text", ""));
                return;
            }
            /* Flush on the same queue the tokens arrived on, so the buffered tail is in
               the page before the promise resolves and the finished answer is painted. */
            final JSObject generated = generateBlocking(requestId, prompt, params);
            tokenHandler.post(() -> {
                flushTokens();
                call.resolve(generated);
            });
        });
    }

    private JSObject generateBlocking(String requestId, String prompt, JSONObject params) {
        JSObject result = new JSObject();
        JSONObject generation = generationConfig();
        int predict = params != null ? params.optInt("n_predict", 0) : 0;
        if (predict <= 0) predict = generation.optInt("n_predict_max_new_tokens", 300);
        double temperature = params != null ? params.optDouble("temperature", 0.1) : 0.1;
        double topP = params != null ? params.optDouble("top_p", 0.9) : 0.9;
        int topK = params != null ? params.optInt("top_k", 40) : 40;
        double repeat = params != null ? params.optDouble("repeat_penalty", 1.1) : 1.1;
        String chatml = "<|im_start|>system\nYou answer only from the reference data the user supplies.<|im_end|>\n"
            + "<|im_start|>user\n" + prompt + "<|im_end|>\n<|im_start|>assistant\n";
        try {
            JSONObject body = new JSONObject();
            body.put("prompt", chatml);
            body.put("stream", true);
            body.put("n_predict", predict);
            body.put("temperature", temperature);
            body.put("top_p", topP);
            body.put("top_k", topK);
            body.put("repeat_penalty", repeat);
            /* Reuse the token-verified prefix of the previous prompt instead of
               re-processing it for every question. llama-server compares the actual
               tokens before reusing a slot, so a changed system rule or a different
               retrieved record starts a fresh computation - no stale KV can leak into
               an answer. */
            body.put("cache_prompt", true);
            body.put("stop", new org.json.JSONArray().put("<|im_end|>"));
            String payload = body.toString();
            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
            long started = System.currentTimeMillis();
            Socket socket = new Socket();
            activeSocket = socket;
            socket.connect(new InetSocketAddress("127.0.0.1", serverPort), 5000);
            socket.setSoTimeout(180000);
            OutputStream out = socket.getOutputStream();
            String head = "POST /completion HTTP/1.1\r\n"
                + "Host: 127.0.0.1:" + serverPort + "\r\n"
                + "Authorization: Bearer " + serverKey + "\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Connection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            out.write(bytes);
            out.flush();
            InputStream in = socket.getInputStream();
            String status = readLine(in);
            int code = status != null && status.startsWith("HTTP/1.1 ") ? Integer.parseInt(status.substring(9, 12)) : 0;
            String headerLine;
            boolean chunked = false;
            long contentLength = -1;
            while ((headerLine = readLine(in)) != null && !headerLine.isEmpty()) {
                String lower = headerLine.toLowerCase();
                if (lower.startsWith("transfer-encoding:") && lower.contains("chunked")) chunked = true;
                if (lower.startsWith("content-length:")) contentLength = Long.parseLong(headerLine.substring(15).trim());
            }
            if (code != 200) {
                result.put("error", "runtime-" + code);
                result.put("text", "");
                return result;
            }
            StringBuilder text = new StringBuilder();
            int tokens = 0;
            final InputStream bodyIn = chunked ? new ChunkedStream(in) : in;
            BufferedReader reader = new BufferedReader(new InputStreamReader(bodyIn, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (generationCancelled || Thread.currentThread().isInterrupted()) break;
                if (!line.startsWith("data:")) continue;
                String data = line.substring(5).trim();
                try {
                    JSONObject chunk = new JSONObject(data);
                    String piece = chunk.optString("content", "");
                    if (!piece.isEmpty()) {
                        text.append(piece);
                        tokens++;
                        emitToken(requestId, piece);
                    }
                    if (chunk.optBoolean("stop", false)) break;
                } catch (Exception ignored) {
                }
            }
            activeSocket = null;
            socket.close();
            result.put("text", text.toString());
            result.put("tokens", tokens);
            result.put("milliseconds", System.currentTimeMillis() - started);
            result.put("cancelled", generationCancelled);
        } catch (Exception error) {
            result.put("text", "");
            result.put("cancelled", generationCancelled);
            result.put("error", String.valueOf(error.getMessage()));
        }
        activeSocket = null;
        return result;
    }

    @PluginMethod
    public void cancelGeneration(PluginCall call) {
        generationCancelled = true;
        Socket socket = activeSocket;
        if (socket != null) {
            try {
                socket.close();
            } catch (Exception ignored) {
            }
        }
        call.resolve(new JSObject().put("ok", true));
    }

    // MARK: - loopback helpers

    private boolean healthy() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", serverPort), 1500);
            socket.setSoTimeout(1500);
            String request = "GET /health HTTP/1.1\r\nHost: 127.0.0.1:" + serverPort
                + "\r\nAuthorization: Bearer " + serverKey + "\r\nConnection: close\r\n\r\n";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            String status = readLine(socket.getInputStream());
            return status != null && status.contains(" 200 ");
        } catch (Exception error) {
            return false;
        }
    }

    private static String readLine(InputStream in) throws Exception {
        StringBuilder line = new StringBuilder();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') line.append((char) ch);
        }
        return line.length() == 0 && ch == -1 ? null : line.toString();
    }

    /** Minimal chunked-transfer decoder: the loopback protocol is the only consumer. */
    private static final class ChunkedStream extends InputStream {
        private final InputStream in;
        private long remaining;
        private boolean done;

        ChunkedStream(InputStream in) {
            this.in = in;
        }

        @Override
        public int read() throws java.io.IOException {
            byte[] one = new byte[1];
            int count = read(one, 0, 1);
            return count < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws java.io.IOException {
            if (done) return -1;
            if (remaining == 0) {
                try {
                    String line = readLine(in);
                    if (line == null) return -1;
                    if (line.isEmpty()) line = readLine(in);
                    if (line == null) return -1;
                    int semicolon = line.indexOf(';');
                    if (semicolon >= 0) line = line.substring(0, semicolon);
                    remaining = Long.parseLong(line.trim(), 16);
                    if (remaining == 0) {
                        done = true;
                        return -1;
                    }
                } catch (Exception error) {
                    throw new java.io.IOException(error);
                }
            }
            int want = (int) Math.min(length, remaining);
            int count = in.read(buffer, offset, want);
            if (count > 0) remaining -= count;
            return count;
        }
    }

    // MARK: - events

    private void emit(String type, String payload) {
        JSObject event = new JSObject();
        event.put("type", type);
        event.put("id", payload);
        emitObject(event);
    }

    /* A per-token evaluateJavascript call costs more than the token itself on a cheap
       phone, so pieces pile up here and one call carries whatever arrived since the
       last beat. */
    private void emitToken(String requestId, String piece) {
        tokenHandler.post(() -> {
            if (!requestId.equals(tokenRequest)) {
                flushTokens();
                tokenRequest = requestId;
            }
            tokenBuffer.append(piece);
            if (tokenFlushQueued) return;
            tokenFlushQueued = true;
            tokenHandler.postDelayed(() -> {
                tokenFlushQueued = false;
                flushTokens();
            }, TOKEN_FLUSH_MS);
        });
    }

    private void flushTokens() {
        if (tokenBuffer.length() == 0) return;
        String piece = tokenBuffer.toString();
        tokenBuffer.setLength(0);
        JSObject token = new JSObject();
        token.put("type", "token");
        token.put("requestId", tokenRequest);
        token.put("token", piece);
        emitObject(token);
    }

    private void emitObject(JSObject event) {
        final String json = event.toString();
        getActivity().runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "window.__dawayaLLMEvent && window.__dawayaLLMEvent(" + json + ");", null);
            }
        });
    }

    // MARK: - utilities

    private static boolean isAllowedHost(String host) {
        if (host == null) return false;
        String value = host.toLowerCase();
        return value.equals("huggingface.co") || value.equals("hf.co") || value.endsWith(".hf.co")
            || value.endsWith(".huggingface.co") || value.equals("github.com")
            || value.endsWith(".githubusercontent.com");
    }

    private static int freePort() throws Exception {
        try (ServerSocket socket = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            return socket.getLocalPort();
        }
    }

    private static String randomKey() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        StringBuilder out = new StringBuilder();
        for (byte value : bytes) out.append(String.format("%02x", value));
        return out.toString();
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = in.read(buffer)) > 0) digest.update(buffer, 0, read);
        }
        StringBuilder out = new StringBuilder();
        for (byte value : digest.digest()) out.append(String.format("%02x", value));
        return out.toString();
    }
}
