import { expect, test } from '@playwright/test'

import { configureAiWithFakeProvider } from '../support/ai-config'
import { E2E_PASSWORD, signIn, signOut, signUp, uniqueEmail } from '../support/auth'
import { startFakeAiServer, type FakeAiServerHandle } from '../support/fake-ai-server'

const GENERATED_DRAFT = {
  title: 'AI Suggested Chicken Bowl',
  description: 'A quick weeknight dinner idea.',
  servings: 2,
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  sourceName: null,
  sourceUrl: null,
  ingredients: [
    { name: 'Chicken breast', quantity: { num: 1, den: 1 }, unit: 'pound' },
  ],
  steps: [{ text: 'Cook the chicken through.' }],
  tags: ['quick'],
}

test.describe('Portable Auth', () => {
  test('redirects unauthenticated visitors to sign in and hides the optional Google provider when disabled', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')
    await expect(page.getByRole('heading', { name: 'OpenDish' })).toBeVisible()

    // The local profile ships with [auth.external.google] disabled, so the
    // provider-independent email/password baseline must be usable without
    // any Google-shaped affordance appearing (FR-037).
    await expect(
      page.getByRole('button', { name: /continue with google/i }),
    ).toHaveCount(0)

    // A deep link to a protected route redirects too, remembering where the
    // user was headed (AuthGuard).
    await page.goto('/shopping-list')
    await page.waitForURL((url) => url.pathname === '/login')
  })

  test('creates an account, establishes an email/password session, and signs out', async ({
    page,
  }) => {
    const email = uniqueEmail('auth-session')
    await signUp(page, email)
    await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible()

    await signOut(page)
    await expect(page.getByRole('heading', { name: 'OpenDish' })).toBeVisible()

    // The session is real (not just client-side state): signing back in
    // with the same credentials must work against the same account.
    await signIn(page, email, E2E_PASSWORD)
    await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible()
  })
})

test.describe('AI recipe generation (SC-002)', () => {
  let fakeAi: FakeAiServerHandle

  test.beforeAll(async () => {
    fakeAi = await startFakeAiServer(GENERATED_DRAFT)
  })

  test.afterAll(async () => {
    await fakeAi.close()
  })

  test('generates a recipe through conversation, is reviewed and edited, and then behaves like any other recipe', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    await signUp(page, uniqueEmail('generation-flow'))
    await configureAiWithFakeProvider(page, fakeAi.baseUrlCandidates)

    await page.goto('/generate')
    await page
      .getByLabel('Message')
      .fill('I have chicken breast and want something quick.')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(
      page.getByRole('heading', { name: 'Review AI-generated recipe' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('Title *')).toHaveValue(GENERATED_DRAFT.title)
    await expect(
      page.getByText('AI-generated values are estimates, please review.'),
    ).toBeVisible()

    // Review and edit before saving (FR-022) — nothing is persisted yet.
    await page.getByLabel('Title *').fill('AI Suggested Chicken Bowl (mine)')
    await page
      .getByRole('button', { name: 'Save generated recipe' })
      .click()

    await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/)
    await expect(
      page.getByRole('heading', { name: 'AI Suggested Chicken Bowl (mine)' }),
    ).toBeVisible()

    // From here it must behave exactly like a manually created recipe:
    // editable, scalable, and addable to the shopping list.
    await expect(page.getByRole('link', { name: /edit/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add to list' }),
    ).toBeVisible()
    await expect(page.getByLabel('Servings')).toHaveValue('2')
  })
})

test.describe('Cross-user data isolation', () => {
  test('one account cannot read another account\'s recipe', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    await signUp(page, uniqueEmail('owner'))
    await page.goto('/recipes/new')
    await page.getByLabel('Title *').fill('Owner-Only Recipe')
    await page.getByLabel('Servings *').fill('2')
    await page.getByLabel('Ingredient 1 name').fill('Salt')
    await page.getByLabel('Step 1', { exact: true }).fill('Season to taste.')
    await page.getByRole('button', { name: 'Create recipe' }).click()
    await expect(
      page.getByRole('heading', { name: 'Owner-Only Recipe' }),
    ).toBeVisible()
    const ownerRecipeUrl = page.url()

    await signOut(page)
    await signUp(page, uniqueEmail('outsider'))
    await expect(page.getByText('No recipes yet')).toBeVisible()

    await page.goto(ownerRecipeUrl)
    await expect(page.getByText('Recipe not found')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Owner-Only Recipe' }),
    ).toHaveCount(0)
  })
})
