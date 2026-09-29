// Local-only provider double. The launcher blocks network egress independently.
import postgres from 'npm:postgres@3.4.7';
const database = new URL(Deno.env.get('SUPABASE_DB_URL'));
if (database.hostname !== 'pepper-oauth-db' || Deno.env.get('GOOGLE_CLIENT_ID') !== 'pepper-local-dummy-client') throw new Error('Local dummy environment required');
const db = postgres(database.href, { ssl: false, max: 1 });
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'local-only' };
const encode = value => btoa(typeof value === 'string' ? value : JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
let config = {}, calls = [], calendar = null, events = new Map();
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = init.method || 'GET';
  calls.push({ path: url.pathname, method });
  if (url.href === 'https://oauth2.googleapis.com/token') {
    if (!config.success) return reply({ error: 'invalid_grant', error_description: 'LOCAL FAILURE DOUBLE' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', kid: 'local-only' })}.${encode({ iss: 'https://accounts.google.com', aud: 'pepper-local-dummy-client', sub: 'local-test-subject', email: 'pepper-test@example.invalid', email_verified: true, iat: now, exp: now + 600, nonce: config.nonce })}`;
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(unsigned)));
    return reply({ access_token: 'local-dummy-access', refresh_token: 'local-dummy-refresh', scope: 'openid email https://www.googleapis.com/auth/calendar.app.created', id_token: `${unsigned}.${encode(String.fromCharCode(...signature))}` });
  }
  if (url.href === 'https://www.googleapis.com/oauth2/v3/certs') {
    if (config.revokeAfterExchange) await db`update public.member_sessions set revoked_at=now() where session_id=${config.revokeAfterExchange}::uuid`;
    return reply({ keys: [jwk] });
  }
  if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') return reply({ sub: 'local-test-subject', email: 'pepper-test@example.invalid', email_verified: true });
  if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/calendar/v3/calendars')) throw new Error('External fetch blocked');
  if (url.pathname === '/calendar/v3/calendars' && method === 'POST') {
    calendar = { ...JSON.parse(init.body), id: `${crypto.randomUUID()}@group.calendar.google.com`, dataOwner: 'pepper-test@example.invalid' };
    return reply(calendar);
  }
  const parts = url.pathname.split('/').map(decodeURIComponent);
  if (!calendar || parts[4] !== calendar.id) return reply({}, 404);
  if (parts.length === 5) {
    if (method === 'DELETE') { calendar = null; return new Response(null, { status: 204 }); }
    return reply(calendar);
  }
  if (parts[5] !== 'events') throw new Error('Unsupported local provider route');
  if (parts.length === 6) {
    if (method === 'POST') { const event = { ...JSON.parse(init.body), status: 'confirmed' }; events.set(event.id, event); return reply(event); }
    return reply({ items: [] });
  }
  const id = parts[6];
  if (method === 'DELETE') {
    events.set(id, { id, status: 'cancelled' });
    if (config.revokeAfterProbe) await db`update public.member_sessions set revoked_at=now() where session_id=${config.revokeAfterProbe}::uuid`;
    return new Response(null, { status: 204 });
  }
  return events.has(id) ? reply(events.get(id)) : reply({}, 404);
};
const serve = Deno.serve.bind(Deno);
Deno.serve = handler => serve(async request => {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/__test/reset' && request.method === 'POST') { config = await request.json(); calls = []; calendar = null; events = new Map(); return reply({ ok: true }); }
  if (pathname === '/__test/metrics') return reply({ calls, exchanges: calls.filter(c => c.path === '/token').length });
  return handler(request);
});
await import('../functions/pepper-calendar/index.ts');
