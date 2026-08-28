import { describe, expect, it } from 'vitest';
import {
  err,
  FakeAiProvider,
  ok,
  validProposal,
  validRecipeDraft,
  type AiCredentials,
} from '../../../packages/contracts/src/index.ts';
import type { AuthVerifier } from '../_shared/http.ts';
import { createPreviewModificationHandler } from '../ai-preview-modification/handler.ts';

const CREDENTIALS: AiCredentials = { apiKey: 'sk-test', model: 'test-model' };

function request(body: unknown) {
  return new Request('http://localhost/ai-preview-modification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const options = (provider = new FakeAiProvider()) => ({
  verifyAuth: (async () => ({ ok: true, userId: '00000000-0000-0000-0000-000000000001' })) as AuthVerifier,
  provider,
  aiConfigReader: { async getConfig() { return { configured: true as const, credentials: CREDENTIALS }; } },
});

describe('ai-preview-modification handler', () => {
  it('returns a validated proposal without persistence', async () => {
    const provider = new FakeAiProvider({ proposeRecipeModification: ok(validProposal) });
    const response = await createPreviewModificationHandler(options(provider))(
      request({ draft: validRecipeDraft, request: 'Make it vegetarian.' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: { kind: 'proposal' } });
    expect(provider.calls[0]).toMatchObject({ method: 'proposeRecipeModification', request: 'Make it vegetarian.' });
  });

  it('requires authentication and a valid draft', async () => {
    const unauthenticated = createPreviewModificationHandler({
      ...options(), verifyAuth: (async () => ({ ok: false })) as AuthVerifier,
    });
    expect((await unauthenticated(request({ draft: validRecipeDraft, request: 'Change it' }))).status).toBe(401);

    const handler = createPreviewModificationHandler(options());
    expect((await handler(request({ draft: {}, request: '' }))).status).toBe(400);
  });

  it('maps provider failures safely', async () => {
    const provider = new FakeAiProvider({ proposeRecipeModification: err({ code: 'timeout', message: 'timeout' }) });
    const response = await createPreviewModificationHandler(options(provider))(
      request({ draft: validRecipeDraft, request: 'Change it' }),
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'provider_error' } });
  });
});
