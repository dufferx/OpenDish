import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiSettingsPage } from '@/features/ai-config';
import { AuthProvider } from '@/features/auth/auth-context';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
    },
  },
}));

function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AuthProvider>
        <AiSettingsPage />
      </AuthProvider>
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
    mocks.getSession.mockReset().mockResolvedValue({
      data: {
        session: { user: { email: 'cook@example.com' } },
      },
      error: null,
    });
    mocks.onAuthStateChange.mockReset().mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    mocks.signOut.mockReset().mockResolvedValue({ error: null });
  });

  it('exposes account info and a working sign-out action (T102)', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { configured: false },
      error: null,
    });

    const { user } = renderPage();

    expect(await screen.findByText('cook@example.com')).toBeInTheDocument();
    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
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
    expect(
      screen.getByRole('combobox', { name: /model/i }),
    ).toHaveTextContent('GPT-4o mini (default)');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'ai-configure',
      expect.objectContaining({
        body: { action: 'status' },
      }),
    );
  });

  it('lets the user choose a model from an accessible, keyboard-operable list (T101)', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { configured: false },
      error: null,
    });

    const { user } = renderPage();
    await screen.findByText(
      /no ai provider is configured for this account yet/i,
    );

    const trigger = screen.getByRole('combobox', { name: /model/i });
    expect(trigger).toHaveTextContent('GPT-4o mini (default)');

    await user.click(trigger);
    const option = await screen.findByRole('option', { name: 'GPT-4.1 mini' });
    await user.click(option);

    expect(trigger).toHaveTextContent('GPT-4.1 mini');
  });

  it('shows a saved model that has fallen off the supported list as its own selected option (T101)', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        configured: true,
        provider: 'openai',
        model: 'gpt-3.5-legacy',
        baseUrl: 'https://api.openai.com/v1',
        status: 'valid',
        lastVerifiedAt: '2026-08-21T12:00:00.000Z',
      },
      error: null,
    });

    renderPage();

    const trigger = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => {
      expect(trigger).toHaveTextContent('gpt-3.5-legacy (no longer offered)');
    });
    expect(
      screen.getByText(/no longer in the supported list/i),
    ).toBeInTheDocument();
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
      expect(
        screen.getByRole('combobox', { name: /model/i }),
      ).toHaveTextContent('GPT-4.1 mini');
    });
    expect(screen.getByText(/^Verified$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toHaveValue('');
    expect(screen.queryByDisplayValue(/sk-/i)).not.toBeInTheDocument();
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

    // T100: the redundant "open Settings" banner no longer renders on this
    // page; the status is instead shown directly via the saved-configuration
    // badge below.
    expect(await screen.findByText(/needs attention/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/saved credentials need attention/i),
    ).not.toBeInTheDocument();
  });

  it('does not render the redundant AI-unavailable banner on this page (T100)', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: { configured: false },
      error: null,
    });

    renderPage();

    await screen.findByText(
      /no ai provider is configured for this account yet/i,
    );
    expect(screen.queryByText(/configure ai in settings/i)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('combobox', { name: /model/i }));
    await user.click(await screen.findByRole('option', { name: 'GPT-4.1' }));
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
      expect(
        screen.getByRole('combobox', { name: /model/i }),
      ).toHaveTextContent('GPT-4.1');
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
