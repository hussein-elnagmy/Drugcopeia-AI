//
//  PhotoReader.swift
//  Dawaya on-device pack photograph reader (macOS + iOS).
//
//  The assistant's model is text-only, so a photograph cannot be handed to it. This is
//  the route that does help: the operating system's own vision framework reads the
//  barcode printed on the pack and, next to it, the words, and the page matches what
//  comes back against the medicine directory already on the device.
//
//  Nothing is uploaded and nothing is stored. The picture is decoded in memory, read
//  once and dropped when this call returns.
//

import CoreGraphics
import Foundation
import ImageIO
import Vision

enum PhotoReader {
    /// Both shell languages, so an Arabic label reads as well as an English one.
    static let languages = ["en-US", "ar"]

    /// `data` is the encoded image the page sent. The result mirrors the contract in
    /// `webapp/ai/photo-ask.js`: `codes` for the barcode route, `text` for the printed
    /// words, and `error` when the picture could not be decoded at all.
    static func read(data: Data, languages: [String] = languages) -> [String: Any] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return ["error": "image-decode-failed", "codes": [], "text": ""]
        }
        let barcodeRequest = VNDetectBarcodesRequest()
        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .accurate
        textRequest.usesLanguageCorrection = true
        textRequest.recognitionLanguages = languages
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([barcodeRequest, textRequest])
        } catch {
            return ["error": "vision-failed", "codes": [], "text": ""]
        }

        var codes: [[String: String]] = []
        var seen = Set<String>()
        for observation in barcodeRequest.results ?? [] {
            let value = String((observation.payloadStringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
            guard value.count >= 4, !seen.contains(value) else { continue }
            seen.insert(value)
            codes.append(["rawValue": value, "symbology": symbology(observation.symbology)])
        }

        /* Half-read words on a blurry label become brand names that do not exist, so a
           line only counts when the reader is confident about the whole line. The
           request-level threshold is not in every SDK this file builds against, so the
           cutoff is applied to the candidates instead. */
        var lines: [String] = []
        for observation in textRequest.results ?? [] {
            guard let best = observation.topCandidates(1).first, best.confidence >= minimumConfidence else { continue }
            let value = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { lines.append(value) }
        }

        return ["codes": codes, "text": lines.joined(separator: "\n"), "lines": lines.count]
    }

    /// Below this a recognised line is treated as noise.
    private static let minimumConfidence: Float = 0.45

    private static func symbology(_ value: VNBarcodeSymbology) -> String {
        return value.rawValue.lowercased()
    }
}
