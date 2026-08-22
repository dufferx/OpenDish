import { expect, type Page } from '@playwright/test'

/**
 * Configures BYOK AI credentials through the real Settings UI, pointing the
 * provider base URL at a locally started fake OpenAI-compatible server
 * (see `fake-ai-server.ts`). The Edge Functions runtime executes inside
 * Docker, not on the Playwright host, so the reachable loopback address
 * differs by platform; each candidate base URL is tried in turn through the
 * real form submission (mirroring `scripts/local/lib.mjs`'s smoke check)
 * until one validates successfully.
 */
export async function configureAiWithFakeProvider(
  page: Page,
  baseUrlCandidates: string[],
): Promise<void> {
  await page.goto('/settings')
  await page.getByLabel('API key').fill('sk-e2e-fake-key')
  await page.getByLabel('Model').fill('e2e-fake-model')

  const baseUrlInput = page.getByLabel('Base URL')
  const saveButton = page.getByRole('button', { name: /save and verify/i })

  let lastCandidate: string | null = null
  for (const candidate of baseUrlCandidates) {
    lastCandidate = candidate
    await baseUrlInput.fill(candidate)
    await saveButton.click()

    const success = page
      .getByText('AI settings saved and verified.')
      .waitFor({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false)

    if (await success) return
  }

  throw new Error(
    `Could not reach the local fake AI server from any candidate base URL (last tried: ${lastCandidate ?? 'none'}).`,
  )
}

/** Asserts the AI configuration status is currently reported as verified. */
export async function expectAiConfigured(page: Page): Promise<void> {
  await expect(page.getByText(/is configured with model/i)).toBeVisible()
}
