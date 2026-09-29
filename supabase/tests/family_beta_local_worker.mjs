// Local HTTP integration fixture only. Real handlers and PostgreSQL; no providers.
const database = new URL(Deno.env.get('SUPABASE_DB_URL') || '');
if (database.hostname !== 'pepper-oauth-db' || Deno.env.get('PEPPER_DB_SSL') !== 'disable') {
  throw new Error('Requires isolated dummy local database');
}
const serve = Deno.serve;
const handlers = new Map();
let service = 'pepper-family-api';
Deno.serve = (handler) => { handlers.set(service, handler); };
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/functions/v1/pepper-tell-v2') {
    return handlers.get('pepper-tell-v2')(request);
  }
  return new Response(JSON.stringify({ error: 'LOCAL TEST: provider unavailable; no external request made' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
};
await import('../functions/pepper-family-api/index.ts');
service = 'pepper-tell-v2';
await import('../functions/pepper-tell-v2/index.ts');
Deno.serve = serve;
serve(request => {
  const path = new URL(request.url).pathname;
  const handler = handlers.get(path.endsWith('/pepper-tell-v2') ? 'pepper-tell-v2' : 'pepper-family-api');
  return handler(request);
});
