import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const project = new URL("../ios/Pepper/Pepper.xcodeproj/project.pbxproj", import.meta.url);
const infoPlist = new URL("../ios/Pepper/Pepper/Info.plist", import.meta.url);
const configuration = new URL("../ios/Pepper/Pepper/PepperConfiguration.swift", import.meta.url);
const privacyManifest = new URL("../ios/Pepper/Pepper/PrivacyInfo.xcprivacy", import.meta.url);
const webView = new URL("../ios/Pepper/Pepper/PepperWebView.swift", import.meta.url);
const browserModel = new URL(
  "../ios/Pepper/Pepper/PepperBrowserModel.swift",
  import.meta.url,
);
const biometricStore = new URL(
  "../ios/Pepper/Pepper/PepperBiometricStore.swift",
  import.meta.url,
);
const app = new URL("../ios/Pepper/Pepper/PepperApp.swift", import.meta.url);
const pepperClient = new URL("../app/pepper/pepper-client.tsx", import.meta.url);
const entitlements = new URL("../ios/Pepper/Pepper/Pepper.entitlements", import.meta.url);
const appIcon = new URL(
  "../ios/Pepper/Pepper/Assets.xcassets/AppIcon.appiconset/Pepper-AppIcon-1024.png",
  import.meta.url,
);

test("the iOS shell targets the stable private beta without embedded credentials", async () => {
  const [projectText, plistText, configurationText] = await Promise.all([
    readFile(project, "utf8"),
    readFile(infoPlist, "utf8"),
    readFile(configuration, "utf8"),
  ]);
  const releaseInputs = `${projectText}\n${plistText}`;

  assert.match(projectText, /PRODUCT_BUNDLE_IDENTIFIER = com\.dkanneman\.pepper;/);
  assert.match(projectText, /PEPPER_BASE_HOST = "?pepper-family-beta\.vercel\.app"?;/);
  assert.match(projectText, /PEPPER_HEALTH_HOST = "?mfgyeolvfthxacrqwwtc\.supabase\.co"?;/);
  assert.match(plistText, /<key>PepperBaseHost<\/key>/);
  assert.doesNotMatch(releaseInputs, /_vercel_share|Family PIN|101315/i);
  assert.match(configurationText, /#if DEBUG[\s\S]*PEPPER_BASE_URL[\s\S]*#endif/);
  assert.match(configurationText, /url\.scheme == "https"/);
});

test("the iOS privacy manifest does not claim tracking", async () => {
  const manifest = await readFile(privacyManifest, "utf8");

  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeName/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeEmailAddress/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeHealthFitness/);
  assert.match(manifest, /NSPrivacyCollectedDataTypeOtherUserContent/);
  assert.doesNotMatch(
    manifest,
    /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/,
  );
  assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
});

test("the iOS shell connects read-only Apple Health to the member-scoped ingest", async () => {
  const [projectText, plistText, webViewText, entitlementText] = await Promise.all([
    readFile(project, "utf8"),
    readFile(infoPlist, "utf8"),
    readFile(webView, "utf8"),
    readFile(entitlements, "utf8"),
  ]);

  assert.match(projectText, /CODE_SIGN_ENTITLEMENTS = Pepper\/Pepper\.entitlements;/);
  assert.match(plistText, /<key>NSHealthShareUsageDescription<\/key>/);
  assert.match(plistText, /<key>NSHealthUpdateUsageDescription<\/key>/);
  assert.match(entitlementText, /<key>com\.apple\.developer\.healthkit<\/key>\s*<true\/>/);
  assert.match(webViewText, /import HealthKit/);
  assert.match(webViewText, /requestAuthorization\(toShare: \[\], read: types\)/);
  assert.match(webViewText, /\.stepCount/);
  assert.match(webViewText, /\.appleExerciseTime/);
  assert.match(webViewText, /x-pepper-health-token/);
  assert.match(webViewText, /pepper-health-ingest/);
  assert.match(webViewText, /host == PepperConfiguration\.healthHost/);
  assert.doesNotMatch(webViewText, /save\(|HKSampleQuery/);
});

test("the App Store icon is a 1024px PNG", async () => {
  const icon = await readFile(appIcon);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert.deepEqual(icon.subarray(0, 8), pngSignature);
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
});

test("Face ID protects a device-only Pepper session with PIN fallback", async () => {
  const [
    projectText,
    plistText,
    webViewText,
    browserText,
    storeText,
    appText,
    clientText,
  ] = await Promise.all([
    readFile(project, "utf8"),
    readFile(infoPlist, "utf8"),
    readFile(webView, "utf8"),
    readFile(browserModel, "utf8"),
    readFile(biometricStore, "utf8"),
    readFile(app, "utf8"),
    readFile(pepperClient, "utf8"),
  ]);

  assert.match(projectText, /PepperBiometricStore\.swift in Sources/);
  assert.match(plistText, /<key>NSFaceIDUsageDescription<\/key>/);
  assert.match(storeText, /import LocalAuthentication/);
  assert.match(storeText, /import Security/);
  assert.match(storeText, /kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly/);
  assert.match(storeText, /\.biometryCurrentSet/);
  assert.match(storeText, /deviceOwnerAuthenticationWithBiometrics/);
  assert.match(webViewText, /pepperBiometrics/);
  assert.match(webViewText, /message\.frameInfo\.isMainFrame/);
  assert.match(webViewText, /message\.frameInfo\.securityOrigin\.protocol == allowedScheme/);
  assert.match(webViewText, /message\.frameInfo\.securityOrigin\.host == allowedHost/);
  assert.match(browserText, /pepper:native-session/);
  assert.match(browserText, /pepper:native-lock/);
  assert.match(browserText, /localStorage\.removeItem\('pepper_family_session'\)/);
  assert.match(appText, /Unlock with Face ID/);
  assert.match(appText, /Use PIN instead/);
  assert.match(appText, /case \.background:\s*browser\.lockForBackground\(\)/);
  assert.match(clientText, /offerNativeFaceID\(/);
  assert.match(clientText, /removeNativeFaceID\(\)/);
  assert.match(clientText, /pepper:native-session/);
  assert.match(clientText, /pepper:native-lock/);
});
