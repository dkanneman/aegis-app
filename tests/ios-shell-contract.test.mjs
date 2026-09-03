import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const project = new URL("../ios/Pepper/Pepper.xcodeproj/project.pbxproj", import.meta.url);
const infoPlist = new URL("../ios/Pepper/Pepper/Info.plist", import.meta.url);
const configuration = new URL("../ios/Pepper/Pepper/PepperConfiguration.swift", import.meta.url);
const privacyManifest = new URL("../ios/Pepper/Pepper/PrivacyInfo.xcprivacy", import.meta.url);
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
  assert.match(plistText, /<key>PepperBaseHost<\/key>/);
  assert.doesNotMatch(releaseInputs, /_vercel_share|Family PIN|101315/i);
  assert.match(configurationText, /#if DEBUG[\s\S]*PEPPER_BASE_URL[\s\S]*#endif/);
  assert.match(configurationText, /url\.scheme == "https"/);
});

test("the iOS privacy manifest does not claim tracking", async () => {
  const manifest = await readFile(privacyManifest, "utf8");

  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
});

test("the App Store icon is a 1024px PNG", async () => {
  const icon = await readFile(appIcon);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert.deepEqual(icon.subarray(0, 8), pngSignature);
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
});
