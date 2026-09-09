import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260909101210_add_member_profile_photos.sql",
  import.meta.url,
);
const apiPath = new URL(
  "../supabase/functions/pepper-family-api/index.ts",
  import.meta.url,
);
const clientPath = new URL("../app/pepper/pepper-client.tsx", import.meta.url);

test("profile photos remain private and household scoped", async () => {
  const [migration, api, client] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(apiPath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);

  assert.match(migration, /'pepper-profile-photos'/);
  assert.match(migration, /false,\s*1048576,\s*array\['image\/jpeg'\]/s);
  assert.match(migration, /private\.member_setup_profiles[\s\S]*avatar_path/);

  assert.match(api, /action==='member_photo_save'/);
  assert.match(api, /action==='member_photo_remove'/);
  assert.match(api, /target\.id!==member\.id&&!adult\(member\)/);
  assert.match(api, /household_id=\$\{member\.household_id\}::uuid/);
  assert.match(api, /bytes\[0\]!==0xff\|\|bytes\[1\]!==0xd8\|\|bytes\[2\]!==0xff/);
  assert.match(api, /storage\/v1\/object\/sign/);
  assert.match(api, /startsWith\('\/object\/'\)[\s\S]*`\/storage\/v1\$\{signed\}`/);
  assert.match(api, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(client, /accept="image\/\*"/);
  assert.match(client, /canvas\.toDataURL\("image\/jpeg", 0\.86\)/);
  assert.match(client, /action: "member_photo_save"/);
  assert.match(client, /action: "member_photo_remove"/);
  assert.match(client, /Shown only to signed-in members of this family\./);
});
