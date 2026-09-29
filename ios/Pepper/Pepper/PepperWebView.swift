import SwiftUI
import UIKit
import WebKit

struct PepperWebView: UIViewRepresentable {
    @ObservedObject var browser: PepperBrowserModel

    func makeCoordinator() -> Coordinator {
        Coordinator(browser: browser)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "Pepper-iOS"
        configuration.userContentController.add(
            context.coordinator,
            name: Coordinator.companionMessageName
        )
        configuration.userContentController.add(
            context.coordinator,
            name: Coordinator.biometricMessageName
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        browser.webView = webView
        webView.load(URLRequest(url: PepperConfiguration.appURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Coordinator.companionMessageName
        )
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Coordinator.biometricMessageName
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let companionMessageName = "pepperCompanion"
        static let biometricMessageName = "pepperBiometrics"

        private let browser: PepperBrowserModel
        private let allowedHost = PepperConfiguration.appURL.host
        private let allowedScheme = PepperConfiguration.appURL.scheme

        init(browser: PepperBrowserModel) {
            self.browser = browser
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            browser.webViewDidStartNavigation()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            browser.webViewDidFinishNavigation()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            show(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if
                navigationAction.targetFrame == nil,
                url.scheme == allowedScheme,
                url.host == allowedHost
            {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }

            if
                (url.scheme == allowedScheme && url.host == allowedHost) ||
                url.scheme == "about"
            {
                decisionHandler(.allow)
                return
            }

            if url.scheme == "https", url.host == "accounts.google.com" {
                browser.startAuthentication(at: url)
                decisionHandler(.cancel)
                return
            }

            if url.scheme == "https" || url.scheme == "mailto" || url.scheme == "tel" {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        private func show(_ error: Error) {
            browser.isLoading = false
            browser.errorMessage = "Check your internet connection and try again."
            NSLog("Pepper navigation error: %@", error.localizedDescription)
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.frameInfo.isMainFrame,
                message.frameInfo.securityOrigin.protocol == allowedScheme,
                message.frameInfo.securityOrigin.host == allowedHost,
                let payload = message.body as? [String: Any]
            else { return }

            if message.name == Self.biometricMessageName {
                handleBiometricMessage(payload)
                return
            }

            guard
                message.name == Self.companionMessageName,
                payload["action"] as? String == "open_health_bridge",
                let memberID = payload["member_id"] as? String,
                UUID(uuidString: memberID) != nil,
                let memberName = payload["member_name"] as? String
            else { return }

            browser.presentHealthBridge(memberID: memberID, memberName: memberName)
        }

        private func handleBiometricMessage(_ payload: [String: Any]) {
            switch payload["action"] as? String {
            case "offer":
                guard
                    let sessionToken = payload["session_token"] as? String,
                    let memberName = payload["member_name"] as? String
                else { return }
                browser.offerFaceID(sessionToken: sessionToken, memberName: memberName)
            case "remove":
                browser.removeFaceID()
            default:
                return
            }
        }

    }
}
