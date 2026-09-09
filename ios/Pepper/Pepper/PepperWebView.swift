import HealthKit
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
            name: Coordinator.healthMessageName
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
            forName: Coordinator.healthMessageName
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let healthMessageName = "pepperHealth"

        private let browser: PepperBrowserModel
        private let allowedHost = PepperConfiguration.appURL.host
        private let healthStore = HKHealthStore()

        init(browser: PepperBrowserModel) {
            self.browser = browser
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            browser.isLoading = true
            browser.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            browser.isLoading = false
            browser.errorMessage = nil
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

            if navigationAction.targetFrame == nil, url.host == allowedHost {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }

            if url.host == allowedHost || url.scheme == "about" {
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
                message.name == Self.healthMessageName,
                let payload = message.body as? [String: Any],
                let ingestURLText = payload["ingest_url"] as? String,
                let ingestURL = URL(string: ingestURLText),
                let pairingToken = payload["pairing_token"] as? String,
                isAllowedHealthEndpoint(ingestURL),
                pairingToken.count >= 32
            else {
                sendHealthResult([
                    "ok": false,
                    "error": "Pepper could not verify the Apple Health connection.",
                ])
                return
            }

            Task { @MainActor [weak self] in
                await self?.syncHealth(to: ingestURL, pairingToken: pairingToken)
            }
        }

        private func isAllowedHealthEndpoint(_ url: URL) -> Bool {
            guard
                url.scheme == "https",
                let host = url.host,
                host == PepperConfiguration.healthHost
            else { return false }
            return url.path == "/functions/v1/pepper-health-ingest"
        }

        @MainActor
        private func syncHealth(to ingestURL: URL, pairingToken: String) async {
            guard HKHealthStore.isHealthDataAvailable() else {
                sendHealthResult([
                    "ok": false,
                    "error": "Apple Health is not available on this device.",
                ])
                return
            }

            do {
                let stepsType = HKQuantityType(.stepCount)
                let exerciseType = HKQuantityType(.appleExerciseTime)
                try await requestHealthAuthorization(reading: [stepsType, exerciseType])

                let calendar = Calendar.current
                let start = calendar.startOfDay(for: Date())
                async let steps = cumulativeValue(
                    for: stepsType,
                    unit: .count(),
                    from: start,
                    to: Date()
                )
                async let activeMinutes = cumulativeValue(
                    for: exerciseType,
                    unit: .minute(),
                    from: start,
                    to: Date()
                )
                let values = try await (steps, activeMinutes)
                let stepCount = max(0, Int(values.0.rounded()))
                let activeMinuteCount = max(0, Int(values.1.rounded()))
                let metricDate = Self.metricDateFormatter.string(from: Date())

                try await uploadHealth(
                    to: ingestURL,
                    pairingToken: pairingToken,
                    metricDate: metricDate,
                    stepCount: stepCount,
                    activeMinutes: activeMinuteCount
                )
                sendHealthResult([
                    "ok": true,
                    "step_count": stepCount,
                    "active_minutes": activeMinuteCount,
                    "metric_date": metricDate,
                ])
            } catch {
                NSLog("Pepper HealthKit sync error: %@", error.localizedDescription)
                sendHealthResult([
                    "ok": false,
                    "error": "Pepper could not read Apple Health. Check Health permissions and try again.",
                ])
            }
        }

        private func requestHealthAuthorization(reading types: Set<HKObjectType>) async throws {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                healthStore.requestAuthorization(toShare: [], read: types) { success, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if success {
                        continuation.resume(returning: ())
                    } else {
                        continuation.resume(throwing: PepperHealthError.authorizationFailed)
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

        private func uploadHealth(
            to url: URL,
            pairingToken: String,
            metricDate: String,
            stepCount: Int,
            activeMinutes: Int
        ) async throws {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(pairingToken, forHTTPHeaderField: "x-pepper-health-token")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "metric_date": metricDate,
                "step_count": stepCount,
                "active_minutes": activeMinutes,
            ])

            let (_, response) = try await URLSession.shared.data(for: request)
            guard
                let httpResponse = response as? HTTPURLResponse,
                (200..<300).contains(httpResponse.statusCode)
            else { throw PepperHealthError.uploadFailed }
        }

        @MainActor
        private func sendHealthResult(_ result: [String: Any]) {
            guard
                JSONSerialization.isValidJSONObject(result),
                let data = try? JSONSerialization.data(withJSONObject: result),
                let json = String(data: data, encoding: .utf8)
            else { return }
            browser.webView?.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('pepper:health-result',{detail:\(json)}));"
            )
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
}

private enum PepperHealthError: Error {
    case authorizationFailed
    case uploadFailed
}
