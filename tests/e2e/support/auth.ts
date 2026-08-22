import { expect, type Page } from '@playwright/test'

/** A password satisfying Supabase Auth's default minimum length. */
export const E2E_PASSWORD = 'Sup3r-Secret-Passphrase-23'

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`
}

/**
 * Creates a brand-new account through the real sign-up UI and waits for the
 * app to land on an authenticated route. The local profile disables email
 * confirmation (`supabase/config.toml` -> `[auth.email].enable_confirmations
 * = false`), so a session is established immediately without Mailpit.
 */
export async function signUp(
  page: Page,
  email: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto('/login')
  await page
    .getByRole('group', { name: 'Authentication mode' })
    .getByRole('button', { name: 'Create account' })
    .click()

  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password').fill(password)

  await page
    .locator('form[aria-label="Create account form"]')
    .getByRole('button', { name: 'Create account' })
    .click()

  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
}

/** Signs in with an existing email/password account through the real UI. */
export async function signIn(
  page: Page,
  email: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)

  await page
    .locator('form[aria-label="Email sign in form"]')
    .getByRole('button', { name: 'Sign in' })
    .click()

  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
}

/** Signs out through the primary nav's sign-out control and confirms the redirect to /login. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign out/i }).click()
  await expect(page).toHaveURL(/\/login$/)
}
