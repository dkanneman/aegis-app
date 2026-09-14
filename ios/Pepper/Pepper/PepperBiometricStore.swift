import Foundation
import LocalAuthentication
import Security

struct PepperBiometricEnrollment: Equatable {
    let memberName: String
}

enum PepperBiometricStoreError: LocalizedError {
    case unavailable
    case invalidCredential
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Face ID is not available. Check Face ID and your device passcode, then try again."
        case .invalidCredential:
            return "Pepper could not read the saved Face ID session. Sign in with your PIN again."
        case let .keychain(status):
            return "Pepper could not update the secure iPhone Keychain (\(status))."
        }
    }
}

final class PepperBiometricStore {
    private let account = "current-member"
    private let credentialService = "com.dkanneman.pepper.face-id.session"
    private let enrollmentService = "com.dkanneman.pepper.face-id.enrollment"

    var enrollment: PepperBiometricEnrollment? {
        guard
            let data = readUnprotected(service: enrollmentService),
            let memberName = String(data: data, encoding: .utf8),
            !memberName.isEmpty
        else { return nil }
        return PepperBiometricEnrollment(memberName: memberName)
    }

    func enroll(sessionToken: String, memberName: String) async throws {
        guard UUID(uuidString: sessionToken) != nil else {
            throw PepperBiometricStoreError.invalidCredential
        }

        let context = try biometricContext()
        try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Use Face ID to unlock Pepper."
        )

        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            if let accessError {
                throw accessError.takeRetainedValue()
            }
            throw PepperBiometricStoreError.unavailable
        }

        delete(service: credentialService)
        let credentialStatus = SecItemAdd([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: account,
            kSecAttrAccessControl as String: accessControl,
            kSecValueData as String: Data(sessionToken.utf8),
        ] as CFDictionary, nil)
        guard credentialStatus == errSecSuccess else {
            throw PepperBiometricStoreError.keychain(credentialStatus)
        }

        do {
            try writeEnrollment(memberName: memberName)
        } catch {
            delete(service: credentialService)
            throw error
        }
    }

    func unlock() async throws -> String {
        let context = try biometricContext()
        try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Unlock Pepper."
        )

        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
        ] as CFDictionary, &result)
        guard status == errSecSuccess else {
            throw status == errSecItemNotFound
                ? PepperBiometricStoreError.invalidCredential
                : PepperBiometricStoreError.keychain(status)
        }
        guard
            let data = result as? Data,
            let sessionToken = String(data: data, encoding: .utf8),
            UUID(uuidString: sessionToken) != nil
        else { throw PepperBiometricStoreError.invalidCredential }
        return sessionToken
    }

    func remove() {
        delete(service: credentialService)
        delete(service: enrollmentService)
    }

    private func biometricContext() throws -> LAContext {
        let context = LAContext()
        context.localizedCancelTitle = "Use PIN"
        var error: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        ) else { throw error ?? PepperBiometricStoreError.unavailable }
        return context
    }

    private func writeEnrollment(memberName: String) throws {
        delete(service: enrollmentService)
        let cleanName = String(memberName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        let status = SecItemAdd([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: enrollmentService,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(cleanName.utf8),
        ] as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw PepperBiometricStoreError.keychain(status)
        }
    }

    private func readUnprotected(service: String) -> Data? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ] as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private func delete(service: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}
