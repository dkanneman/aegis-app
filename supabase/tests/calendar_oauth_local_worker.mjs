// LOCAL TEST ENTRYPOINT ONLY. Never deploy this wrapper as an Edge Function.
// Run on an internal Docker network with only the disposable database attached.
// The production handler and postgres driver are real; provider exchange is a
// labeled failure double. No Google credentials or network requests are used.
const database = new URL(Deno.env.get('SUPABASE_DB_URL') || '');
if (!['127.0.0.1', 'localhost', 'pepper-oauth-db'].includes(database.hostname)) {
  throw new Error('The OAuth database gate requires a disposable local database.');
}
for (const [name, value] of Object.entries({
  PEPPER_DB_SSL: 'disable',
  PEPPER_CALENDAR_MODE: 'sandbox',
  PEPPER_GOOGLE_ACCOUNT_EMAIL: 'pepper-test@example.invalid',
  PEPPER_APP_URL: 'http://127.0.0.1:4189/pepper',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  GOOGLE_CLIENT_ID: 'pepper-local-dummy-client',
  GOOGLE_CLIENT_SECRET: 'pepper-local-dummy-secret',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:54329/functions/v1/pepper-calendar/callback',
  SUPABASE_SERVICE_ROLE_KEY: 'pepper-local-dummy-service',
})) Deno.env.set(name, value);

globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'LOCAL TEST DOUBLE: exchange intentionally rejected',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('LOCAL TEST: external fetch blocked');
};

await import('../functions/pepper-calendar/index.ts');
