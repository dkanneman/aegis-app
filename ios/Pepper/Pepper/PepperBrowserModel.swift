import AuthenticationServices
import Foundation
import LocalAuthentication
import UIKit
import WebKit

@MainActor
final class PepperBrowserModel: NSObject, ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published private(set) var isBiometricLocked: Bool
    @Published private(set) var isBiometricBusy = false
    @Published private(set) var biometricMemberName: String
    @Published private(set) var biometricErrorMessage: String?
    @Published var showsBiometricOffer = false

    weak var webView: WKWebView?
    private var authenticationSession: ASWebAuthenticationSession?
    private let biometricStore = PepperBiometricStore()
    private var pendingBiometricEnrollment: (sessionToken: String, memberName: String)?
    private var unlockedSessionToken: String?
    private var webContentReady = false

    override init() {
        let enrollment = biometricStore.enrollment
        isBiometricLocked = enrollment != nil
        biometricMemberName = enrollment?.memberName ?? ""
        super.init()
    }

    func reload() {
        errorMessage = nil
        isLoading = !isBiometricLocked

        if let webView {
            webView.reload()
        }
    }

    func webViewDidStartNavigation() {
        webContentReady = false
        if !isBiometricLocked { isLoading = true }
        errorMessage = nil
    }

    func webViewDidFinishNavigation() {
        webContentReady = true
        isLoading = false
        injectUnlockedSessionIfReady()
    }

    func offerFaceID(sessionToken: String, memberName: String) {
        guard
            biometricStore.enrollment == nil,
            UUID(uuidString: sessionToken) != nil
        else { return }
        let cleanName = String(memberName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        pendingBiometricEnrollment = (sessionToken, cleanName.isEmpty ? "this profile" : cleanName)
        biometricMemberName = pendingBiometricEnrollment?.memberName ?? ""
        showsBiometricOffer = true
    }

    func declineFaceIDOffer() {
        pendingBiometricEnrollment = nil
        showsBiometricOffer = false
    }

    func enableFaceID() async {
        guard let enrollment = pendingBiometricEnrollment, !isBiometricBusy else { return }
        showsBiometricOffer = false
        isBiometricBusy = true
        biometricErrorMessage = nil
        defer { isBiometricBusy = false }

        do {
            try await biometricStore.enroll(
                sessionToken: enrollment.sessionToken,
                memberName: enrollment.memberName
            )
            try await clearPersistentWebSession()
            pendingBiometricEnrollment = nil
            biometricMemberName = enrollment.memberName
            unlockedSessionToken = enrollment.sessionToken
            isBiometricLocked = false
            sendBiometricResult(
                ok: true,
                message: "Face ID is ready for \(enrollment.memberName) on this iPhone."
            )
        } catch {
            biometricStore.remove()
            biometricErrorMessage = error.localizedDescription
            sendBiometricResult(ok: false, message: error.localizedDescription)
        }
    }

    func unlockWithFaceID() async {
        guard isBiometricLocked, !isBiometricBusy else { return }
        isBiometricBusy = true
        biometricErrorMessage = nil
        defer { isBiometricBusy = false }

        do {
            unlockedSessionToken = try await biometricStore.unlock()
            injectUnlockedSessionIfReady()
        } catch {
            if let localAuthenticationError = error as? LAError {
                switch localAuthenticationError.code {
                case .userCancel, .appCancel, .systemCancel:
                    biometricErrorMessage = "Face ID was canceled. Try again or use your PIN."
                    return
                default:
                    break
                }
            }
            biometricErrorMessage = error.localizedDescription
        }
    }

    func lockForBackground() {
        guard biometricStore.enrollment != nil else { return }
        unlockedSessionToken = nil
        isBiometricLocked = true
        biometricErrorMessage = nil
        sendWebEvent(name: "pepper:native-lock")
    }

    func usePINInstead() {
        biometricStore.remove()
        pendingBiometricEnrollment = nil
        unlockedSessionToken = nil
        biometricMemberName = ""
        biometricErrorMessage = nil
        isBiometricLocked = false
        sendWebEvent(name: "pepper:native-lock")
    }

    func removeFaceID() {
        biometricStore.remove()
        pendingBiometricEnrollment = nil
        unlockedSessionToken = nil
        biometricMemberName = ""
        biometricErrorMessage = nil
        isBiometricLocked = false
    }

    func startAuthentication(at url: URL) {
        guard authenticationSession == nil else { return }

        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: "pepper"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authenticationSession = nil

                if let callbackURL {
                    self.loadAuthenticationResult(callbackURL)
                    return
                }

                if let authenticationError = error as? ASWebAuthenticationSessionError,
                   authenticationError.code == .canceledLogin {
                    self.loadAuthenticationFailure(for: url, reason: "canceled")
                    return
                }

                self.errorMessage = "The Google connection did not finish. Try again."
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session

        if !session.start() {
            authenticationSession = nil
            errorMessage = "Pepper could not open Google sign-in. Try again."
        }
    }

    private func loadAuthenticationResult(_ callbackURL: URL) {
        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        loadPepper(queryItems: items)
    }

    private func loadAuthenticationFailure(for authorizationURL: URL, reason: String) {
        let isEmail = authorizationURL.absoluteString.contains("gmail.readonly")
        let items = isEmail
            ? [URLQueryItem(name: "connection", value: "gmail_error")]
            : [
                URLQueryItem(name: "calendar", value: "error"),
                URLQueryItem(name: "reason", value: reason),
            ]
        loadPepper(queryItems: items)
    }

    private func loadPepper(queryItems: [URLQueryItem]) {
        guard var components = URLComponents(
            url: PepperConfiguration.appURL,
            resolvingAgainstBaseURL: false
        ) else { return }
        components.queryItems = queryItems
        guard let url = components.url else { return }
        isLoading = true
        webView?.load(URLRequest(url: url))
    }

    private func injectUnlockedSessionIfReady() {
        guard
            webContentReady,
            let webView,
            let sessionToken = unlockedSessionToken
        else { return }
        let token = javascriptLiteral(sessionToken)
        let script = """
        window.__pepperNativeSession = \(token);
        window.dispatchEvent(new CustomEvent('pepper:native-session',{detail:{token:\(token)}}));
        true;
        """
        webView.evaluateJavaScript(script) { [weak self] _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.biometricErrorMessage = "Pepper unlocked, but the session could not be restored."
                    NSLog("Pepper Face ID session injection error: %@", error.localizedDescription)
                    return
                }
                self.isBiometricLocked = false
                self.biometricErrorMessage = nil
            }
        }
    }

    private func clearPersistentWebSession() async throws {
        guard let webView else { throw PepperBiometricBridgeError.webViewUnavailable }
        _ = try await webView.evaluateJavaScript(
            "localStorage.removeItem('pepper_family_session');true;"
        )
    }

    private func sendBiometricResult(ok: Bool, message: String) {
        guard
            JSONSerialization.isValidJSONObject(["ok": ok, "message": message]),
            let data = try? JSONSerialization.data(withJSONObject: ["ok": ok, "message": message]),
            let json = String(data: data, encoding: .utf8)
        else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('pepper:biometric-result',{detail:\(json)}));"
        )
    }

    private func sendWebEvent(name: String) {
        let eventName = javascriptLiteral(name)
        webView?.evaluateJavaScript(
            "window.__pepperNativeSession='';localStorage.removeItem('pepper_family_session');window.dispatchEvent(new CustomEvent(\(eventName)));"
        )
    }

    private func javascriptLiteral(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value]),
            let array = String(data: data, encoding: .utf8),
            array.count >= 2
        else { return "\"\"" }
        return String(array.dropFirst().dropLast())
    }
}

private enum PepperBiometricBridgeError: LocalizedError {
    case webViewUnavailable

    var errorDescription: String? {
        "Pepper could not secure this session for Face ID. Try again."
    }
}

extension PepperBrowserModel: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = webView?.window { return window }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
