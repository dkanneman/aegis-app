import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { classifyPiece, coordinationTargets, dayBounds, splitCapture } from '../supabase/functions/pepper-tell-v2/logic.ts'

const today = '2026-09-28'
test('exact release request keeps explicit shared event and its location together', () => {
  const request='Create a shared family event titled [PEPPER TEST] Release verification 20260929 at 4:00 PM on October 15, 2026 in America/Los_Angeles. Location: Synthetic test room.'
  const parts=splitCapture(request)
  assert.equal(parts.length,1)
  const event=classifyPiece(parts[0],'2026-09-29')
  assert.equal(event.type,'event.create')
  assert.equal(event.title,'[PEPPER TEST] Release verification 20260929')
  assert.equal(new Date(event.time).toISOString(),'2026-10-15T23:00:00.000Z')
  assert.equal(event.location,'Synthetic test room')
  assert.equal(event.private,false)
  assert.equal(classifyPiece('Create a checklist for the family outing',today).type,'task')
  assert.equal(classifyPiece('Create a shared family event',today).type,'ambiguous')
  assert.equal(splitCapture('Create a checklist. Location: Synthetic test room.').length,2)
})
test('capture Undo preserves microseconds and reports failed or pending reversal visibly', () => {
  const tell=readFileSync(new URL('../supabase/functions/pepper-tell-v2/index.ts',import.meta.url),'utf8')
  const undo=tell.slice(tell.indexOf('async function undoCapture'),tell.indexOf('async function appendCapture'))
  assert.equal((undo.match(/updated_at=\$\{expectedUpdatedAt\}::text::timestamptz/g)||[]).length,6)
  assert.ok(undo.includes('invokeCalendarPublisher(captureId,eventId)'))
  assert.ok(undo.includes("status:complete?'undone':'retry_required'"))
  const ui=readFileSync(new URL('../app/pepper/pepper-client.tsx',import.meta.url),'utf8')
  const uiUndo=ui.slice(ui.indexOf('async function undoPepperExchange'),ui.indexOf('async function undoAutomaticCapture'))
  assert.ok(uiUndo.includes('undoable: result.undoable === true'))
  assert.ok(uiUndo.includes('catch (error)'))
})
test('profile switch clears stale proposal feedback and Inbox distinguishes approval from delivery', () => {
  const source = readFileSync(new URL('../app/pepper/pepper-client.tsx', import.meta.url), 'utf8')
  const logout = source.slice(source.indexOf('async function logout()'), source.indexOf('async function deleteAccount('))
  for (const reset of ['setPepperExchange(null)', 'setTell("")', 'setMessage("")']) assert.ok(logout.includes(reset))
  assert.ok(source.includes('capture_review_decide'))
  assert.ok(source.includes('delivery_complete'))
  assert.ok(source.includes('Delivery pending'))
})
const members = [
  { slug: 'matt', display_name: 'Matt' },
  { slug: 'chloe', display_name: 'Chloe' },
  { slug: 'lyra', display_name: 'Lyra' },
  { slug: 'parent-2', display_name: 'Robin Smith' },
  { slug: 'child-4', display_name: 'Alex Smith' },
]
const practice = { id: 'practice', person_slug: 'chloe', title: 'Chloe practice', starts_at: '2026-09-28T22:15:00Z', ends_at: '2026-09-28T23:30:00Z' }

test('pickup resolves household-configured names without assuming this family', () => {
  assert.deepEqual(classifyPiece('Robin is picking up Alex.', today, members), {
    type: 'ride.assign', driverSlug: 'parent-2', personSlug: 'child-4', time: null,
  })
  assert.equal(classifyPiece('Matt is picking up Chloe.', today, members).type, 'ride.assign')
})

test('possessive cancellation targets the activity rather than becoming a new event', () => {
  const intent = classifyPiece('Lyra’s rehearsal is canceled.', today, members)
  assert.equal(intent.type, 'event.cancel')
  assert.equal(intent.personSlug, 'lyra')
  assert.equal(intent.titleWord, 'rehearsal')
})

test('multiple activities require clarification, never a broad pickup reassignment', () => {
  const intent = classifyPiece('Matt is picking up Chloe.', today, members)
  assert.deepEqual(coordinationTargets([practice], intent, 'Matt is picking up Chloe.', today), [practice])
  assert.deepEqual(coordinationTargets([practice, { ...practice, id: 'dentist', title: 'Dentist' }], intent, 'Matt is picking up Chloe.', today), [])
})

test('pickup time selects the activity end without changing any event time', () => {
  const original = structuredClone(practice)
  const source = 'Matt is picking up Chloe at 4:30 PM.'
  const intent = classifyPiece(source, today, members)
  assert.deepEqual(coordinationTargets([practice], intent, source, today), [practice])
  assert.deepEqual(practice, original)
  assert.deepEqual(coordinationTargets([practice], { ...intent, time: '2026-09-28T23:45:00Z' }, source, today), [])
})

test('tomorrow is not silently mapped onto today and unknown targets are held', () => {
  const source = 'Matt is picking up Chloe tomorrow.'
  assert.deepEqual(coordinationTargets([practice], classifyPiece(source, today, members), source, today), [])
  assert.deepEqual(coordinationTargets([], classifyPiece(source, today, members), source, today), [])
})

test('ambiguous first names cannot resolve to an arbitrary member', () => {
  const names = [...members, { slug: 'alex-2', display_name: 'Alex Jones' }]
  assert.equal(classifyPiece('Robin is picking up Alex.', today, names).type, 'ambiguous')
})

test('a meeting at four is held for AM/PM clarification rather than guessed', () => {
  assert.equal(classifyPiece('I have a meeting at four.', today, members).type, 'ambiguous')
})

test('leftovers is a meal change without an invented dinner time', () => {
  assert.deepEqual(classifyPiece("We're having leftovers tonight.", today, members), {
    type: 'meal', mealName: 'Leftovers', time: null,
  })
})

test('day boundaries follow Pacific standard time and daylight-saving transitions', () => {
  assert.deepEqual(dayBounds('2026-12-01'), ['2026-12-01T08:00:00.000Z', '2026-12-02T08:00:00.000Z'])
  assert.deepEqual(dayBounds('2026-11-01'), ['2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'])
})

async function legacyRequest(member, body) {
  let handler
  const calls=[]
  const chain=new Proxy({}, { get(_target,key) {
    if(key==='maybeSingle') return async()=>({data:{household_members:member}})
    return ()=>chain
  } })
  const source=readFileSync(new URL('../supabase/functions/pepper-family-beta-01/index.ts',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'')
  vm.runInNewContext(stripTypeScriptTypes(source),{
    createClient:()=>({from:()=>chain}),URL,Response,Date,Intl,
    Deno:{env:{get:name=>name==='SUPABASE_URL'?'http://127.0.0.1:54321':'dummy'},serve:value=>{handler=value}},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({error:'Not your responsibility.'},{status:403})},
  })
  const response=await handler(new Request('http://untrusted.invalid/functions/v1/pepper-family-beta-01',{method:'POST',headers:{'x-pepper-session':'dummy-session'},body:JSON.stringify(body)}))
  return {response,calls}
}

test('legacy task mutations use the guarded family API rather than bypassing child permissions', async()=>{
  const {response,calls}=await legacyRequest({id:'child',role:'child',active:true,removed_at:null},{action:'task',id:'someone-elses-chore',status:'completed'})
  assert.equal(response.status,403)
  assert.equal(calls.length,1)
  assert.equal(calls[0].url,'http://127.0.0.1:54321/functions/v1/pepper-family-api')
  assert.equal(calls[0].body.id,'someone-elses-chore')
})

test('legacy grocery mutations preserve canonical failure instead of reporting success', async()=>{
  const {response,calls}=await legacyRequest({active:true,removed_at:null},{action:'grocery',id:'item',status:'completed'})
  assert.equal(response.status,403)
  assert.equal(calls.length,1)
  assert.equal((await response.json()).error,'Not your responsibility.')
})

test('legacy inactive and removed sessions never reach the mutation handler', async()=>{
  for(const member of [{active:false,removed_at:null},{active:true,removed_at:'2026-09-28'},null]) {
    const {response,calls}=await legacyRequest(member,{action:'task',id:'task',status:'completed'})
    assert.equal(response.status,401)
    assert.equal(calls.length,0)
  }
})
