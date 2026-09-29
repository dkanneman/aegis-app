// Disposable local preview only. Never deploy this entrypoint.
const database = new URL(Deno.env.get('SUPABASE_DB_URL') || '');
if (database.hostname !== 'pepper-oauth-db' || Deno.env.get('PEPPER_DB_SSL') !== 'disable') {
  throw new Error('Requires isolated synthetic local database');
}
const serve = Deno.serve;
const transport = globalThis.fetch;
const handlers = new Map();
let service;
Deno.serve = handler => { handlers.set(service, handler); };
const disabled = () => Response.json({ error: 'External connections are disabled in this local preview.' }, { status: 503 });
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== 'http://127.0.0.1:54321') return disabled();
  if (url.pathname.startsWith('/rest/v1/')) {
    const local = new URL(url.pathname.slice('/rest/v1'.length) + url.search, 'http://pepper-local-rest:3000');
    return transport(new Request(local, request));
  }
  const name = url.pathname.replace('/functions/v1/', '');
  const handler = handlers.get(name);
  if (!handler) return disabled();
  return handler(request);
};
service = 'pepper-family-api';
await import('../functions/pepper-family-api/index.ts');
service = 'pepper-family-beta-01';
await import('../functions/pepper-family-beta-01/index.ts');
service = 'pepper-tell-v2';
await import('../functions/pepper-tell-v2/index.ts');
service = 'pepper-consequences';
await import('../functions/pepper-consequences/index.ts');
service = 'pepper-preparation';
await import('../functions/pepper-preparation/index.ts');
service = 'pepper-reflections';
await import('../functions/pepper-reflections/index.ts');
service = 'pepper-rituals';
await import('../functions/pepper-rituals/index.ts');
service = 'pepper-horizon';
await import('../functions/pepper-horizon/index.ts');
// Integrations/Calendar/bridge are intentionally not loaded. No OAuth route exists.
Deno.serve = serve;
serve(async request => {
  if (request.method === 'OPTIONS') return handlers.get('pepper-family-api')(request);
  if (new URL(request.url).pathname !== '/functions/v1/pepper-family-api') return disabled();
  const body = request.method === 'POST' ? await request.clone().json().catch(() => ({})) : {};
  if (/calendar|gmail|email|health|connect|sync|account_delete|photo/.test(String(body.action || ''))) {
    const response = disabled();
    response.headers.set('Access-Control-Allow-Origin', 'http://127.0.0.1:4189');
    return response;
  }
  return handlers.get('pepper-family-api')(request);
});
