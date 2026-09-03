import Foundation

enum PepperConfiguration {
    static var appURL: URL {
#if DEBUG
        if
            let override = ProcessInfo.processInfo.environment["PEPPER_BASE_URL"],
            let url = URL(string: override),
            url.scheme == "https"
        {
            return url
        }
#endif

        guard
            let host = Bundle.main.object(forInfoDictionaryKey: "PepperBaseHost") as? String,
            !host.isEmpty,
            let url = URL(string: "https://\(host)/pepper")
        else {
            preconditionFailure("PepperBaseHost must be configured in the target build settings.")
        }

        return url
    }
}
