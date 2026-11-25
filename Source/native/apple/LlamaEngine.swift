//
//  LlamaEngine.swift
//  Dawaya on-device assistant engine (macOS + iOS).
//
//  Runs llama.cpp in-process on the model file the user downloaded or imported. The web layer
//  never sees the bytes: it asks for status, kicks a download and streams tokens, while every
//  safety decision stays in the JavaScript pipeline.
//
//  Everything here is local. The only network use is the one-time model download from the
//  Hugging Face hosts the privacy config already allowlists.
//

import Foundation
import CryptoKit
import llama

enum LlamaEngineError: LocalizedError {
    case badUrl(String)
    case hostNotAllowed(String)
    case fileMissing
    case loadFailed(String)
    case notLoaded
    case cancelled

    var errorDescription: String? {
        switch self {
        case .badUrl(let value): return "invalid-url: \(value)"
        case .hostNotAllowed(let host): return "host-not-allowed: \(host)"
        case .fileMissing: return "model-missing"
        case .loadFailed(let reason): return "model-load-failed: \(reason)"
        case .notLoaded: return "model-not-loaded"
        case .cancelled: return "cancelled"
        }
    }
}

struct LlamaGenerationParams {
    var nCtx: Int32 = 2048
    var nThreads: Int32 = 2
    var nPredict: Int32 = 300
    var batchSize: Int32 = 128
    var temperature: Float = 0.1
    var topK: Int32 = 40
    var topP: Float = 0.9
    var repeatPenalty: Float = 1.1
    var gpuLayers: Int32 = 999
    var useMmap: Bool = true

    init(_ payload: [String: Any]?) {
        guard let payload else { return }
        if let value = payload["n_ctx"] as? NSNumber { nCtx = value.int32Value }
        if let value = payload["n_threads"] as? NSNumber { nThreads = value.int32Value }
        if let value = payload["n_predict"] as? NSNumber { nPredict = value.int32Value }
        if let value = payload["batch_size"] as? NSNumber { batchSize = value.int32Value }
        if let value = payload["temperature"] as? NSNumber { temperature = value.floatValue }
        if let value = payload["top_k"] as? NSNumber { topK = value.int32Value }
        if let value = payload["top_p"] as? NSNumber { topP = value.floatValue }
        if let value = payload["repeat_penalty"] as? NSNumber { repeatPenalty = value.floatValue }
        if let value = payload["gpu_layers"] as? NSNumber { gpuLayers = value.int32Value }
        if let value = payload["use_mmap"] as? Bool { useMmap = value }
    }
}

/// One app-private model file plus its small state note.
final class LlamaModelStore {
    static let shared = LlamaModelStore()
    private let fileManager = FileManager.default

    var directory: URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        return base.appendingPathComponent("Dawaya/models", isDirectory: true)
    }

    var stateUrl: URL { directory.appendingPathComponent("model-state.json") }

    func ensureDirectory() throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func modelUrl(fileName: String) -> URL {
        directory.appendingPathComponent(Self.safeName(fileName), isDirectory: false)
    }

    func partUrl(fileName: String) -> URL {
        directory.appendingPathComponent(Self.safeName(fileName) + ".part", isDirectory: false)
    }

    func presentFile() -> URL? {
        guard let items = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else {
            return nil
        }
        let candidates = items.filter { $0.pathExtension.lowercased() == "gguf" }
            .sorted { ((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        return candidates.first
    }

    func state() -> [String: Any] {
        guard let data = try? Data(contentsOf: stateUrl),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return object
    }

    func save(state: [String: Any]) {
        try? ensureDirectory()
        guard let data = try? JSONSerialization.data(withJSONObject: state) else { return }
        try? data.write(to: stateUrl, options: .atomic)
    }

    static func safeName(_ value: String) -> String {
        let name = (value as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { return "model.gguf" }
        return name
    }
}

/// URLSession download with Range resume, progress events and SHA-256 verification.
final class LlamaModelDownloader: NSObject, URLSessionDataDelegate {
    static let shared = LlamaModelDownloader()

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var handle: FileHandle?
    private var fileName = "model.gguf"
    private var expectedSha = ""
    private var total = Int64(0)
    private var received = Int64(0)
    private var lastEmit = Date.distantPast
    private var emit: (([String: Any]) -> Void)?
    private var activeId: String?
    private var paused = false
    private var lastOptions: [String: Any] = [:]

    private override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 60 * 60 * 4
        config.allowsCellularAccess = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    static let allowedHosts = ["huggingface.co", "github.com"]
    static let allowedSuffixes = [".hf.co", ".githubusercontent.com"]

    static func hostAllowed(_ host: String) -> Bool {
        let value = host.lowercased()
        return allowedHosts.contains(value) || allowedSuffixes.contains { value.hasSuffix($0) }
    }

    func start(options: [String: Any], emit: @escaping ([String: Any]) -> Void) throws -> String {
        guard let raw = options["url"] as? String, let url = URL(string: raw) else {
            throw LlamaEngineError.badUrl(String(describing: options["url"] ?? ""))
        }
        guard let scheme = url.scheme?.lowercased(), scheme == "https" else {
            throw LlamaEngineError.badUrl(raw)
        }
        let host = url.host?.lowercased() ?? ""
        guard Self.hostAllowed(host) else { throw LlamaEngineError.hostNotAllowed(host) }

        cancel(removeFile: false)
        let store = LlamaModelStore.shared
        try store.ensureDirectory()
        fileName = LlamaModelStore.safeName(options["fileName"] as? String ?? "model.gguf")
        expectedSha = (options["sha256"] as? String ?? "").lowercased()
        total = (options["sizeBytes"] as? NSNumber)?.int64Value ?? 0
        let part = store.partUrl(fileName: fileName)
        if !FileManager.default.fileExists(atPath: part.path) {
            FileManager.default.createFile(atPath: part.path, contents: nil)
        }
        received = (try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? NSNumber)?.int64Value ?? 0
        self.emit = emit
        paused = false
        lastOptions = options
        activeId = "local-\(Int(Date().timeIntervalSince1970))"

        var request = URLRequest(url: url)
        /* Same shared file on iOS and macOS, so the client version comes from the bundle
           rather than a literal that falls behind every release. */
        let appVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev"
        request.setValue("Dawaya/\(appVersion) (offline medicine guide; model download)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 45
        if received > 0 {
            request.setValue("bytes=\(received)-", forHTTPHeaderField: "Range")
        }
        task = session.dataTask(with: request)
        task?.resume()
        emitEvent(["type": "download-progress", "id": activeId ?? "", "downloadedBytes": received, "totalBytes": total])
        return activeId ?? ""
    }

    func pause() {
        guard task != nil else { return }
        paused = true
        task?.cancel()
        task = nil
        try? handle?.close()
        handle = nil
        emitEvent(["type": "download-paused", "id": activeId ?? "", "downloadedBytes": received, "totalBytes": total])
    }

    func resume(options: [String: Any] = [:]) throws -> String {
        var merged = lastOptions
        for (key, value) in options { merged[key] = value }
        return try start(options: merged, emit: emit ?? { _ in })
    }

    func cancel(removeFile: Bool = true) {
        task?.cancel()
        task = nil
        try? handle?.close()
        handle = nil
        if removeFile {
            let store = LlamaModelStore.shared
            try? FileManager.default.removeItem(at: store.partUrl(fileName: fileName))
        }
        paused = false
    }

    var isActive: Bool { task != nil }

    private func emitEvent(_ event: [String: Any]) {
        guard let emit else { return }
        DispatchQueue.main.async { emit(event) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        if let finalHost = http.url?.host, !Self.hostAllowed(finalHost) {
            completionHandler(.cancel)
            emitEvent(["type": "download-error", "error": "host-not-allowed"])
            return
        }
        if http.statusCode == 206 {
            if total <= 0 {
                let range = http.value(forHTTPHeaderField: "Content-Range") ?? ""
                if let slash = range.lastIndex(of: "/"), let value = Int64(range[range.index(after: slash)...]) {
                    total = value
                }
            }
        } else if http.statusCode == 200 {
            /* The server ignored the Range header: start over instead of mixing two files. */
            received = 0
            let part = LlamaModelStore.shared.partUrl(fileName: fileName)
            try? FileManager.default.removeItem(at: part)
            FileManager.default.createFile(atPath: part.path, contents: nil)
            if total <= 0 { total = http.expectedContentLength }
        } else {
            completionHandler(.cancel)
            emitEvent(["type": "download-error", "error": "http-\(http.statusCode)"])
            return
        }
        let part = LlamaModelStore.shared.partUrl(fileName: fileName)
        handle = try? FileHandle(forWritingTo: part)
        try? handle?.seekToEnd()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let handle else { return }
        try? handle.write(contentsOf: data)
        received += Int64(data.count)
        let now = Date()
        if now.timeIntervalSince(lastEmit) > 0.4 {
            lastEmit = now
            emitEvent(["type": "download-progress", "id": activeId ?? "", "downloadedBytes": received, "totalBytes": total])
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        self.task = nil
        if paused {
            paused = false
            return
        }
        if let error {
            let code = (error as NSError).code
            if code == NSURLErrorCancelled { return }
            emitEvent(["type": "download-error", "error": error.localizedDescription])
            return
        }
        let store = LlamaModelStore.shared
        let part = store.partUrl(fileName: fileName)
        let final = store.modelUrl(fileName: fileName)
        do {
            try? FileManager.default.removeItem(at: final)
            try FileManager.default.moveItem(at: part, to: final)
            let size = (try? FileManager.default.attributesOfItem(atPath: final.path)[.size] as? NSNumber)?.int64Value ?? received
            var state = store.state()
            state["fileName"] = fileName
            state["sizeBytes"] = size
            state["sha256"] = expectedSha
            state["checksumVerified"] = false
            state["downloadedAt"] = ISO8601DateFormatter().string(from: Date())
            store.save(state: state)
            emitEvent(["type": "download-completed", "id": activeId ?? "", "sizeBytes": size, "fileName": fileName])
        } catch {
            emitEvent(["type": "download-error", "error": "move-failed"])
        }
    }

    static func sha256(url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1 << 20) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// In-process llama.cpp runtime used by the macOS app and the iOS plugin.
final class LlamaEngine {
    static let shared = LlamaEngine()

    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var vocab: OpaquePointer?
    private let lock = NSLock()
    private var cancelRequested = false
    private var activeRequest: String?
    private var loadedAt: Date?
    /// Leading tokens of the last prompt whose keys and values are still in the cache.
    private var cachedTokens: [llama_token] = []

    /// Below this the shared block is too small to be worth a second call into the cache.
    private static let minCachedTokens = 32

    private init() {}

    // MARK: capabilities / status

    func capabilities() -> [String: Any] {
        let memory = ProcessInfo.processInfo.physicalMemory
        let cores = ProcessInfo.processInfo.activeProcessorCount
        var storage: Int64 = 0
        if let values = try? LlamaModelStore.shared.directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]) {
            storage = values.volumeAvailableCapacityForImportantUsage ?? 0
        }
        return [
            "supported": true,
            "backends": ["metal", "cpu"],
            "totalRamBytes": Int64(memory),
            "freeRamBytes": Int64(memory / 2),
            "cores": cores,
            "storageBytes": storage
        ]
    }

    func status() -> [String: Any] {
        let store = LlamaModelStore.shared
        let state = store.state()
        let file = store.presentFile()
        let size = file.flatMap { (try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 } ?? 0
        let lineState: String
        lock.lock()
        let isLoaded = model != nil
        lock.unlock()
        if isLoaded { lineState = "loaded" }
        else if file != nil { lineState = "downloaded" }
        else { lineState = "not-downloaded" }
        return [
            "state": lineState,
            "present": file != nil,
            "fileName": file?.lastPathComponent ?? (state["fileName"] as? String ?? ""),
            "sizeBytes": size,
            "downloadedBytes": size,
            "checksumVerified": state["checksumVerified"] as? Bool ?? false,
            "path": file?.path ?? ""
        ]
    }

    func verify(sha: String) -> [String: Any] {
        let store = LlamaModelStore.shared
        guard let file = store.presentFile() else { return ["ok": false, "error": "model-missing"] }
        guard let digest = try? LlamaModelDownloader.sha256(url: file) else {
            return ["ok": false, "error": "checksum-read-failed"]
        }
        let expected = sha.lowercased()
        let ok = expected.isEmpty || digest == expected
        var state = store.state()
        state["checksumVerified"] = ok
        state["sha256"] = digest
        store.save(state: state)
        return ["ok": ok, "sha256": digest]
    }

    func deleteModel() -> [String: Any] {
        unload()
        let store = LlamaModelStore.shared
        if let file = store.presentFile() { try? FileManager.default.removeItem(at: file) }
        if let items = try? FileManager.default.contentsOfDirectory(at: store.directory, includingPropertiesForKeys: nil) {
            for item in items where item.pathExtension == "part" { try? FileManager.default.removeItem(at: item) }
        }
        store.save(state: ["deleted": true])
        return ["ok": true]
    }

    func importCopy(from url: URL, expectingSha sha: String) -> [String: Any] {
        let store = LlamaModelStore.shared
        do {
            try store.ensureDirectory()
            let target = store.modelUrl(fileName: url.lastPathComponent)
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.copyItem(at: url, to: target)
            let size = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.int64Value ?? 0
            let digest = (try? LlamaModelDownloader.sha256(url: target)) ?? ""
            let verified = !sha.isEmpty && digest == sha.lowercased()
            if !verified {
                try? FileManager.default.removeItem(at: target)
                return ["ok": false, "error": "checksum-failed", "checksumVerified": false]
            }
            var state = store.state()
            state["fileName"] = target.lastPathComponent
            state["sizeBytes"] = size
            state["checksumVerified"] = true
            state["imported"] = true
            state["sha256"] = digest
            store.save(state: state)
            return ["ok": true, "fileName": target.lastPathComponent, "sizeBytes": size, "checksumVerified": true]
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    // MARK: load / unload

    func load(params payload: [String: Any]?) -> [String: Any] {
        lock.lock()
        if model != nil {
            lock.unlock()
            return ["ok": true, "already": true]
        }
        lock.unlock()
        let params = LlamaGenerationParams(payload)
        let store = LlamaModelStore.shared
        let state = store.state()
        guard let file = store.presentFile() else { return ["ok": false, "error": "model-missing"] }
        if state["checksumVerified"] as? Bool != true {
            return ["ok": false, "error": "model-unverified"]
        }
        let started = Date()
        var modelParams = llama_model_default_params()
        modelParams.load_mode = params.useMmap ? LLAMA_LOAD_MODE_MMAP : LLAMA_LOAD_MODE_NONE
        modelParams.n_gpu_layers = params.gpuLayers
        guard let loaded = llama_model_load_from_file(file.path, modelParams) else {
            return ["ok": false, "error": "load-failed"]
        }
        guard let loadedVocab = llama_model_get_vocab(loaded) else {
            llama_model_free(loaded)
            return ["ok": false, "error": "vocab-missing"]
        }
        var ctxParams = llama_context_default_params()
        ctxParams.n_ctx = UInt32(params.nCtx)
        ctxParams.n_batch = UInt32(max(params.batchSize, 32))
        ctxParams.n_threads = params.nThreads
        ctxParams.n_threads_batch = params.nThreads
        guard let ctx = llama_init_from_model(loaded, ctxParams) else {
            llama_model_free(loaded)
            return ["ok": false, "error": "context-failed"]
        }
        lock.lock()
        model = loaded
        vocab = loadedVocab
        context = ctx
        loadedAt = Date()
        cachedTokens = []
        lock.unlock()
        return ["ok": true, "loadMs": Int(Date().timeIntervalSince(started) * 1000), "backend": "metal/cpu"]
    }

    func unload() {
        lock.lock()
        let ctx = context
        let modelPtr = model
        context = nil
        vocab = nil
        model = nil
        loadedAt = nil
        cachedTokens = []
        lock.unlock()
        if let ctx {
            llama_free(ctx)
        }
        if let modelPtr {
            llama_model_free(modelPtr)
        }
    }

    func cancel(requestId: String?) {
        lock.lock()
        if requestId == nil || requestId == activeRequest {
            cancelRequested = true
        }
        lock.unlock()
    }

    // MARK: generation

    /// Blocking token loop. The caller runs this on a background queue.
    func generate(requestId: String, prompt: String, params: LlamaGenerationParams, onToken: (String) -> Void) -> [String: Any] {
        lock.lock()
        guard let ctx = context, let vocab = vocab else {
            lock.unlock()
            return ["error": "model-not-loaded", "text": ""]
        }
        cancelRequested = false
        activeRequest = requestId
        lock.unlock()

        defer {
            lock.lock()
            activeRequest = nil
            lock.unlock()
        }

        let rendered = Self.chatml(prompt)
        var tokens = [llama_token](repeating: 0, count: max(64, rendered.utf8.count + 16))
        let count = rendered.withCString { pointer in
            llama_tokenize(vocab, pointer, Int32(rendered.utf8.count), &tokens, Int32(tokens.count), true, true)
        }
        guard count > 0 else { return ["error": "tokenize-failed", "text": ""] }
        if count > tokens.count { return ["error": "prompt-too-long", "text": ""] }
        tokens.removeLast(tokens.count - Int(count))

        let started = Date()
        var output = ""
        var produced = 0
        var pieceBuffer = [CChar](repeating: 0, count: 512)

        /* The system rules and the retrieved records are usually the whole front of the
           prompt and the reader's follow-up only changes the end of it, so the cache is
           rewound to the last token the two prompts have in common and just the new tail
           is decoded. One token is always re-read because that is what the sampler takes
           its next distribution from. */
        var shared = 0
        while shared < min(cachedTokens.count, tokens.count - 1), cachedTokens[shared] == tokens[shared] {
            shared += 1
        }
        let memory = llama_get_memory(ctx)
        var reuse = 0
        if shared >= Self.minCachedTokens, let memory, llama_memory_seq_rm(memory, 0, llama_pos(shared), -1) {
            reuse = shared
        } else if let memory {
            llama_memory_clear(memory, true)
        }

        if tokens.count > reuse {
            var tail = Array(tokens[reuse...])
            if llama_decode(ctx, llama_batch_get_one(&tail, Int32(tail.count))) != 0 {
                lock.lock()
                cachedTokens = []
                lock.unlock()
                return ["error": "decode-failed", "text": ""]
            }
        }
        lock.lock()
        cachedTokens = tokens
        lock.unlock()

        var chainParams = llama_sampler_chain_default_params()
        chainParams.no_perf = true
        let sampler = llama_sampler_chain_init(chainParams)
        llama_sampler_chain_add(sampler, llama_sampler_init_penalties(
            llama_vocab_n_tokens(vocab), 64, params.repeatPenalty, 0, 0))
        llama_sampler_chain_add(sampler, llama_sampler_init_top_k(params.topK))
        llama_sampler_chain_add(sampler, llama_sampler_init_top_p(params.topP, 1))
        llama_sampler_chain_add(sampler, llama_sampler_init_temp(params.temperature))
        llama_sampler_chain_add(sampler, llama_sampler_init_dist(UInt32.random(in: 1...UInt32.max)))
        defer { llama_sampler_free(sampler) }

        while produced < Int(params.nPredict) {
            lock.lock()
            let stop = cancelRequested
            lock.unlock()
            if stop { break }
            let token = llama_sampler_sample(sampler, ctx, -1)
            if llama_vocab_is_eog(vocab, token) { break }
            let length = llama_token_to_piece(vocab, token, &pieceBuffer, Int32(pieceBuffer.count), 0, true)
            if length > 0 {
                let piece = String(decoding: pieceBuffer[0..<Int(length)].map { UInt8(bitPattern: $0) }, as: UTF8.self)
                if piece.contains("<|im_end|>") {
                    let head = piece.components(separatedBy: "<|im_end|>").first ?? ""
                    if !head.isEmpty { output += head; onToken(head) }
                    break
                }
                output += piece
                onToken(piece)
            }
            produced += 1
            var next = token
            if llama_decode(ctx, llama_batch_get_one(&next, 1)) != 0 { break }
        }

        /* The prompt is left in the cache rather than dropped here: the next turn rewinds
           to the part the two prompts share. The answer tokens after it are discarded by
           that same rewind, and the context never grows past one prompt plus one answer. */
        let cancelled = cancelRequested
        return [
            "text": output,
            "tokens": produced,
            "milliseconds": Int(Date().timeIntervalSince(started) * 1000),
            "cancelled": cancelled
        ]
    }

    /// Qwen2.5-Instruct ships ChatML; the prompt already carries every instruction.
    static func chatml(_ prompt: String) -> String {
        "<|im_start|>system\nYou answer only from the reference data the user supplies.<|im_end|>\n<|im_start|>user\n\(prompt)<|im_end|>\n<|im_start|>assistant\n"
    }
}
