import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareWorkTasks,
  isWorkTask,
  workPriority,
} from '../app/pepper/pepper-work.ts'

test('work classification uses canonical metadata without matching homework', () => {
  assert.equal(isWorkTask({ title: 'Client follow-up', area: 'Work' }), true)
  assert.equal(isWorkTask({ title: 'Bid review', project: 'C.W. Warren' }), true)
  assert.equal(isWorkTask({ title: 'Site visit', tags: ['work', 'client'] }), true)
  assert.equal(isWorkTask({ title: 'Finish homework', area: 'Kids' }), false)
})

test('work priorities normalize One Brain priority labels', () => {
  assert.equal(workPriority({ title: 'A', priority: 'P0' }), 'critical')
  assert.equal(workPriority({ title: 'B', priority: 'high' }), 'high')
  assert.equal(workPriority({ title: 'C', priority: 'P2' }), 'planned')
  assert.equal(workPriority({ title: 'D', priority: 'low' }), 'later')
  assert.equal(workPriority({ title: 'E' }), 'unprioritized')
})

test('work tasks sort active work, dated work, then undated work', () => {
  const tasks = [
    { title: 'Undated', status: 'open' },
    { title: 'Later due', status: 'open', due_at: '2026-09-10T17:00:00Z' },
    { title: 'In progress', status: 'in_progress' },
    { title: 'Sooner due', status: 'open', due_at: '2026-09-03T17:00:00Z' },
  ].sort(compareWorkTasks)

  assert.deepEqual(
    tasks.map((task) => task.title),
    ['In progress', 'Sooner due', 'Later due', 'Undated'],
  )
})
