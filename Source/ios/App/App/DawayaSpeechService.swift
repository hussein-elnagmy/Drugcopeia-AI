import AVFoundation
import UIKit

/// Native text-to-speech for the medicine “listen” buttons.
///
/// The web layer treats `DawayaNative.speak` as fire-and-forget. When playback
/// ends on its own we must call back into JS (`DawayaCore.speech.notify('end')`)
/// so the speaker button returns to its idle state. Explicit stops are already
/// reflected by the web controller, so they never emit an extra end event.
final class DawayaSpeechService: NSObject, AVSpeechSynthesizerDelegate {
    /// Called on the main queue only after an utterance finishes naturally.
    var onFinish: (() -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private var isStopping = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    var isSpeaking: Bool {
        synthesizer.isSpeaking || synthesizer.isPaused
    }

    func speak(text: String, language: String, rate: Float) {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        stop()
        activateAudioSession()

        let utterance = AVSpeechUtterance(string: String(content.prefix(4000)))
        utterance.voice = Self.voice(for: language)
        utterance.rate = Self.mappedRate(rate)
        utterance.pitchMultiplier = 1
        utterance.volume = 1
        synthesizer.speak(utterance)
    }

    func stop() {
        guard synthesizer.isSpeaking || synthesizer.isPaused else { return }
        isStopping = true
        synthesizer.stopSpeaking(at: .immediate)
        DispatchQueue.main.async { [weak self] in
            self?.isStopping = false
            self?.deactivateAudioSession()
        }
    }

    func stopForBackground() {
        guard synthesizer.isSpeaking || synthesizer.isPaused else { return }
        stop()
        deactivateAudioSession()
    }

    // MARK: - AVSpeechSynthesizerDelegate

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard !isStopping else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isStopping else { return }
            self.deactivateAudioSession()
            self.onFinish?()
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        // A cancel is always the result of an explicit stop or an interruption;
        // the web already knows how to handle that state.
        deactivateAudioSession()
    }

    // MARK: - Audio session

    private func activateAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            // Speech still works without a customised session in most cases.
            NSLog("[Dawaya] Could not activate audio session for speech: \(error.localizedDescription)")
        }
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    // MARK: - Voice and rate mapping

    /// Picks the best installed voice for the language, falling back to the
    /// closest regional variant. iOS ships Arabic voices on all supported
    /// versions, so spoken medicine names work out of the box.
    static func voice(for language: String) -> AVSpeechSynthesisVoice? {
        let normalized = language.replacingOccurrences(of: "_", with: "-")
        if let exact = AVSpeechSynthesisVoice(language: normalized) {
            return exact
        }

        let code = String(normalized.prefix(2)).lowercased()
        let fallback: String
        switch code {
        case "ar": fallback = "ar-SA"
        case "en": fallback = "en-US"
        default: fallback = normalized
        }
        if let voice = AVSpeechSynthesisVoice(language: fallback) {
            return voice
        }
        return AVSpeechSynthesisVoice.speechVoices().first {
            $0.language.lowercased().hasPrefix(code)
        }
    }

    /// The web passes values around 0.95 (1 = normal). AVSpeechUtterance uses a
    /// different 0…1 scale where 0.5 is the system default, so a small bias keeps
    /// long medicine explanations comfortable to listen to.
    static func mappedRate(_ rate: Float) -> Float {
        let clamped = min(max(CGFloat(rate), 0.5), 1.4)
        let mapped = AVSpeechUtteranceDefaultSpeechRate * Float(clamped) * 1.05
        return min(max(mapped, 0.35), 0.72)
    }
}
