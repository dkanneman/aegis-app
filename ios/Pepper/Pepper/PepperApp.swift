import SwiftUI

@main
struct PepperApp: App {
    @StateObject private var browser = PepperBrowserModel()

    var body: some Scene {
        WindowGroup {
            PepperRootView(browser: browser)
                .preferredColorScheme(.light)
        }
    }
}

private struct PepperRootView: View {
    @ObservedObject var browser: PepperBrowserModel

    var body: some View {
        ZStack {
            Color.pepperPorcelain
                .ignoresSafeArea()

            PepperWebView(browser: browser)
                .ignoresSafeArea(.container, edges: .bottom)

            if browser.isLoading {
                ProgressView()
                    .controlSize(.large)
                    .tint(.pepperRiviera)
                    .padding(24)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
                    .accessibilityLabel("Loading Pepper")
            }

            if let message = browser.errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(Color.pepperMediterranean)

                    Text("Pepper could not connect")
                        .font(.system(.title3, design: .serif, weight: .semibold))
                        .foregroundStyle(Color.pepperInk)

                    Text(message)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.pepperSoftInk)

                    Button("Try Again") {
                        browser.reload()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.pepperMediterranean)
                }
                .padding(28)
                .frame(maxWidth: 340)
                .background(Color.pepperPorcelain, in: RoundedRectangle(cornerRadius: 20))
                .overlay {
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.pepperCiel, lineWidth: 1)
                }
                .padding(24)
            }
        }
    }
}

private extension Color {
    static let pepperPorcelain = Color(red: 247 / 255, green: 244 / 255, blue: 238 / 255)
    static let pepperCiel = Color(red: 200 / 255, green: 220 / 255, blue: 232 / 255)
    static let pepperRiviera = Color(red: 110 / 255, green: 157 / 255, blue: 183 / 255)
    static let pepperMediterranean = Color(red: 63 / 255, green: 113 / 255, blue: 141 / 255)
    static let pepperInk = Color(red: 23 / 255, green: 36 / 255, blue: 50 / 255)
    static let pepperSoftInk = Color(red: 93 / 255, green: 104 / 255, blue: 114 / 255)
}
