import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseMealWeek,
  uniqueGroceriesForWeek,
  wantsMealPlanRefresh,
} from '../supabase/functions/pepper-family-api/meal-planning.ts'

test('Pepper recognizes a reported repeated meal as a refresh request', () => {
  assert.equal(
    wantsMealPlanRefresh('Repeated a meal twice. We had fish last night.'),
    true,
  )
  assert.equal(wantsMealPlanRefresh('Add payroll to my work list'), false)
})

test('refresh rotates the existing plan and honors a recently eaten meal', () => {
  const meals = chooseMealWeek(
    [],
    ['Chicken rice bowls'],
    'We had fish last night. Refresh the meal plan.',
  )

  assert.equal(meals.length, 7)
  assert.notEqual(meals[0].name, 'Chicken rice bowls')
  assert.equal(meals.some((meal) => meal.flags.includes('fish')), false)
})

test('weekly groceries contain one row per normalized ingredient', () => {
  const meals = chooseMealWeek([], [], '', 7)
  const groceries = uniqueGroceriesForWeek(meals)
  const normalized = groceries.map((grocery) => grocery.normalizedItem)

  assert.equal(normalized.length, new Set(normalized).size)
  assert.equal(normalized.filter((item) => item === 'rice').length, 1)
  assert.equal(normalized.filter((item) => item === 'tomatoes').length, 1)
})
