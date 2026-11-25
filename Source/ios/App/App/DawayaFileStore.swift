import Foundation
import UniformTypeIdentifiers

enum DawayaFileError: LocalizedError {
    case invalidPayload
    case emptyFile
    case unavailableDirectory

    var errorDescription: String? {
        switch self {
        case .invalidPayload:
            return "The file data was invalid."
        case .emptyFile:
            return "The file was empty."
        case .unavailableDirectory:
            return "The Downloads folder could not be created."
        }
    }
}

/// All user-visible downloads live in `Documents/Downloads`.
///
/// The app sandbox is intentionally private: `UIFileSharingEnabled` and
/// `LSSupportsOpeningDocumentsInPlace` are off, so neither the Files app nor
/// iTunes/Finder transfer can browse this folder. Anything the user wants to
/// hand over leaves through the share sheet, on an explicit tap.
enum DawayaFileStore {
    static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static var downloadsDirectory: URL {
        let directory = documentsDirectory.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Anything the user exported is not patient data, but it must not ride along in
        // an iCloud/iTunes backup either: it can be regenerated from the app.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = directory
        try? mutable.setResourceValues(values)
        return directory
    }

    static func sanitizedFilename(_ raw: String, fallback: String = "Dawaya file") -> String {
        let lastPathComponent = (raw as NSString).lastPathComponent
        var name = lastPathComponent
            .components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|\u{0000}"))
            .joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while name.hasPrefix(".") {
            name.removeFirst()
        }
        if name.isEmpty {
            name = fallback
        }
        if name.count > 120 {
            let ext = (name as NSString).pathExtension
            let stem = (name as NSString).deletingPathExtension
            let shortened = String(stem.prefix(max(1, 110 - ext.count)))
            name = ext.isEmpty ? shortened : "\(shortened).\(ext)"
        }
        return name
    }

    static func uniqueURL(filename: String, in directory: URL? = nil) -> URL {
        let folder = directory ?? downloadsDirectory
        let safeName = sanitizedFilename(filename)
        let pathExtension = (safeName as NSString).pathExtension
        let stem = (safeName as NSString).deletingPathExtension
        var candidate = folder.appendingPathComponent(safeName)
        var index = 2

        while FileManager.default.fileExists(atPath: candidate.path) {
            let nextName = pathExtension.isEmpty ? "\(stem) \(index)" : "\(stem) \(index).\(pathExtension)"
            candidate = folder.appendingPathComponent(nextName)
            index += 1
        }
        return candidate
    }

    static func saveBase64(_ base64: String, filename: String, mimeType: String) throws -> URL {
        guard let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]) else {
            throw DawayaFileError.invalidPayload
        }
        guard !data.isEmpty else { throw DawayaFileError.emptyFile }

        var name = filename
        if (name as NSString).pathExtension.isEmpty,
           let type = UTType(mimeType: mimeType),
           let preferredExtension = type.preferredFilenameExtension {
            name += ".\(preferredExtension)"
        }

        guard FileManager.default.isWritableFile(atPath: downloadsDirectory.path) ||
                FileManager.default.fileExists(atPath: downloadsDirectory.path) else {
            throw DawayaFileError.unavailableDirectory
        }

        let destination = uniqueURL(filename: name)
        try data.write(to: destination, options: .atomic)
        return destination
    }
}
