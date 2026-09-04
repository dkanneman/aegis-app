import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260904183754_add_first_time_member_pin_setup.sql",
  import.meta.url,
);
const apiPath = new URL(
  "../supabase/functions/pepper-family-api/index.ts",
  import.meta.url,
);
const clientPath = new URL(
  "../app/pepper/pepper-client.tsx",
  import.meta.url,
);

test("first-time members exchange an invitation code for their own PIN", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /pin_setup_completed_at timestamptz/);
  assert.match(migration, /private\.member_pin_setup_sessions/);
  assert.match(migration, /setup_required', true/);
  assert.match(migration, /setup_expiry := now\(\) \+ interval '10 minutes'/);
  assert.match(migration, /private\.pepper_complete_pin_setup/);
  assert.match(migration, /different from the invitation code/);
  assert.match(
    migration,
    /pin_hash = extensions\.crypt\(new_pin_input, extensions\.gen_salt\('bf'\)\)/,
  );
  assert.match(migration, /pin_setup_completed_at = now\(\)/);
});

test("PIN setup tokens stay private and single-use", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /alter table private\.member_pin_setup_sessions enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on table private\.member_pin_setup_sessions from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /where setup\.token = setup_token_input[\s\S]*setup\.consumed_at is null[\s\S]*setup\.expires_at > now\(\)/,
  );
  assert.match(
    migration,
    /set consumed_at = now\(\)[\s\S]*where member_id = member_row\.id/,
  );
  assert.match(
    migration,
    /revoke execute on function private\.pepper_complete_pin_setup/,
  );
});

test("established and App Review accounts are not forced through first-time setup", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /from public\.member_sessions session/);
  assert.match(migration, /household\.slug = 'pepper-review'/);
  assert.match(migration, /member_row\.household_slug <> 'pepper-review'/);
  assert.match(migration, /10-digit PIN remains reserved for the isolated TestFlight reviewer/);
});

test("the API completes PIN setup before requiring a member session", async () => {
  const api = await readFile(apiPath, "utf8");

  assert.match(api, /version:'1\.9'/);
  assert.match(api, /capabilities:\[[^\]]*'pin_setup'/);
  assert.match(api, /if\(action==='pin_setup'\)/);
  assert.match(api, /private\.pepper_complete_pin_setup/);
  assert.ok(
    api.indexOf("if(action==='pin_setup')") <
      api.indexOf("const token=req.headers.get('x-pepper-session')"),
  );
});

test("the sign-in UI never assigns a permanent PIN for a family member", async () => {
  const client = await readFile(clientPath, "utf8");

  assert.match(client, /Create your PIN\./);
  assert.match(client, /New PIN/);
  assert.match(client, /Confirm PIN/);
  assert.match(client, /action: "pin_setup"/);
  assert.match(client, /PIN or invitation code/);
  assert.match(client, /Invitation code/);
  assert.doesNotMatch(client, /value=\{?"?101315/);
});
