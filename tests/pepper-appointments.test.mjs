import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMedicalAppointment,
  isMedicalCareTask,
} from '../app/pepper/pepper-appointments.ts'
import { inferPerson, kindFor } from '../supabase/functions/pepper-calendar/logic.ts'

const members = [
  { slug: 'chloe', display_name: 'Chloe' },
  { slug: 'lyra', display_name: 'Lyra' },
  { slug: 'posey', display_name: 'Posey' },
]

test('calendar intake classifies common medical appointments', () => {
  assert.equal(kindFor('Posey - Dr. Patel check-up'), 'appointment')
  assert.equal(kindFor('Chloe orthodontist'), 'appointment')
  assert.equal(kindFor('Lyra eye exam at optometrist'), 'appointment')
  assert.equal(
    kindFor('Las Colinas track run Fieldcrest Dr', 'Las Colinas track run'),
    'activity',
  )
  assert.equal(kindFor('Client meeting'), 'work')
})

test('named medical appointments attach to the correct family member', () => {
  assert.equal(inferPerson("Chloe's dentist appointment", members), 'chloe')
  assert.equal(inferPerson('Dr. visit - Posey', members), 'posey')
})

test('member pages recognize legacy medical events before resync', () => {
  assert.equal(
    isMedicalAppointment({ title: 'Pediatrician', kind: 'activity' }),
    true,
  )
  assert.equal(
    isMedicalAppointment({ title: 'School rehearsal', kind: 'activity' }),
    false,
  )
  assert.equal(
    isMedicalAppointment({
      title: 'Track run',
      location: '5750 Fieldcrest Dr',
      kind: 'activity',
    }),
    false,
  )
})

test('medical care tasks stay distinct from unrelated household care', () => {
  assert.equal(
    isMedicalCareTask({
      title: "Prepare for Lyra's pulmonology appointment",
      area: 'Kids',
      project: 'Lyra Care',
    }),
    true,
  )
  assert.equal(
    isMedicalCareTask({
      title: "Confirm Maggie's wellness status",
      area: 'Home',
      project: 'Maggie Care',
    }),
    false,
  )
})
