import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {buildDailyPlan} from '../functions/pepper-family-api/day-planning.ts'

const url=new URL(process.env.PEPPER_TEST_DATABASE_URL||'')
assert.equal(url.hostname,'127.0.0.1')
assert.equal(url.password,'postgres')
const {default:postgres}=await import(process.env.PEPPER_TEST_POSTGRES_MODULE)
const source=await readFile(new URL('../functions/pepper-family-api/index.ts',import.meta.url),'utf8')
// Execute the actual handler's boundary statement, not a separately corrected test query.
const statement=source.match(/sql<any\[\]>`(select now\(\) as now,[^`]+as day_end)`/)[1]
  .replaceAll('${today}','$1').replaceAll('${TZ}','$2')

test('actual day-plan SQL uses Pacific midnight across PDT, PST and both DST transitions',async()=>{
  const sql=postgres(url.href,{ssl:false,prepare:false,max:1})
  try {
    for(const [date,start,end] of [
      ['2026-09-30','2026-09-30T07:00:00.000Z','2026-10-01T07:00:00.000Z'],
      ['2026-12-01','2026-12-01T08:00:00.000Z','2026-12-02T08:00:00.000Z'],
      ['2026-03-08','2026-03-08T08:00:00.000Z','2026-03-09T07:00:00.000Z'],
      ['2026-11-01','2026-11-01T07:00:00.000Z','2026-11-02T08:00:00.000Z'],
    ]) {
      const [bounds]=await sql.unsafe(statement,[date,'America/Los_Angeles'])
      assert.equal(bounds.day_start.toISOString(),start)
      assert.equal(bounds.day_end.toISOString(),end)
    }
    const [bounds]=await sql.unsafe(statement,['2026-09-30','America/Los_Angeles'])
    const plan=buildDailyPlan({now:'2026-09-30T19:00:00Z',dayStart:bounds.day_start.toISOString(),dayEnd:bounds.day_end.toISOString(),timeZone:'America/Los_Angeles',tasks:[],meals:[],events:[
      {id:'work',title:'[PEPPER TEST] work',starts_at:'2026-09-30T15:30:00Z',ends_at:'2026-10-01T00:00:00Z'},
      {id:'practice',title:'[PEPPER TEST] practice',starts_at:'2026-09-30T22:30:00Z',ends_at:'2026-09-30T23:40:00Z'},
      {id:'evening',title:'[PEPPER TEST] evening',starts_at:'2026-10-01T01:30:00Z',ends_at:'2026-10-01T02:00:00Z'},
    ],emails:[{id:'mail',subject:'[PEPPER TEST] please confirm',action_score:8,reason:'Suggested: respond to an explicit request'}]})
    assert.equal(plan.counts.events,3)
    assert.equal(plan.counts.emails,1)
    assert.ok(Date.parse(plan.items.find(item=>item.kind==='email').scheduled_for)>Date.parse('2026-10-01T00:00:00Z'))
  } finally {await sql.end()}
})
