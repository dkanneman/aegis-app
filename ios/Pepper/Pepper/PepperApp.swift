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
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var browser: PepperBrowserModel

    var body: some View {
        ZStack {
            Color.pepperPorcelain
                .ignoresSafeArea()

            PepperWebView(browser: browser)
                .ignoresSafeArea(.container, edges: .bottom)

            if browser.isLoading && !browser.isBiometricLocked {
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

            if browser.isBiometricLocked {
                PepperFaceIDLockView(browser: browser)
                    .transition(.opacity)
                    .zIndex(2)
            }
        }
        .task {
            await browser.unlockWithFaceID()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await browser.unlockWithFaceID() }
            case .background:
                browser.lockForBackground()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
        .alert("Use Face ID for Pepper?", isPresented: $browser.showsBiometricOffer) {
            Button("Not Now", role: .cancel) {
                browser.declineFaceIDOffer()
            }
            Button("Use Face ID") {
                Task { await browser.enableFaceID() }
            }
        } message: {
            Text("Unlock \(browser.biometricMemberName)'s private day without entering a PIN on this iPhone.")
        }
    }
}

private struct PepperFaceIDLockView: View {
    @ObservedObject var browser: PepperBrowserModel

    var body: some View {
        ZStack {
            Color.pepperPorcelain
                .ignoresSafeArea()

            VStack(spacing: 18) {
                Image(systemName: "faceid")
                    .font(.system(size: 52, weight: .regular))
                    .foregroundStyle(Color.pepperPeriwinkle)
                    .accessibilityHidden(true)

                VStack(spacing: 8) {
                    Text("Pepper is locked")
                        .font(.system(.title, design: .serif, weight: .semibold))
                        .foregroundStyle(Color.pepperInk)

                    Text("Unlock \(browser.biometricMemberName)'s private day.")
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.pepperSoftInk)
                }

                if let message = browser.biometricErrorMessage {
                    Text(message)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.pepperSoftInk)
                        .padding(.horizontal, 8)
                }

                Button {
                    Task { await browser.unlockWithFaceID() }
                } label: {
                    Label(
                        browser.isBiometricBusy ? "Checking Face ID" : "Unlock with Face ID",
                        systemImage: "faceid"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.pepperPeriwinkle)
                .disabled(browser.isBiometricBusy)

                Button("Use PIN instead") {
                    browser.usePINInstead()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.pepperSage)
                .disabled(browser.isBiometricBusy)
            }
            .padding(28)
            .frame(maxWidth: 380)
            .padding(24)
        }
        .accessibilityElement(children: .contain)
    }
}

private extension Color {
    static let pepperPorcelain = Color(red: 247 / 255, green: 244 / 255, blue: 238 / 255)
    static let pepperCiel = Color(red: 200 / 255, green: 220 / 255, blue: 232 / 255)
    static let pepperRiviera = Color(red: 110 / 255, green: 157 / 255, blue: 183 / 255)
    static let pepperMediterranean = Color(red: 63 / 255, green: 113 / 255, blue: 141 / 255)
    static let pepperInk = Color(red: 23 / 255, green: 36 / 255, blue: 50 / 255)
    static let pepperSoftInk = Color(red: 93 / 255, green: 104 / 255, blue: 114 / 255)
    static let pepperPeriwinkle = Color(red: 105 / 255, green: 112 / 255, blue: 174 / 255)
    static let pepperSage = Color(red: 84 / 255, green: 119 / 255, blue: 97 / 255)
}
