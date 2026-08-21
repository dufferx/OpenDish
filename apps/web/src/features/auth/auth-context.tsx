import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type AuthStatus =
  | { status: 'loading' }
  | { status: 'unauthenticated'; error: string | null }
  | { status: 'authenticated'; session: Session };

export type AuthState = AuthStatus & {
  signOut: () => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthState | null>(null);

export const REDIRECT_AUTH_ERROR_MESSAGE =
  'Sign-in could not be completed. Please try again.';
export const SESSION_ERROR_MESSAGE =
  'We could not verify your session. Please try signing in again.';
export const SESSION_EXPIRED_MESSAGE =
  'Your session expired. Please sign in again.';

function consumeRedirectError(): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (!search.has('error') && !hash.has('error')) {
    return null;
  }
  window.history.replaceState(null, '', window.location.pathname);
  return REDIRECT_AUTH_ERROR_MESSAGE;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ status: 'loading' });
  const manualSignOutRef = useRef(false);
  const authStatusRef = useRef<AuthStatus>({ status: 'loading' });

  useEffect(() => {
    authStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    const redirectError = consumeRedirectError();
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setStatus({
            status: 'unauthenticated',
            error: SESSION_ERROR_MESSAGE,
          });
        } else if (data.session) {
          setStatus({ status: 'authenticated', session: data.session });
        } else {
          setStatus({ status: 'unauthenticated', error: redirectError });
        }
      })
      .catch(() => {
        if (active) {
          setStatus({
            status: 'unauthenticated',
            error: SESSION_ERROR_MESSAGE,
          });
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session) {
        manualSignOutRef.current = false;
        setStatus({ status: 'authenticated', session });
        return;
      }

      if (event === 'SIGNED_OUT') {
        const previousStatus = authStatusRef.current.status;
        const error =
          manualSignOutRef.current || previousStatus !== 'authenticated'
            ? null
            : SESSION_EXPIRED_MESSAGE;
        manualSignOutRef.current = false;
        setStatus({ status: 'unauthenticated', error });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ...status,
      signOut: async () => {
        manualSignOutRef.current = true;
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) {
          manualSignOutRef.current = false;
          return { error: 'Sign-out failed. Please try again.' };
        }
        return { error: null };
      },
    }),
    [status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
