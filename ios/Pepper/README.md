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

## Apple Health

Apple Health is handled by the native SwiftUI Health Bridge. The Pepper web page
can open that native screen, but it never receives a HealthKit object, permission,
pairing token, or direct HealthKit result. The bridge requests read-only access to
today's step count and exercise minutes, stores its member-scoped pairing in the
iPhone Keychain, and sends those two approved totals directly to the One Brain
health ingest endpoint. Pepper never requests HealthKit write access and does not
expose health totals to other household profiles.

## Face ID

After a successful profile-and-PIN login, the iPhone app offers optional Face ID
unlock for that profile on that device. Pepper stores the member session in the
iOS Keychain with device-only, current-biometric-set protection and removes the
web-persisted copy. Returning from the background locks the family view again.

The member can cancel Face ID or choose **Use PIN instead** at any time. Choosing
the PIN fallback, signing out, deleting the account, or receiving an expired
session removes the Keychain credential. Pepper never receives or stores Face ID
images or biometric templates; iOS only returns whether authentication succeeded.
