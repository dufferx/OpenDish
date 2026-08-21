import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  type MemoryRouterProps,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

import { AuthProvider } from '@/features/auth/auth-context';
import { LoginPage } from '@/features/auth/login-page';

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const signUpMock = vi.fn();
const signInWithOAuthMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signInWithPassword: (...args: unknown[]) =>
        signInWithPasswordMock(...args),
      signUp: (...args: unknown[]) => signUpMock(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuthMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

function renderLoginPage(
  initialEntries: MemoryRouterProps['initialEntries'] = ['/login'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/recipes/new" element={<p>recipe editor</p>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/login');
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    onAuthStateChangeMock.mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    signOutMock.mockResolvedValue({ error: null });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: false } }),
      }),
    );
  });

  it('signs in with email and password and keeps Google hidden by default', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { session: { access_token: 'token' } as Session },
      error: null,
    });

    renderLoginPage();
    const user = userEvent.setup();
    const form = await screen.findByRole('form', {
      name: 'Email sign in form',
    });

    await user.type(screen.getByLabelText('Email'), 'cook@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(within(form).getByRole('button', { name: 'Sign in' }));

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'cook@example.com',
      password: 'secret-password',
    });
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();
  });

  it('supports account creation and shows confirmation guidance when email verification is required', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    });

    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('tablist', {
      name: 'Authentication mode',
    });

    await user.click(
      within(tablist).getByRole('button', { name: 'Create account' }),
    );
    const form = await screen.findByRole('form', {
      name: 'Create account form',
    });
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'new-password');
    await user.click(
      within(form).getByRole('button', { name: 'Create account' }),
    );

    expect(signUpMock).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'new-password',
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    expect(
      await screen.findByText(/Check your email for the confirmation link/i),
    ).toBeInTheDocument();
  });

  it('shows Google only when the installation reports it as enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: true } }),
      }),
    );
    signInWithOAuthMock.mockResolvedValue({ error: null });

    renderLoginPage();
    const user = userEvent.setup();

    const googleButton = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    await user.click(googleButton);

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  });

  it('redirects authenticated users to their original destination', async () => {
    const session = { access_token: 'token' } as unknown as Session;
    getSessionMock.mockResolvedValue({ data: { session }, error: null });

    renderLoginPage([
      {
        pathname: '/login',
        state: { from: { pathname: '/recipes/new' } },
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText('recipe editor')).toBeInTheDocument();
    });
  });

  it('recovers from sign-in promise rejection with a generic error and unlocked UI', async () => {
    let rejectSignIn!: (reason?: unknown) => void;
    const signInPromise = new Promise<{
      data: { session: Session | null };
      error: null;
    }>((_, reject) => {
      rejectSignIn = reject;
    });
    signInWithPasswordMock.mockReturnValue(signInPromise);

    renderLoginPage();
    const user = userEvent.setup();
    const form = await screen.findByRole('form', {
      name: 'Email sign in form',
    });

    await user.type(screen.getByLabelText('Email'), 'cook@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(within(form).getByRole('button', { name: 'Sign in' }));

    expect(
      within(form).getByRole('button', { name: 'Signing in…' }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();

    rejectSignIn(new Error('network'));
    expect(
      await screen.findByText('Invalid email or password.'),
    ).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByLabelText('Email')).toBeEnabled();
    expect(screen.getByLabelText('Password')).toBeEnabled();
  });

  it('recovers from sign-up promise rejection with a generic error and unlocked UI', async () => {
    signUpMock.mockRejectedValue(new Error('offline'));

    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('tablist', {
      name: 'Authentication mode',
    });

    await user.click(
      within(tablist).getByRole('button', { name: 'Create account' }),
    );
    const form = await screen.findByRole('form', {
      name: 'Create account form',
    });
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'new-password');
    await user.click(
      within(form).getByRole('button', { name: 'Create account' }),
    );

    expect(
      await screen.findByText(
        'Account creation failed. Check your details and try again.',
      ),
    ).toBeInTheDocument();
    expect(
      within(form).getByRole('button', { name: 'Create account' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Email')).toBeEnabled();
    expect(screen.getByLabelText('Password')).toBeEnabled();
    expect(screen.getByLabelText('Confirm password')).toBeEnabled();
  });

  it('recovers from Google sign-in promise rejection with a generic error and unlocked UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: true } }),
      }),
    );
    signInWithOAuthMock.mockRejectedValue(new Error('network'));

    renderLoginPage();
    const user = userEvent.setup();

    const googleButton = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    await user.click(googleButton);

    expect(
      await screen.findByText(
        'Sign-in could not be started. Please try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeEnabled();
  });

  it('shows disabled loading state while account creation is in flight', async () => {
    let resolveSignUp!: (value: {
      data: { user: { id: string }; session: null };
      error: null;
    }) => void;
    const signUpPromise = new Promise<{
      data: { user: { id: string }; session: null };
      error: null;
    }>((resolve) => {
      resolveSignUp = resolve;
    });
    signUpMock.mockReturnValue(signUpPromise);

    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('tablist', {
      name: 'Authentication mode',
    });

    await user.click(
      within(tablist).getByRole('button', { name: 'Create account' }),
    );
    const form = await screen.findByRole('form', {
      name: 'Create account form',
    });
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'new-password');
    await user.click(
      within(form).getByRole('button', { name: 'Create account' }),
    );

    expect(
      within(form).getByRole('button', { name: 'Creating account…' }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByLabelText('Confirm password')).toBeDisabled();
    expect(
      within(tablist).getByRole('button', { name: 'Sign in' }),
    ).toBeDisabled();

    resolveSignUp({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    });
    expect(
      await screen.findByText(/Check your email for the confirmation link/i),
    ).toBeInTheDocument();
  });
});
