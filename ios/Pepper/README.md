# Pepper iPhone beta

This project is the native TestFlight shell for the Pepper family beta. It presents the responsive Pepper web experience in a persistent `WKWebView`, while canonical family state remains in the private One Brain Supabase project.

## Endpoint

The target build setting `INFOPLIST_KEY_PepperBaseHost` controls the web host. It intentionally stores only a stable hostname and never embeds a Vercel share token, family PIN, Supabase secret, or OAuth credential.

Debug simulator runs may temporarily override the complete URL with the `PEPPER_BASE_URL` process environment variable. Release and TestFlight builds ignore that override.

Before archiving, the stable `pepper-family-beta.vercel.app` host must point at the approved beta release and be accessible to family testers without Vercel's temporary share-cookie flow. Pepper's own household authentication remains required.

## Xcode steps

1. Open `Pepper.xcodeproj`.
2. Select the Pepper target, then Signing & Capabilities.
3. Choose Danielle's Apple Developer team and leave automatic signing enabled.
4. Confirm the bundle identifier `com.dkanneman.pepper` is available.
5. Run on an iPhone simulator, then a registered iPhone.
6. Archive with the Release configuration and upload through Organizer.

Do not add HealthKit entitlements or permission text until the native Health connection is implemented and ready to explain to testers.
