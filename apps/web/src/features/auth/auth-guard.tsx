import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Loading } from '@/app/states';
import { useAuth } from '@/features/auth/auth-context';

/**
 * Gate for every authenticated route (FR-000): while the session is being
 * resolved show a loading state; without a session redirect to /login,
 * remembering where the user was headed.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return <Loading fullScreen label="Checking your session…" />;
  }
  if (auth.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
