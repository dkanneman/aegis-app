import Foundation
import HealthKit
import Security

struct PepperHealthBridgeMember: Equatable {
    let id: String
    let name: String
}

struct PepperHealthSnapshot: Equatable {
    let metricDate: String
    let stepCount: Int
    let activeMinutes: Int
    let syncedAt: Date
}

enum PepperHealthBridgePhase: Equatable {
    case ready
    case authorizing
    case reading
    case uploading
    case synced
    case failed(String)
}

@MainActor
final class PepperHealthBridgeStore: ObservableObject {
    @Published private(set) var member: PepperHealthBridgeMember?
    @Published private(set) var snapshot: PepperHealthSnapshot?
    @Published private(set) var phase: PepperHealthBridgePhase = .ready
    @Published private(set) var isPaired = false

    private let healthStore = HKHealthStore()
    private let pairingVault = PepperHealthPairingVault()

    var isBusy: Bool {
        switch phase {
        case .authorizing, .reading, .uploading:
            return true
        case .ready, .synced, .failed:
            return false
        }
    }

    func activate(for member: PepperHealthBridgeMember) {
        if self.member?.id != member.id {
            snapshot = nil
            phase = .ready
        }
        self.member = member
        isPaired = pairingVault.read(for: member.id) != nil
    }

    @discardableResult
    func synchronize(
        sessionProvider: () async throws -> String
    ) async -> PepperHealthSnapshot? {
        guard let member, !isBusy else { return nil }

        do {
            guard HKHealthStore.isHealthDataAvailable() else {
                throw PepperHealthBridgeError.healthUnavailable
            }

            phase = .authorizing
            let stepsType = HKQuantityType(.stepCount)
            let exerciseType = HKQuantityType(.appleExerciseTime)
            let types: Set<HKObjectType> = [stepsType, exerciseType]
            try await requestHealthAuthorization(reading: types)

            phase = .reading
            let now = Date()
            let start = Calendar.current.startOfDay(for: now)
            async let steps = cumulativeValue(
                for: stepsType,
                unit: .count(),
                from: start,
                to: now
            )
            async let activeMinutes = cumulativeValue(
                for: exerciseType,
                unit: .minute(),
                from: start,
                to: now
            )
            let values = try await (steps, activeMinutes)
            let metricDate = Self.metricDateFormatter.string(from: now)
            let dailySnapshot = PepperHealthSnapshot(
                metricDate: metricDate,
                stepCount: max(0, Int(values.0.rounded())),
                activeMinutes: max(0, Int(values.1.rounded())),
                syncedAt: now
            )

            var pairing = try await pairing(
                for: member,
                sessionProvider: sessionProvider
            )
            phase = .uploading
            do {
                try await upload(dailySnapshot, with: pairing)
            } catch PepperHealthBridgeError.pairingExpired {
                pairingVault.remove(for: member.id)
                pairing = try await createPairing(
                    for: member,
                    sessionProvider: sessionProvider
                )
                try await upload(dailySnapshot, with: pairing)
            }

            snapshot = dailySnapshot
            isPaired = true
            phase = .synced
            return dailySnapshot
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? "Pepper could not sync Apple Health. Try again."
            phase = .failed(message)
            return nil
        }
    }

    private func pairing(
        for member: PepperHealthBridgeMember,
        sessionProvider: () async throws -> String
    ) async throws -> PepperHealthPairing {
        if let stored = pairingVault.read(for: member.id) {
            guard isTrustedIngestURL(stored.ingestURL) else {
                pairingVault.remove(for: member.id)
                throw PepperHealthBridgeError.untrustedEndpoint
            }
            return stored
        }
        return try await createPairing(for: member, sessionProvider: sessionProvider)
    }

    private func createPairing(
        for member: PepperHealthBridgeMember,
        sessionProvider: () async throws -> String
    ) async throws -> PepperHealthPairing {
        let sessionToken = try await sessionProvider()
        guard UUID(uuidString: sessionToken) != nil else {
            throw PepperHealthBridgeError.sessionRequired
        }

        let url = PepperConfiguration.familyAPIURL
        guard
            url.scheme == "https",
            url.host == PepperConfiguration.healthHost,
            url.path == "/functions/v1/pepper-family-api"
        else { throw PepperHealthBridgeError.untrustedEndpoint }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(PepperConfiguration.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue(
            "Bearer \(PepperConfiguration.supabaseAnonKey)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(sessionToken, forHTTPHeaderField: "x-pepper-session")
        request.httpBody = try JSONEncoder().encode(PepperHealthPairRequest())

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PepperHealthBridgeError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw PepperHealthBridgeError.server(
                Self.serverMessage(from: data) ?? "Pepper could not pair Apple Health."
            )
        }

        let result = try JSONDecoder().decode(PepperHealthPairResponse.self, from: data)
        guard
            result.ok == true,
            result.pairingToken.count >= 32,
            result.memberID == member.id,
            let ingestURL = URL(string: result.ingestURL),
            isTrustedIngestURL(ingestURL)
        else { throw PepperHealthBridgeError.invalidResponse }

        let pairing = PepperHealthPairing(
            memberID: member.id,
            memberName: result.memberName,
            token: result.pairingToken,
            ingestURL: ingestURL
        )
        try pairingVault.store(pairing)
        isPaired = true
        return pairing
    }

    private func requestHealthAuthorization(reading types: Set<HKObjectType>) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            healthStore.requestAuthorization(toShare: [], read: types) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if success {
                    continuation.resume(returning: ())
                } else {
                    continuation.resume(throwing: PepperHealthBridgeError.authorizationFailed)
                }
            }
        }
    }

    private func cumulativeValue(
        for type: HKQuantityType,
        unit: HKUnit,
        from start: Date,
        to end: Date
    ) async throws -> Double {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(
                withStart: start,
                end: end,
                options: .strictStartDate
            )
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(
                    returning: statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0
                )
            }
            healthStore.execute(query)
        }
    }

    private func upload(
        _ snapshot: PepperHealthSnapshot,
        with pairing: PepperHealthPairing
    ) async throws {
        guard isTrustedIngestURL(pairing.ingestURL) else {
            throw PepperHealthBridgeError.untrustedEndpoint
        }

        var request = URLRequest(url: pairing.ingestURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(pairing.token, forHTTPHeaderField: "x-pepper-health-token")
        request.httpBody = try JSONEncoder().encode(
            PepperHealthUpload(
                metricDate: snapshot.metricDate,
                stepCount: snapshot.stepCount,
                activeMinutes: snapshot.activeMinutes
            )
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PepperHealthBridgeError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            throw PepperHealthBridgeError.pairingExpired
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw PepperHealthBridgeError.server(
                Self.serverMessage(from: data) ?? "Pepper could not store today's health summary."
            )
        }
    }

    private func isTrustedIngestURL(_ url: URL) -> Bool {
        guard
            url.scheme == "https",
            let host = url.host,
            host == PepperConfiguration.healthHost
        else { return false }
        return url.path == "/functions/v1/pepper-health-ingest"
    }

    private static func serverMessage(from data: Data) -> String? {
        (try? JSONDecoder().decode(PepperHealthErrorResponse.self, from: data))?.error
    }

    private static let metricDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

private struct PepperHealthPairRequest: Encodable {
    let action = "health_pair"
    let client = "native_ios"
}

private struct PepperHealthPairResponse: Decodable {
    let ok: Bool?
    let pairingToken: String
    let ingestURL: String
    let memberID: String
    let memberName: String

    enum CodingKeys: String, CodingKey {
        case ok
        case pairingToken = "pairing_token"
        case ingestURL = "ingest_url"
        case memberID = "member_id"
        case memberName = "member_name"
    }
}

private struct PepperHealthUpload: Encodable {
    let metricDate: String
    let stepCount: Int
    let activeMinutes: Int

    enum CodingKeys: String, CodingKey {
        case metricDate = "metric_date"
        case stepCount = "step_count"
        case activeMinutes = "active_minutes"
    }
}

private struct PepperHealthErrorResponse: Decodable {
    let error: String
}

private struct PepperHealthPairing: Codable {
    let memberID: String
    let memberName: String
    let token: String
    let ingestURL: URL
}

private final class PepperHealthPairingVault {
    private let service = "com.dkanneman.pepper.health-bridge.pairing"

    func read(for memberID: String) -> PepperHealthPairing? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: memberID,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ] as CFDictionary, &result)
        guard
            status == errSecSuccess,
            let data = result as? Data,
            let pairing = try? JSONDecoder().decode(PepperHealthPairing.self, from: data),
            pairing.memberID == memberID
        else { return nil }
        return pairing
    }

    func store(_ pairing: PepperHealthPairing) throws {
        let data = try JSONEncoder().encode(pairing)
        let query = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pairing.memberID,
        ] as CFDictionary
        let attributes = [kSecValueData as String: data] as CFDictionary
        let updateStatus = SecItemUpdate(query, attributes)

        if updateStatus == errSecItemNotFound {
            let addStatus = SecItemAdd([
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: pairing.memberID,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                kSecValueData as String: data,
            ] as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw PepperHealthBridgeError.keychain(addStatus)
            }
            return
        }

        guard updateStatus == errSecSuccess else {
            throw PepperHealthBridgeError.keychain(updateStatus)
        }
    }

    func remove(for memberID: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: memberID,
        ] as CFDictionary)
    }
}

private enum PepperHealthBridgeError: LocalizedError {
    case healthUnavailable
    case authorizationFailed
    case sessionRequired
    case invalidResponse
    case pairingExpired
    case untrustedEndpoint
    case keychain(OSStatus)
    case server(String)

    var errorDescription: String? {
        switch self {
        case .healthUnavailable:
            return "Apple Health is not available on this iPhone."
        case .authorizationFailed:
            return "Apple Health access was not approved. Open Health permissions and try again."
        case .sessionRequired:
            return "Unlock your Pepper profile before connecting Apple Health."
        case .invalidResponse:
            return "Pepper could not verify the Health Bridge response. Try again."
        case .pairingExpired:
            return "This Health Bridge pairing expired. Unlock Pepper and reconnect."
        case .untrustedEndpoint:
            return "Pepper blocked an unverified Health Bridge endpoint."
        case let .keychain(status):
            return "Pepper could not secure the Health Bridge pairing (\(status))."
        case let .server(message):
            return message
        }
    }
}
