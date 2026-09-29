// Local HTTP integration fixture only. Real handlers and PostgreSQL; no providers.
import postgres from 'npm:postgres@3.4.7';
const database = new URL(Deno.env.get('SUPABASE_DB_URL') || '');
if (database.hostname !== 'pepper-oauth-db' || Deno.env.get('PEPPER_DB_SSL') !== 'disable') {
  throw new Error('Requires isolated dummy local database');
}
const serve = Deno.serve;
const sql = postgres(database.href, {ssl:false,prepare:false,max:1});
let publisherMode = 'unavailable';
const publisherCalls = [];
const handlers = new Map();
let service = 'pepper-family-api';
Deno.serve = (handler) => { handlers.set(service, handler); };
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/functions/v1/pepper-tell-v2') {
    return handlers.get('pepper-tell-v2')(request);
  }
  if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/functions/v1/pepper-calendar') {
    const body = await request.json();
    if (body.action !== 'publish_event') return Response.json({error:'Unexpected publisher action'}, {status:400});
    publisherCalls.push({event_id:body.event_id,capture_id:body.capture_id,mode:publisherMode});
    if (publisherMode === 'success') {
      const rows = await sql`update public.events set sync_status='synced',last_sync_error=null where id=${body.event_id}::uuid and title like '[PEPPER TEST]%' returning id`;
      if (rows.length !== 1) return Response.json({error:'Synthetic event required'}, {status:403});
      return Response.json({ok:true,status:'synced',event_id:body.event_id});
    }
  }
  return new Response(JSON.stringify({ error: 'LOCAL TEST: provider unavailable; no external request made' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
};
await import('../functions/pepper-family-api/index.ts');
service = 'pepper-tell-v2';
await import('../functions/pepper-tell-v2/index.ts');
Deno.serve = serve;
serve(async request => {
  const path = new URL(request.url).pathname;
  if (path === '/__test/publisher') {
    if (request.method === 'POST') {
      const body=await request.json();
      if (!['success','unavailable'].includes(body.mode)) return new Response(null,{status:400});
      publisherMode=body.mode;
    }
    return Response.json({mode:publisherMode,calls:publisherCalls});
  }
  const handler = handlers.get(path.endsWith('/pepper-tell-v2') ? 'pepper-tell-v2' : 'pepper-family-api');
  return handler(request);
});
