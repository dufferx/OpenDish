import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Session } from '@supabase/supabase-js';

import {
  AuthProvider,
  SESSION_EXPIRED_MESSAGE,
  useAuth,
} from '@/features/auth/auth-context';

const signOutMock = vi.fn();
const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

function AuthProbe() {
  const auth = useAuth();

  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="error">
        {auth.status === 'unauthenticated' ? (auth.error ?? '') : ''}
      </p>
      <button type="button" onClick={() => auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    signOutMock.mockResolvedValue({ error: null });
  });

  it('shows a session-expired message when an authenticated session is lost', async () => {
    let listener: ((event: string, session: Session | null) => void) | null =
      null;
    const session = { access_token: 'token' } as unknown as Session;
    getSessionMock.mockResolvedValue({ data: { session }, error: null });
    onAuthStateChangeMock.mockImplementation((callback) => {
      listener = callback;
      return {
        data: { subscription: { unsubscribe: vi.fn() } },
      };
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(await screen.findByText('authenticated')).toBeInTheDocument();

    await act(async () => {
      listener?.('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('error')).toHaveTextContent(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it('does not surface session expiry after a manual sign-out', async () => {
    let listener: ((event: string, session: Session | null) => void) | null =
      null;
    const session = { access_token: 'token' } as unknown as Session;
    getSessionMock.mockResolvedValue({ data: { session }, error: null });
    onAuthStateChangeMock.mockImplementation((callback) => {
      listener = callback;
      return {
        data: { subscription: { unsubscribe: vi.fn() } },
      };
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(await screen.findByText('authenticated')).toBeInTheDocument();

    await act(async () => {
      await screen.getByRole('button', { name: 'Sign out' }).click();
      listener?.('SIGNED_OUT', null);
    });

    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });
});
