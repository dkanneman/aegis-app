import AuthenticationServices
import Foundation
import UIKit
import WebKit

@MainActor
final class PepperBrowserModel: NSObject, ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?

    weak var webView: WKWebView?
    private var authenticationSession: ASWebAuthenticationSession?

    func reload() {
        errorMessage = nil
        isLoading = true

        if let webView {
            webView.reload()
        }
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
