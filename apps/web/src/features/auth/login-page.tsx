import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Loading } from '@/app/states';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';

type AuthMode = 'sign-in' | 'sign-up';
type Feedback =
  { tone: 'error'; text: string } | { tone: 'success'; text: string };

const SIGN_IN_ERROR_MESSAGE = 'Invalid email or password.';
const SIGN_UP_ERROR_MESSAGE =
  'Account creation failed. Check your details and try again.';
const GOOGLE_ERROR_MESSAGE = 'Sign-in could not be started. Please try again.';
const SIGN_UP_CONFIRMATION_MESSAGE =
  'Account created. Check your email for the confirmation link before signing in.';

function getSettingsUrl() {
  return new URL('/auth/v1/settings', import.meta.env.VITE_SUPABASE_URL);
}

async function isGoogleProviderEnabled(signal: AbortSignal) {
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const response = await fetch(getSettingsUrl(), {
    signal,
    headers: new Headers({ apikey: publishableKey }),
  });
  if (!response.ok) {
    throw new Error('settings fetch failed');
  }

  const data = (await response.json()) as {
    external?: Record<string, boolean | undefined>;
  };
  return data.external?.google === true;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState<
    null | 'sign-in' | 'sign-up' | 'google'
  >(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    isGoogleProviderEnabled(controller.signal)
      .then((enabled) => {
        setGoogleEnabled(enabled);
      })
      .catch(() => {
        setGoogleEnabled(false);
      });

    return () => controller.abort();
  }, []);

  if (auth.status === 'loading') {
    return <Loading fullScreen label="Checking your session…" />;
  }
  if (auth.status === 'authenticated') {
    const from =
      (location.state as { from?: { pathname?: string } } | null)?.from
        ?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const message =
    feedback ?? (auth.error ? { tone: 'error', text: auth.error } : null);
  const pending = submitting !== null;

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFeedback({
        tone: 'error',
        text: 'Enter your email and password.',
      });
      return;
    }

    if (mode === 'sign-up' && password !== confirmPassword) {
      setFeedback({
        tone: 'error',
        text: 'Passwords do not match.',
      });
      return;
    }

    setSubmitting(mode);

    try {
      if (mode === 'sign-in') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error || !data.session) {
          setFeedback({ tone: 'error', text: SIGN_IN_ERROR_MESSAGE });
          setSubmitting(null);
          return;
        }
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error || !data.user) {
        setFeedback({ tone: 'error', text: SIGN_UP_ERROR_MESSAGE });
        setSubmitting(null);
        return;
      }

      setConfirmPassword('');
      if (!data.session) {
        setFeedback({ tone: 'success', text: SIGN_UP_CONFIRMATION_MESSAGE });
        setSubmitting(null);
      }
    } catch {
      setFeedback({
        tone: 'error',
        text:
          mode === 'sign-in' ? SIGN_IN_ERROR_MESSAGE : SIGN_UP_ERROR_MESSAGE,
      });
      setSubmitting(null);
    }
  }

  async function handleGoogleSignIn() {
    setSubmitting('google');
    setFeedback(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setFeedback({ tone: 'error', text: GOOGLE_ERROR_MESSAGE });
        setSubmitting(null);
      }
    } catch {
      setFeedback({ tone: 'error', text: GOOGLE_ERROR_MESSAGE });
      setSubmitting(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl leading-snug font-medium">OpenDish</h1>
          <CardDescription>
            Sign in with email and password, or create an account for this
            installation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div
            className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="Authentication mode"
          >
            <Button
              type="button"
              variant={mode === 'sign-in' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'sign-in'}
              onClick={() => {
                setMode('sign-in');
                setFeedback(null);
              }}
              disabled={pending}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === 'sign-up' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'sign-up'}
              onClick={() => {
                setMode('sign-up');
                setFeedback(null);
              }}
              disabled={pending}
            >
              Create account
            </Button>
          </div>

          {message ? (
            <p
              role={message.tone === 'error' ? 'alert' : 'status'}
              className={
                message.tone === 'error'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-emerald-700'
              }
            >
              {message.text}
            </p>
          ) : null}

          <form
            className="space-y-4"
            onSubmit={handleEmailSubmit}
            aria-label={
              mode === 'sign-in' ? 'Email sign in form' : 'Create account form'
            }
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === 'sign-in' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
            </div>

            {mode === 'sign-up' ? (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={pending}
                />
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {submitting === 'sign-in'
                ? 'Signing in…'
                : submitting === 'sign-up'
                  ? 'Creating account…'
                  : mode === 'sign-in'
                    ? 'Sign in'
                    : 'Create account'}
            </Button>
          </form>

          {googleEnabled ? (
            <div className="space-y-3 border-t pt-5">
              <p className="text-xs text-muted-foreground">
                Google sign-in is available on this installation.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={pending}
                className="w-full"
              >
                {submitting === 'google'
                  ? 'Redirecting to Google…'
                  : 'Continue with Google'}
              </Button>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          {mode === 'sign-in'
            ? 'Use the account you already created for this installation.'
            : 'Email confirmation may be required before your first sign-in.'}
        </CardFooter>
      </Card>
    </main>
  );
}
