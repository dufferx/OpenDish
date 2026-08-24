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

  it('uses a softly rounded square treatment for the login mascot', async () => {
    renderLoginPage();

    await screen.findByRole('heading', { name: 'OpenDish' });
    const mascot = document.querySelector('img[src$="mascot.jpg"]');
    expect(mascot).toHaveClass('rounded-xl');
    expect(mascot).not.toHaveClass('rounded-full');
  });

  it('keeps the desktop prompt area free of a duplicate mascot', async () => {
    renderLoginPage();

    await screen.findByRole('heading', { name: 'OpenDish' });
    expect(document.querySelector('.od-hero-mascot')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.od-hero-prompts > *')).toHaveLength(3);
  });

  it('supports account creation and shows confirmation guidance when email verification is required', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    });

    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('group', {
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
    const tablist = await screen.findByRole('group', {
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
    const tablist = await screen.findByRole('group', {
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

  it('shows the Google brand mark on the OAuth action only when it is enabled (T103)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: true } }),
      }),
    );

    renderLoginPage();

    const googleButton = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    expect(googleButton.querySelector('svg')).toBeInTheDocument();
  });

  it('gives the active authentication mode an unmistakable, semantic selected state (T104)', async () => {
    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('group', {
      name: 'Authentication mode',
    });
    const signInButton = within(tablist).getByRole('button', {
      name: 'Sign in',
    });
    const createAccountButton = within(tablist).getByRole('button', {
      name: 'Create account',
    });

    expect(signInButton).toHaveAttribute('aria-pressed', 'true');
    expect(signInButton).toHaveAttribute('data-variant', 'default');
    expect(createAccountButton).toHaveAttribute('aria-pressed', 'false');
    expect(createAccountButton).toHaveAttribute('data-variant', 'ghost');

    await user.click(createAccountButton);

    expect(createAccountButton).toHaveAttribute('aria-pressed', 'true');
    expect(createAccountButton).toHaveAttribute('data-variant', 'default');
    expect(signInButton).toHaveAttribute('aria-pressed', 'false');
    expect(signInButton).toHaveAttribute('data-variant', 'ghost');
  });

  it('lets the user reveal and re-hide the password without clearing or submitting (T105)', async () => {
    renderLoginPage();
    const user = userEvent.setup();
    await screen.findByRole('form', { name: 'Email sign in form' });

    const passwordInput = screen.getByLabelText('Password');
    await user.type(passwordInput, 'secret-password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const showButton = screen.getByRole('button', { name: 'Show password' });
    await user.click(showButton);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(passwordInput).toHaveValue('secret-password');
    expect(signInWithPasswordMock).not.toHaveBeenCalled();

    const hideButton = screen.getByRole('button', { name: 'Hide password' });
    await user.click(hideButton);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('supports independent password visibility toggles in create-account mode (T105)', async () => {
    renderLoginPage();
    const user = userEvent.setup();
    const tablist = await screen.findByRole('group', {
      name: 'Authentication mode',
    });
    await user.click(
      within(tablist).getByRole('button', { name: 'Create account' }),
    );
    await screen.findByRole('form', { name: 'Create account form' });

    const passwordInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(confirmInput).toHaveAttribute('type', 'password');

    await user.click(
      screen.getByRole('button', { name: 'Show confirm password' }),
    );
    expect(confirmInput).toHaveAttribute('type', 'text');
  });
});
