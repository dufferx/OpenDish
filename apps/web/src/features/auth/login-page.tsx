import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Loading } from '@/app/states';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (auth.status === 'loading') {
    return <Loading fullScreen label="Checking your session…" />;
  }
  if (auth.status === 'authenticated') {
    const from =
      (location.state as { from?: { pathname?: string } } | null)?.from
        ?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const message = localError ?? auth.error;

  async function handleGoogleSignIn() {
    setSubmitting(true);
    setLocalError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      // Never surface provider internals — just a safe, generic message.
      setLocalError('Sign-in could not be started. Please try again.');
      setSubmitting(false);
    }
    // On success the browser leaves for Google; keep the button disabled.
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">OpenDish</CardTitle>
          <CardDescription>
            Your personal recipe manager. Sign in with the owner&apos;s Google
            account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message ? (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}
          <Button
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? 'Redirecting to Google…' : 'Sign in with Google'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
