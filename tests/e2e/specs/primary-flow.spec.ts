import { expect, test } from '@playwright/test'

import { configureAiWithFakeProvider } from '../support/ai-config'
import { signUp, uniqueEmail } from '../support/auth'
import { startFakeAiServer, type FakeAiServerHandle } from '../support/fake-ai-server'

/**
 * SC-001: create, save, converse about, modify, adjust servings for, and
 * shop from a recipe end to end (T074). Everything below drives the real
 * app UI against the local Supabase stack; the only stand-in is the AI
 * provider itself (`support/fake-ai-server.ts`), which never makes a live
 * call and is reached the same way a real OpenAI-compatible endpoint would
 * be — through the Settings UI and the real Edge Functions.
 */
test.describe('Primary flow (SC-001)', () => {
  let fakeAi: FakeAiServerHandle

  test.beforeAll(async () => {
    fakeAi = await startFakeAiServer({
      title: 'Fake AI Draft (unused in this flow)',
      description: null,
      servings: 2,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      sourceName: null,
      sourceUrl: null,
      ingredients: [{ name: 'Placeholder', quantity: null, unit: null }],
      steps: [{ text: 'Placeholder step.' }],
      tags: [],
    })
  })

  test.afterAll(async () => {
    await fakeAi.close()
  })

  test('create → save → chat → modify → adjust servings → shopping list', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    await signUp(page, uniqueEmail('primary-flow'))
    await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible()
    await expect(page.getByText('No recipes yet')).toBeVisible()

    // 1. Create a recipe manually and review it before saving lands.
    await page.goto('/recipes/new')
    await page.getByLabel('Title *').fill('Weeknight Tomato Pasta')
    await page.getByLabel('Servings *').fill('4')
    await page.getByLabel('Ingredient 1 name').fill('Spaghetti')
    await page.getByLabel('Ingredient 1 quantity').fill('1')
    await page.getByLabel('Ingredient 1 unit').fill('lb')
    await page.getByLabel('Step 1', { exact: true }).fill('Boil the pasta until al dente.')
    await page.getByRole('button', { name: 'Create recipe' }).click()

    await expect(
      page.getByRole('heading', { name: 'Weeknight Tomato Pasta' }),
    ).toBeVisible()
    await expect(page.getByText('4 saved servings').first()).toBeVisible()
    const recipeUrl = page.url()

    // 2. Configure AI (BYOK) against the local fake provider.
    await configureAiWithFakeProvider(page, fakeAi.baseUrlCandidates)

    // 3. Back on the recipe, ask an informational question — the saved
    // recipe must stay untouched.
    await page.goto(recipeUrl)
    await expect(
      page.getByRole('heading', { name: 'Recipe assistant' }),
    ).toBeVisible()
    await page.getByLabel('Answer a question').check()
    await page.getByLabel('Message').fill('How long does this take to cook?')
    await page.getByRole('button', { name: 'Ask AI' }).click()
    await expect(page.getByText('AI response').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText('4 saved servings').first()).toBeVisible()

    // 4. Request a modification, review the comparison, and apply it.
    await page.getByLabel('Suggest a modification').check()
    await page
      .getByLabel('Message')
      .fill('This needs to feed one more person.')
    await page.getByRole('button', { name: 'Request suggestion' }).click()
    await expect(
      page.getByRole('heading', { name: 'Review proposed changes' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByRole('region', { name: 'Current saved recipe' }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'AI suggested recipe' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('5 saved servings').first()).toBeVisible({
      timeout: 10_000,
    })

    // 5. Temporarily view a different serving count, then explicitly save
    // an adjustment — a recoverable, non-silent change (FR-013).
    const servingsInput = page.getByLabel('Servings')
    await servingsInput.fill('10')
    await expect(page.getByText('10 servings', { exact: true })).toBeVisible()
    const spaghettiRow = page.locator('li', { hasText: 'Spaghetti' })
    await expect(spaghettiRow).toContainText('2') // 1 lb scaled 5 -> 10 servings
    await expect(spaghettiRow).toContainText('lb')
    await page.getByRole('button', { name: 'Save adjustment' }).click()
    await expect(page.getByText('10 saved servings').first()).toBeVisible({
      timeout: 10_000,
    })

    // 6. Add the recipe (at its now-saved serving count) to the shopping
    // list and confirm it shows up ready to buy.
    await page.getByRole('button', { name: 'Add to list' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add to shopping list' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.goto('/shopping-list')
    await expect(page.getByRole('heading', { name: 'To buy' })).toBeVisible()
    await expect(
      page.getByText('Spaghetti', { exact: false }),
    ).toBeVisible()
  })
})
