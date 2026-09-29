import Foundation

enum PepperConfiguration {
    static var supabaseAnonKey: String {
        guard
            let key = Bundle.main.object(forInfoDictionaryKey: "PepperSupabaseAnonKey") as? String,
            !key.isEmpty
        else {
            preconditionFailure("PepperSupabaseAnonKey must be configured in the target build settings.")
        }
        return key
    }

    static var healthHost: String {
        guard
            let host = Bundle.main.object(forInfoDictionaryKey: "PepperHealthHost") as? String,
            !host.isEmpty
        else {
            preconditionFailure("PepperHealthHost must be configured in the target build settings.")
        }
        return host
    }

    static var familyAPIURL: URL {
        guard let url = URL(string: "https://\(healthHost)/functions/v1/pepper-family-api") else {
            preconditionFailure("PepperHealthHost must form a valid family API URL.")
        }
        return url
    }

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
