import Foundation
import WebKit

@MainActor
final class PepperBrowserModel: ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?

    weak var webView: WKWebView?

    func reload() {
        errorMessage = nil
        isLoading = true

        if let webView {
            webView.reload()
        }
    }
}
