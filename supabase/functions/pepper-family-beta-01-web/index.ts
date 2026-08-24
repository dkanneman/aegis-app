const APP_URL = 'https://pepper-family-beta.vercel.app/pepper';
const API_URL = 'https://olgyfgqlqrhfaujkfjtj.supabase.co/functions/v1/pepper-family-api';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-pepper-session',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const incoming = new URL(req.url);

  if (req.method === 'GET') {
    const target = new URL(APP_URL);
    for (const [key, value] of incoming.searchParams.entries()) {
      target.searchParams.set(key, value);
    }
    return Response.redirect(target.toString(), 303);
  }

  if (req.method === 'POST') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const session = req.headers.get('x-pepper-session');
    if (session) headers['x-pepper-session'] = session;

    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: await req.text(),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
    status: 405,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
});
