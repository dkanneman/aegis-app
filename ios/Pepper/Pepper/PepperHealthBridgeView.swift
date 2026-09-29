import SwiftUI

struct PepperHealthBridgeView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: PepperHealthBridgeStore
    @ObservedObject var browser: PepperBrowserModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    metrics
                    status
                    syncButton
                    privacy
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
            .background(Color.pepperHealthMist.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close Health Bridge")
                }
            }
        }
        .task(id: browser.healthBridgeMember?.id) {
            guard let member = browser.healthBridgeMember else { return }
            store.activate(for: member)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 15) {
            Image(systemName: "heart.text.clipboard.fill")
                .font(.system(size: 25, weight: .medium))
                .foregroundStyle(Color.pepperPeriwinkle)
                .frame(width: 52, height: 52)
                .background(Color.pepperPeriwinkle.opacity(0.12), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text("HEALTH BRIDGE")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.pepperSage)

                Text(store.member?.name ?? "Apple Health")
                    .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    .foregroundStyle(Color.pepperInk)

                Text("A private, read-only connection on this iPhone.")
                    .font(.subheadline)
                    .foregroundStyle(Color.pepperSoftInk)
            }
        }
    }

    private var metrics: some View {
        HStack(spacing: 0) {
            metric(
                value: store.snapshot.map { $0.stepCount.formatted() } ?? "--",
                label: "Steps",
                symbol: "figure.walk"
            )

            Divider()
                .padding(.vertical, 4)

            metric(
                value: store.snapshot.map { $0.activeMinutes.formatted() } ?? "--",
                label: "Active minutes",
                symbol: "timer"
            )
        }
        .padding(.vertical, 20)
        .background(Color.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.pepperPeriwinkle.opacity(0.18), lineWidth: 1)
        }
    }

    private func metric(value: String, label: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.pepperSage)

            Text(value)
                .font(.system(.title2, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color.pepperInk)

            Text(label)
                .font(.caption)
                .foregroundStyle(Color.pepperSoftInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
    }

    private var status: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: statusSymbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(statusColor)
                .frame(width: 22)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(statusTitle)
                    .font(.headline)
                    .foregroundStyle(Color.pepperInk)

                Text(statusDetail)
                    .font(.subheadline)
                    .foregroundStyle(Color.pepperSoftInk)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var syncButton: some View {
        Button {
            Task {
                let snapshot = await store.synchronize {
                    try await browser.currentPepperSessionToken()
                }
                if snapshot != nil {
                    browser.healthBridgeDidSync()
                }
            }
        } label: {
            HStack(spacing: 9) {
                if store.isBusy {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: store.isPaired ? "arrow.triangle.2.circlepath" : "heart.circle")
                }
                Text(store.isPaired ? "Sync now" : "Connect Apple Health")
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .tint(.pepperPeriwinkle)
        .disabled(store.isBusy || store.member == nil)
    }

    private var privacy: some View {
        Label {
            Text("Pepper reads today's steps and exercise minutes only. It never writes to Apple Health.")
        } icon: {
            Image(systemName: "lock.shield.fill")
                .foregroundStyle(Color.pepperSage)
        }
        .font(.footnote)
        .foregroundStyle(Color.pepperSoftInk)
    }

    private var statusTitle: String {
        switch store.phase {
        case .ready:
            return store.isPaired ? "Ready to refresh" : "Ready to connect"
        case .authorizing:
            return "Checking permission"
        case .reading:
            return "Reading today"
        case .uploading:
            return "Updating Pepper"
        case .synced:
            return "Pepper is current"
        case .failed:
            return "Health Bridge needs attention"
        }
    }

    private var statusDetail: String {
        switch store.phase {
        case .ready:
            return store.isPaired
                ? "Your secure pairing is stored on this iPhone."
                : "Apple will ask which health categories Pepper may read."
        case .authorizing:
            return "Waiting for Apple Health authorization."
        case .reading:
            return "Collecting today's approved totals on this iPhone."
        case .uploading:
            return "Sending the daily summary to your private Pepper profile."
        case .synced:
            guard let snapshot = store.snapshot else { return "Today's summary is synced." }
            return "Synced at \(snapshot.syncedAt.formatted(date: .omitted, time: .shortened))."
        case let .failed(message):
            return message
        }
    }

    private var statusSymbol: String {
        switch store.phase {
        case .ready:
            return store.isPaired ? "checkmark.shield" : "heart"
        case .authorizing, .reading, .uploading:
            return "ellipsis.circle"
        case .synced:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }

    private var statusColor: Color {
        switch store.phase {
        case .failed:
            return .pepperMediterranean
        case .synced:
            return .pepperSage
        case .ready, .authorizing, .reading, .uploading:
            return .pepperPeriwinkle
        }
    }
}
