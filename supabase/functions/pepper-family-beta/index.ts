import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pepper-session',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const TZ = 'America/Los_Angeles';
const todayLA = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#faf8f3"><meta name="apple-mobile-web-app-capable" content="yes"><title>Pepper</title><style>:root{--ink:#17313c;--blue:#dcebf3;--navy:#244c60;--paper:#faf8f3;--line:#d8dde0;--muted:#71808a;--warn:#fff4cf}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:760px;margin:auto;padding:24px 18px 100px}.brand{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.brand h1{font-family:Georgia,serif;font-size:32px;margin:0}.eyebrow{display:inline-block;background:var(--blue);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:800;letter-spacing:.12em}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:18px;margin:14px 0;box-shadow:0 8px 28px rgba(28,53,65,.05)}h2{font-family:Georgia,serif;font-size:30px;margin:8px 0}.muted{color:var(--muted)}.tell{background:var(--navy);color:white}.row{display:flex;gap:10px;align-items:center}.row input,.row select,textarea{width:100%;font-size:16px;border:1px solid #cfd7dc;border-radius:14px;padding:13px;background:white}.row button,button{border:0;border-radius:14px;padding:13px 16px;font-weight:800;background:var(--blue);color:var(--ink)}.tell button{background:#e4f0f6}.item{padding:13px 0;border-bottom:1px solid #edf0f1}.item:last-child{border:0}.time{font-weight:800}.pill{font-size:12px;background:#edf4f7;padding:5px 8px;border-radius:999px;margin-left:7px}.pending{background:var(--warn);border-radius:12px;padding:10px;margin-top:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.hidden{display:none}.login{min-height:85vh;display:flex;align-items:center}.login .card{width:100%}.status{font-size:14px;margin-top:10px}.bottom{position:fixed;left:0;right:0;bottom:0;background:rgba(250,248,243,.96);border-top:1px solid var(--line);padding:12px 18px calc(12px + env(safe-area-inset-bottom));text-align:center;font-size:13px;color:var(--muted)}@media(max-width:520px){.grid{grid-template-columns:1fr}.wrap{padding-top:18px}h2{font-size:27px}}</style></head><body><div class="wrap"><div id="login" class="login"><div class="card"><span class="eyebrow">PEPPER FAMILY BETA 0.2</span><h2>Join the Eriksen Family</h2><p class="muted">Choose who this phone belongs to. Pepper will remember this device.</p><div class="row"><select id="member"><option value="elle">Elle</option><option value="matt">Matt</option><option value="lyra">Lyra</option><option value="chloe">Chloe</option><option value="posey">Posey</option></select></div><div class="row" style="margin-top:10px"><input id="pin" inputmode="numeric" maxlength="6" placeholder="Family PIN"><button onclick="login()">Join</button></div><div id="loginStatus" class="status muted"></div></div></div><div id="app" class="hidden"><div class="brand"><div><h1>Pepper</h1><div class="muted" id="who"></div></div><button onclick="logout()">Switch</button></div><span class="eyebrow">LIVING TODAY</span><h2 id="greeting">Hello.</h2><p class="muted">Tell Pepper what changed. Your words are saved first, then Pepper safely applies what it can.</p><div class="card tell"><strong>Tell Pepper what changed</strong><div class="row" style="margin-top:12px"><button onclick="listen()">🎙️</button><input id="tell" placeholder="Matt is getting Chloe…"><button onclick="tellPepper()">Send</button></div><div id="reply" class="status"></div></div><div class="card"><strong>Pepper Inbox · Never lost</strong><div id="inbox"></div></div><div class="card"><strong>Today</strong><div id="events"></div></div><div class="card"><strong>Pepper Noticed</strong><div id="noticed" style="margin-top:8px"></div></div><div class="grid"><div class="card"><strong>Family Tasks</strong><div id="familyTasks"></div></div><div class="card"><strong>My Tasks · Private</strong><div id="privateTasks"></div></div></div><div class="card"><strong>Groceries</strong><div id="groceries"></div></div><div class="card"><strong>Day Handled</strong><div id="handled"></div></div><div class="card"><strong>Gratitude</strong><textarea id="gratitude" rows="2" placeholder="What are you grateful for today?"></textarea><button style="margin-top:8px" onclick="reflect('gratitude','gratitude')">Save privately</button></div><div class="card"><strong>Evening Reflection</strong><textarea id="reflection" rows="3" placeholder="What felt good today? What do you want to remember?"></textarea><button style="margin-top:8px" onclick="reflect('reflection','reflection')">Save privately</button></div></div></div><div class="bottom">Pepper Family Beta 0.2 · save first, interpret second</div><script>const base=location.href.split('?')[0];let token=localStorage.getItem('pepper_session')||'';const $=id=>document.getElementById(id);function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}async function api(body){const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json','x-pepper-session':token},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Pepper hit an error.');return j}async function login(){try{$('loginStatus').textContent='Joining…';const j=await api({action:'login',member:$('member').value,pin:$('pin').value});token=j.token;localStorage.setItem('pepper_session',token);$('login').classList.add('hidden');$('app').classList.remove('hidden');await load()}catch(e){$('loginStatus').textContent=e.message}}function logout(){localStorage.removeItem('pepper_session');location.reload()}function fmt(t){return new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'})}function memberName(s,id){return (s.members||[]).find(m=>m.id===id)?.display_name||''}async function load(){if(!token)return;try{const {state:s}=await api({action:'state'});$('login').classList.add('hidden');$('app').classList.remove('hidden');$('who').textContent='Eriksen Family · '+s.member.display_name;const hr=new Date().getHours();$('greeting').textContent=(hr<12?'Good morning, ':hr<17?'Good afternoon, ':'Good evening, ')+s.member.display_name+'.';$('inbox').innerHTML=(s.captures||[]).map(c=>'<div class="item '+(c.status==='needs_review'?'pending':'')+'"><strong>'+esc(c.status==='needs_review'?'Needs review':'Saved')+'</strong><br>'+esc(c.original_text)+'</div>').join('')||'<div class="item muted">No recent captures.</div>';$('events').innerHTML=s.events.map(e=>'<div class="item"><span class="time">'+fmt(e.starts_at)+'</span> · '+esc(e.title)+(e.transport_owner_member_id?'<span class="pill">Driver: '+esc(memberName(s,e.transport_owner_member_id))+'</span>':e.kind==='transport'?'<span class="pill">Driver needed</span>':'')+'</div>').join('')||'<div class="item muted">Nothing scheduled.</div>';$('noticed').textContent=s.noticed;$('familyTasks').innerHTML=s.familyTasks.map(t=>'<div class="item"><label><input type="checkbox" '+(t.status==='completed'?'checked':'')+' onchange="task(\''+t.id+'\',this.checked)"> '+esc(t.title)+'</label></div>').join('')||'<div class="item muted">All clear.</div>';$('privateTasks').innerHTML=s.privateTasks.map(t=>'<div class="item"><label><input type="checkbox" '+(t.status==='completed'?'checked':'')+' onchange="task(\''+t.id+'\',this.checked)"> '+esc(t.title)+'</label></div>').join('')||'<div class="item muted">No private tasks.</div>';$('groceries').innerHTML=s.groceries.map(g=>'<div class="item"><label><input type="checkbox" '+(g.status==='completed'?'checked':'')+' onchange="grocery(\''+g.id+'\',this.checked)"> '+esc(g.item)+'</label></div>').join('');$('handled').innerHTML='<div class="item"><strong>'+s.metrics.completed+'</strong> completed</div><div class="item"><strong>'+s.metrics.coordinated+'</strong> coordinated</div><div class="item"><strong>'+s.metrics.caught+'</strong> needing attention</div>'}catch(e){$('reply').textContent=e.message}}async function tellPepper(){const text=$('tell').value.trim();if(!text)return;try{$('reply').textContent='Saving first…';const j=await api({action:'tell',text,source:'text'});$('reply').textContent=j.reply;$('tell').value='';await load()}catch(e){$('reply').textContent=e.message}}async function task(id,done){await api({action:'task',id,status:done?'completed':'open'});load()}async function grocery(id,done){await api({action:'grocery',id,status:done?'completed':'open'});load()}async function reflect(type,id){const text=$(id).value.trim();if(!text)return;await api({action:'reflect',type,text});$(id).value='';alert(type==='gratitude'?'Gratitude saved privately.':'Reflection saved privately.')}function listen(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){$('reply').textContent='Voice recognition is not available here. Use iPhone keyboard dictation in the same field.';return}const r=new SR();r.lang='en-US';r.interimResults=false;r.onresult=async e=>{const text=e.results[0][0].transcript;$('tell').value=text;try{$('reply').textContent='Saving voice note first…';const j=await api({action:'tell',text,source:'voice'});$('reply').textContent=j.reply;$('tell').value='';await load()}catch(err){$('reply').textContent=err.message}};r.start()}if(token){$('login').classList.add('hidden');$('app').classList.remove('hidden');load();setInterval(load,5000)}</script></body></html>`;

async function memberFrom(req: Request) {
  const token = req.headers.get('x-pepper-session');
  if (!token) return null;
  const { data } = await supabase
    .from('member_sessions')
    .select('member_id,household_members(id,slug,display_name,role,household_id)')
    .eq('token', token)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  await supabase.from('member_sessions').update({ last_seen_at: new Date().toISOString() }).eq('token', token);
  return data.household_members as any;
}

async function audit(m: any, type: string, entityType: string, entityId: string | null, summary: string) {
  await supabase.from('audit_log').insert({
    household_id: m.household_id,
    actor_member_id: m.id,
    event_type: type,
    entity_type: entityType,
    entity_id: entityId,
    summary,
  });
}

async function state(m: any) {
  const hid = m.household_id;
  const day = todayLA();
  const [members, events, familyTasks, privateTasks, meal, groceries, audits, captures] = await Promise.all([
    supabase.from('household_members').select('id,slug,display_name,role').eq('household_id', hid),
    supabase.from('events').select('*').eq('household_id', hid).neq('status', 'canceled').order('starts_at'),
    supabase.from('tasks').select('id,title,owner_member_id,status,visibility').eq('household_id', hid).eq('visibility', 'household').neq('status', 'canceled').order('created_at'),
    supabase.from('tasks').select('id,title,owner_member_id,status,visibility').eq('household_id', hid).eq('visibility', 'private').eq('owner_member_id', m.id).neq('status', 'canceled').order('created_at'),
    supabase.from('meal_plan').select('*').eq('household_id', hid).eq('meal_date', day).maybeSingle(),
    supabase.from('groceries').select('*').eq('household_id', hid).order('created_at'),
    supabase.from('audit_log').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(12),
    supabase.from('captures').select('id,original_text,status,source,captured_at').eq('household_id', hid).order('captured_at', { ascending: false }).limit(8),
  ]);
  const ev = events.data || [];
  const ft = familyTasks.data || [];
  const gr = groceries.data || [];
  const cp = captures.data || [];
  const unresolved = ev.filter((e: any) => e.kind === 'transport' && !e.transport_owner_member_id);
  const review = cp.filter((c: any) => c.status === 'needs_review');
  return {
    member: m,
    members: members.data || [],
    events: ev,
    familyTasks: ft,
    privateTasks: privateTasks.data || [],
    meal: meal.data,
    groceries: gr,
    captures: cp,
    audit: audits.data || [],
    noticed: review.length
      ? `${review.length} saved update${review.length === 1 ? '' : 's'} need safe reconciliation.`
      : unresolved.length
      ? `${unresolved[0].title} still needs transportation.`
      : 'No unresolved transportation or capture issues right now.',
    metrics: {
      completed: ft.filter((t: any) => t.status === 'completed').length + gr.filter((g: any) => g.status === 'completed').length,
      coordinated: (audits.data || []).filter((a: any) => a.event_type.includes('driver') || a.event_type.includes('assignment')).length,
      caught: unresolved.length + review.length,
    },
  };
}

function facts(text: string) {
  return text
    .split(/(?:\.|;|\band\b|\bthen\b)/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTime(s: string) {
  const m = s.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = +m[1], min = +(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const day = todayLA();
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-07:00`).toISOString();
}

function taskLike(raw: string) {
  const s = raw.trim();
  const explicit = s.match(/^(?:i|we)\s+(?:need|have)\s+to\s+(.+)$/i);
  if (explicit) return explicit[1].trim();
  if (/^(order|buy|call|email|pick up|return|confirm|look into|find|schedule|book|pay|upload|review|create|send|take|get|bring)\b/i.test(s)) return s;
  return null;
}

async function tell(m: any, text: string, source = 'text') {
  const clean = text.trim();
  if (!clean) throw new Error('Tell Pepper what changed first.');

  // Critical invariant: persist the original input BEFORE interpretation.
  const { data: capture, error: captureError } = await supabase
    .from('captures')
    .insert({
      household_id: m.household_id,
      member_id: m.id,
      source: source === 'voice' ? 'voice' : 'text',
      original_text: clean,
      status: 'captured',
    })
    .select('id')
    .single();
  if (captureError || !capture) throw new Error('Pepper could not safely save this update. Nothing was applied.');

  await audit(m, 'capture_saved', 'capture', capture.id, `Saved ${source === 'voice' ? 'voice' : 'text'} update before interpretation.`);

  const out: string[] = [];
  const applied: any[] = [];
  const extracted = facts(clean);
  const { data: members } = await supabase.from('household_members').select('*').eq('household_id', m.household_id);
  const by = (slug: string) => (members || []).find((x: any) => x.slug === slug);

  try {
    for (const raw of extracted) {
      const s = raw.toLowerCase();
      const tm = parseTime(raw);

      if (s.includes('lyra') && (s.includes('no rehearsal') || s.includes("doesn't have rehearsal") || s.includes('doesn’t have rehearsal') || s.includes('not have rehearsal'))) {
        const { data } = await supabase.from('events').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('household_id', m.household_id).ilike('title', '%Lyra%rehearsal%').select('id');
        out.push('Lyra’s rehearsal was canceled.');
        applied.push({ type: 'event_canceled', ids: (data || []).map((x: any) => x.id) });
        continue;
      }

      if (s.includes('matt') && (s.includes('getting chloe') || s.includes('get chloe') || s.includes('picking up chloe') || s.includes('pick up chloe'))) {
        const matt = by('matt');
        const updates: any = { transport_owner_member_id: matt?.id, transport_status: 'assigned', updated_at: new Date().toISOString() };
        if (tm) updates.starts_at = tm;
        const { data } = await supabase.from('events').update(updates).eq('household_id', m.household_id).ilike('title', '%Chloe%track%').select('id');
        out.push(`Matt has Chloe${tm ? ' at ' + new Date(tm).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : ''}.`);
        applied.push({ type: 'driver_assigned', ids: (data || []).map((x: any) => x.id) });
        continue;
      }

      if (s.includes('matt') && (s.includes("can't") || s.includes('can’t') || s.includes('cannot')) && s.includes('chloe')) {
        const { data } = await supabase.from('events').update({ transport_owner_member_id: null, transport_status: 'unassigned', updated_at: new Date().toISOString() }).eq('household_id', m.household_id).ilike('title', '%Chloe%track%').select('id');
        out.push('Chloe’s ride is open again.');
        applied.push({ type: 'driver_unassigned', ids: (data || []).map((x: any) => x.id) });
        continue;
      }

      if ((s.includes('meeting') || s.includes('appointment')) && tm) {
        const title = m.display_name + (s.includes('meeting') ? ' · meeting' : ' · appointment');
        const { data } = await supabase.from('events').insert({ household_id: m.household_id, title, person_slug: m.slug, starts_at: tm, visibility: 'private', owner_member_id: m.id, kind: 'private_availability' }).select('id').single();
        out.push(title.replace(' ·', '') + ' added.');
        applied.push({ type: 'event_created', id: data?.id });
        continue;
      }

      if (s.includes('dinner')) {
        const mealMatch = raw.match(/dinner\s+(?:is|will be)\s+(.+)/i);
        const updates: any = { updated_at: new Date().toISOString() };
        let meal = '';
        if (mealMatch) {
          meal = mealMatch[1].replace(/\bat\s+\d.*$/i, '').trim();
          if (meal) updates.meal_name = meal;
        }
        if (tm) updates.eat_at = tm;
        if (Object.keys(updates).length > 1) {
          await supabase.from('meal_plan').update(updates).eq('household_id', m.household_id).eq('meal_date', todayLA());
          const ev: any = { updated_at: new Date().toISOString() };
          if (meal) ev.title = 'Dinner · ' + meal;
          if (tm) ev.starts_at = tm;
          await supabase.from('events').update(ev).eq('household_id', m.household_id).eq('kind', 'meal');
          out.push('Dinner updated' + (meal ? ' to ' + meal : '') + '.');
          applied.push({ type: 'meal_updated', meal, time: tm });
          continue;
        }
      }

      if (s.startsWith('add ')) {
        const item = raw.replace(/^add\s+/i, '').replace(/\s+to\s+(groceries|shopping( list)?)$/i, '').trim();
        if (item) {
          const { data } = await supabase.from('groceries').insert({ household_id: m.household_id, item, added_by_member_id: m.id }).select('id').single();
          out.push(item + ' added to groceries.');
          applied.push({ type: 'grocery_added', id: data?.id });
          continue;
        }
      }

      const taskTitle = taskLike(raw);
      if (taskTitle) {
        const visibility = /\b(private|just for me|my private)\b/i.test(raw) ? 'private' : 'household';
        const { data } = await supabase.from('tasks').insert({
          household_id: m.household_id,
          title: taskTitle,
          creator_member_id: m.id,
          owner_member_id: visibility === 'private' ? m.id : null,
          visibility,
          source: 'pepper_capture',
        }).select('id').single();
        out.push(`Saved task: ${taskTitle}.`);
        applied.push({ type: 'task_created', id: data?.id, title: taskTitle });
      }
    }

    const status = applied.length === 0 ? 'needs_review' : applied.length < extracted.length ? 'partially_applied' : 'applied';
    await supabase.from('captures').update({
      status,
      extracted_facts: extracted,
      applied_changes: applied,
      updated_at: new Date().toISOString(),
    }).eq('id', capture.id);

    await audit(m, status === 'needs_review' ? 'capture_needs_review' : 'capture_reconciled', 'capture', capture.id,
      status === 'needs_review' ? 'Original update saved; no unsafe structured change was inferred.' : `Original update saved; ${applied.length} structured change(s) applied.`);

    return {
      captureId: capture.id,
      status,
      reply: applied.length
        ? `Saved first. ${out.join(' ')}${status === 'partially_applied' ? ' Anything I could not map safely remains in Pepper Inbox.' : ''}`
        : 'Saved to Pepper Inbox. I could not safely map it yet, so I kept the original update instead of losing it.',
    };
  } catch (e) {
    await supabase.from('captures').update({
      status: 'needs_review',
      extracted_facts: extracted,
      applied_changes: applied,
      updated_at: new Date().toISOString(),
    }).eq('id', capture.id);
    await audit(m, 'capture_apply_error', 'capture', capture.id, 'Original update preserved after a structured-write error.');
    return {
      captureId: capture.id,
      status: 'needs_review',
      reply: 'Your update is safely saved in Pepper Inbox. A structured change failed, so Pepper preserved the original instead of guessing.',
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    const h = new Headers();
    h.set('Content-Type', 'text/html; charset=utf-8');
    h.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(page, { status: 200, headers: h });
  }
  try {
    const b = await req.json();
    if (b.action === 'login') {
      const { data: m } = await supabase.from('household_members').select('*').eq('slug', String(b.member || '')).maybeSingle();
      if (!m) return Response.json({ error: 'Unknown family member.' }, { status: 401, headers: cors });
      const { data: ok } = await supabase.rpc('verify_pepper_pin', { member_id_input: m.id, pin_input: String(b.pin || '') });
      if (!ok) return Response.json({ error: 'That family PIN is not correct.' }, { status: 401, headers: cors });
      const { data: s } = await supabase.from('member_sessions').insert({ member_id: m.id, device_label: req.headers.get('user-agent')?.slice(0, 120) }).select('token').single();
      return Response.json({ token: s?.token }, { headers: cors });
    }

    const m = await memberFrom(req);
    if (!m) return Response.json({ error: 'Please join the Eriksen Family on this device.' }, { status: 401, headers: cors });

    if (b.action === 'state') return Response.json({ state: await state(m) }, { headers: cors });
    if (b.action === 'tell') {
      const result = await tell(m, String(b.text || ''), String(b.source || 'text'));
      return Response.json(result, { headers: cors });
    }
    if (b.action === 'task') {
      const { data: t } = await supabase.from('tasks').select('*').eq('id', b.id).single();
      if (!t || t.household_id !== m.household_id) return Response.json({ error: 'Task not found.' }, { status: 404, headers: cors });
      if (t.visibility === 'private' && t.owner_member_id !== m.id) return Response.json({ error: 'That task is private.' }, { status: 403, headers: cors });
      await supabase.from('tasks').update({ status: b.status, updated_at: new Date().toISOString() }).eq('id', b.id);
      await audit(m, b.status === 'completed' ? 'task_completed' : 'task_reopened', 'task', b.id, t.title + (b.status === 'completed' ? ' completed.' : ' reopened.'));
      return Response.json({ ok: true }, { headers: cors });
    }
    if (b.action === 'grocery') {
      const { data: g } = await supabase.from('groceries').select('*').eq('id', b.id).eq('household_id', m.household_id).single();
      if (!g) return Response.json({ error: 'Item not found.' }, { status: 404, headers: cors });
      await supabase.from('groceries').update({ status: b.status, completed_by_member_id: b.status === 'completed' ? m.id : null, updated_at: new Date().toISOString() }).eq('id', b.id);
      await audit(m, 'grocery_updated', 'grocery', b.id, g.item + (b.status === 'completed' ? ' picked up.' : ' put back.'));
      return Response.json({ ok: true }, { headers: cors });
    }
    if (b.action === 'reflect') {
      await supabase.from('reflections').insert({ household_id: m.household_id, member_id: m.id, type: b.type, original_text: String(b.text || '') });
      return Response.json({ ok: true }, { headers: cors });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ error: e?.message || 'Pepper hit an error.' }, { status: 500, headers: cors });
  }
});
