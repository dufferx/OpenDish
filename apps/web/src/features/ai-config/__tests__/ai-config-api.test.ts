import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAiConfigurationStatus } from '@/features/ai-config/ai-config-api';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

describe('AI configuration API diagnostics', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('accepts Postgres timestamps serialized with a UTC offset', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        configured: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'valid',
        lastVerifiedAt: '2026-08-21T19:48:59.855+00:00',
      },
      error: null,
    });

    await expect(fetchAiConfigurationStatus()).resolves.toMatchObject({
      configured: true,
      lastVerifiedAt: '2026-08-21T19:48:59.855+00:00',
    });
  });
});
