import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; error: string | null }
  | { status: 'authenticated'; session: Session };

const AuthContext = createContext<AuthState | null>(null);

/**
 * The server-side gate (Supabase Auth hook, T018) rejects non-owner Google
 * accounts; Supabase then redirects back here with `?error=…` in the URL.
 * We deliberately show one generic message and never surface the server's
 * error code or description.
 */
export const PRIVATE_INSTANCE_MESSAGE = 'This instance is private.';

const SESSION_ERROR_MESSAGE =
  'We could not verify your session. Please try signing in again.';

/** Read and strip OAuth error params from the redirect URL, if present. */
function consumeRedirectError(): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (!search.has('error') && !hash.has('error')) {
    return null;
  }
  window.history.replaceState(null, '', window.location.pathname);
  return PRIVATE_INSTANCE_MESSAGE;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    // The supabase client has already exchanged any OAuth code in the URL
    // (detectSessionInUrl) by the time this resolves.
    const redirectError = consumeRedirectError();
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setState({ status: 'unauthenticated', error: SESSION_ERROR_MESSAGE });
        } else if (data.session) {
          setState({ status: 'authenticated', session: data.session });
        } else {
          setState({ status: 'unauthenticated', error: redirectError });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: 'unauthenticated', error: SESSION_ERROR_MESSAGE });
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session) {
        setState({ status: 'authenticated', session });
      } else if (event === 'SIGNED_OUT') {
        setState({ status: 'unauthenticated', error: null });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
