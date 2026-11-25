import Foundation
import Security

enum DawayaSecureStoreError: LocalizedError {
    case keyNotAllowed
    case valueTooLarge
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case .keyNotAllowed:
            return "This key may not be stored in the secure store."
        case .valueTooLarge:
            return "The value is too large for the secure store."
        case .status(let status):
            return "The secure store is unavailable (\(status))."
        }
    }
}

/// Keychain-backed storage for anything the user typed that reveals their
/// health: custom drugs, reminders and the taken-log.
///
/// The key list is `storage.localUserDataKeys` from `privacy.config.json`;
/// `scripts/privacy-check.py` asserts they match, and a write for any other key
/// is rejected rather than silently falling back to plaintext.
///
/// Items are written with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so
/// they are never included in an iCloud or Mac backup and never migrated to
/// another device, and `kSecUseDataProtectionKeychain` is used instead of the
/// legacy file-based keychain. The access group is deliberately nil: items stay
/// inside this app's default keychain group.
enum DawayaSecureStore {
    static let service = "com.dawaya.medicineguide.secure"

    /// `storage.localUserDataKeys` from privacy.config.json.
    static let allowedKeys: Set<String> = [
        "dawaya-reminders-v1",
        "dawaya-reminder-taken-v1",
        "dawaya-custom-drugs-v1",
        "dawaya-ai-chat-v1",
        "dawaya-calc-history",
        "dawaya-study-stats"
    ]

    /// Keychain items are meant to be small; reminders/history JSON stays far
    /// below this in practice.
    static let maximumValueBytes = 512 * 1024

    static func allows(_ key: String) -> Bool {
        allowedKeys.contains(key)
    }

    /// A generic-password item with nothing but the service and the key set, so
    /// one account name maps to exactly one value.
    private static func query(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecUseDataProtectionKeychain as String: true
        ]
    }

    /// True when the keychain itself can be read, i.e. the device has been
    /// unlocked at least once since boot.
    static var isAvailable: Bool {
        var probe = query(for: "dawaya-availability-probe")
        probe[kSecReturnAttributes as String] = true
        probe[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(probe as CFDictionary, &result)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Returns the stored value, or nil when nothing is stored for the key.
    static func read(_ key: String) throws -> String? {
        guard allows(key) else { throw DawayaSecureStoreError.keyNotAllowed }
        var lookup = query(for: key)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        switch status {
        case errSecItemNotFound:
            return nil
        case errSecSuccess:
            guard let data = result as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        default:
            throw DawayaSecureStoreError.status(status)
        }
    }

    static func write(_ key: String, value: String) throws {
        guard allows(key) else { throw DawayaSecureStoreError.keyNotAllowed }
        let data = Data(value.utf8)
        guard data.count <= maximumValueBytes else { throw DawayaSecureStoreError.valueTooLarge }

        var attributes = query(for: key)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecDuplicateItem else {
            if status == errSecSuccess { return }
            throw DawayaSecureStoreError.status(status)
        }

        let update: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query(for: key) as CFDictionary, update as CFDictionary)
        guard updateStatus == errSecSuccess else {
            throw DawayaSecureStoreError.status(updateStatus)
        }
    }

    static func clear(_ key: String) throws {
        guard allows(key) else { throw DawayaSecureStoreError.keyNotAllowed }
        let status = SecItemDelete(query(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DawayaSecureStoreError.status(status)
        }
    }

    /// Deletes every item this app has stored under its secure service.
    static func clearAll() throws {
        let status = SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true
        ] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DawayaSecureStoreError.status(status)
        }
    }
}
