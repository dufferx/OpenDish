import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiSettingsPage } from '@/features/ai-config';

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

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AiSettingsPage />
    </MemoryRouter>,
  );
  return { user };
}

function makeHttpError(message: string) {
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: {
      json: vi.fn().mockResolvedValue({
        error: { message },
      }),
    },
  };
}

describe('AiSettingsPage', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('renders the unconfigured state with setup guidance', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { configured: false },
      error: null,
    });

    renderPage();

    expect(
      await screen.findByText(
        /no ai provider is configured for this account yet/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/provider/i)).toHaveValue('OpenAI');
    expect(screen.getByLabelText(/api key/i)).toHaveValue('');
    expect(
      screen.getByText(/leave base url blank for the default endpoint/i),
    ).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith(
      'ai-configure',
      expect.objectContaining({
        body: { action: 'status' },
      }),
    );
  });

  it('renders a saved valid configuration without ever populating the API key', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        configured: true,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        baseUrl: 'https://api.openai.com/v1',
        status: 'valid',
        lastVerifiedAt: '2026-08-21T12:00:00.000Z',
      },
      error: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText(/model/i)).toHaveValue('gpt-4.1-mini');
    });
    expect(screen.getByText(/^Verified$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toHaveValue('');
    expect(screen.queryByDisplayValue(/sk-/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/model/i)).toHaveValue('gpt-4.1-mini');
    expect(screen.getByLabelText(/base url/i)).toHaveValue(
      'https://api.openai.com/v1',
    );
  });

  it('accepts status responses from deployments that predate base URL metadata', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        configured: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        status: 'valid',
        lastVerifiedAt: '2026-08-21T12:00:00.000Z',
      },
      error: null,
    });

    renderPage();

    expect(await screen.findByText(/^Verified$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/base url/i)).toHaveValue(
      'https://api.openai.com/v1',
    );
    expect(
      screen.queryByText(/settings response was invalid/i),
    ).not.toBeInTheDocument();
  });

  it('renders an invalid saved configuration that needs remediation', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        configured: true,
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        status: 'invalid',
        lastVerifiedAt: '2026-08-21T12:00:00.000Z',
      },
      error: null,
    });

    renderPage();

    expect(
      await screen.findByText(/saved credentials need attention/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it('saves and refreshes the configuration while clearing write-only fields', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: { configured: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'valid' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          configured: true,
          provider: 'openai',
          model: 'gpt-4.1',
          baseUrl: 'https://example.test/v1',
          status: 'valid',
          lastVerifiedAt: '2026-08-21T12:00:00.000Z',
        },
        error: null,
      });

    const { user } = renderPage();

    await screen.findByText(
      'No AI provider is configured for this account yet.',
    );

    await user.type(screen.getByLabelText(/api key/i), 'sk-test-value');
    await user.clear(screen.getByLabelText(/model/i));
    await user.type(screen.getByLabelText(/model/i), 'gpt-4.1');
    await user.type(
      screen.getByLabelText(/base url/i),
      'https://example.test/v1',
    );

    await user.click(screen.getByRole('button', { name: /save and verify/i }));

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      'ai-configure',
      expect.objectContaining({
        body: {
          action: 'upsert',
          provider: 'openai',
          apiKey: 'sk-test-value',
          model: 'gpt-4.1',
          baseUrl: 'https://example.test/v1',
        },
      }),
    );

    await screen.findByText(/ai settings saved and verified/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toHaveValue('');
      expect(screen.getByLabelText(/base url/i)).toHaveValue(
        'https://example.test/v1',
      );
      expect(screen.getByLabelText(/model/i)).toHaveValue('gpt-4.1');
    });
  });

  it('shows safe provider errors when credential validation fails', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: { configured: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: makeHttpError('The provider rejected the API key.'),
      });

    const { user } = renderPage();

    await screen.findByText(
      'No AI provider is configured for this account yet.',
    );
    await user.type(screen.getByLabelText(/api key/i), 'sk-bad-value');
    await user.click(screen.getByRole('button', { name: /save and verify/i }));

    expect(
      await screen.findByText(/the provider rejected the api key/i),
    ).toBeInTheDocument();
  });

  it('confirms before removing the saved configuration', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: {
          configured: true,
          provider: 'openai',
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1',
          status: 'valid',
          lastVerifiedAt: '2026-08-21T12:00:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: 'unconfigured' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { configured: false },
        error: null,
      });

    const { user } = renderPage();

    await screen.findByText('OpenAI is configured with model gpt-4o-mini.');
    await user.click(
      screen.getByRole('button', { name: /remove configuration/i }),
    );

    expect(
      screen.getByRole('dialog', { name: /remove ai configuration/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      'ai-configure',
      expect.objectContaining({
        body: { action: 'remove' },
      }),
    );
    expect(await screen.findByText(/ai settings removed/i)).toBeInTheDocument();
    expect(
      await screen.findByText(
        /no ai provider is configured for this account yet/i,
      ),
    ).toBeInTheDocument();
  });
});
