import { useEffect, useState } from 'react';
import {
  ArrowRightIcon,
  Clock3Icon,
  EyeIcon,
  EyeOffIcon,
  LeafIcon,
  MessageCircleIcon,
  SparklesIcon,
} from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

import { Loading } from '@/app/states';
import mascotImage from '@/assets/mascot.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';

/** T103: the recognizable, multi-color Google "G" mark. Purely decorative —
 * the button's accessible name always comes from its text. */
function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

type AuthMode = 'sign-in' | 'sign-up';
type Feedback =
  { tone: 'error'; text: string } | { tone: 'success'; text: string };

const SIGN_IN_ERROR_MESSAGE = 'Invalid email or password.';
const SIGN_UP_ERROR_MESSAGE =
  'Account creation failed. Check your details and try again.';
const GOOGLE_ERROR_MESSAGE = 'Sign-in could not be started. Please try again.';
const SIGN_UP_CONFIRMATION_MESSAGE =
  'Account created. Check your email for the confirmation link before signing in.';

const RECIPE_PROMPTS = [
  'Make it vegetarian',
  'I only have two eggs. What can I make?',
  'Suggest a light side dish',
  'Add more protein without changing the flavor',
];

function AnimatedPrompt() {
  const [prompt, setPrompt] = useState(RECIPE_PROMPTS[0]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrompt(RECIPE_PROMPTS[0]);
      return;
    }

    let promptIndex = 0;
    let characterIndex = RECIPE_PROMPTS[0].length;
    let deleting = true;
    let timeoutId = 0;

    const type = () => {
      const currentPrompt = RECIPE_PROMPTS[promptIndex];
      setPrompt(currentPrompt.slice(0, characterIndex));

      let delay = deleting ? 24 : 42;
      if (!deleting && characterIndex >= currentPrompt.length) {
        deleting = true;
        delay = 1800;
      } else if (deleting && characterIndex <= 1) {
        deleting = false;
        promptIndex = (promptIndex + 1) % RECIPE_PROMPTS.length;
        characterIndex = 1;
        delay = 420;
      } else {
        characterIndex += deleting ? -1 : 1;
      }

      timeoutId = window.setTimeout(type, delay);
    };

    timeoutId = window.setTimeout(type, 1800);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div className="od-prompt" aria-hidden="true">
      <div className="flex items-center gap-2 text-[0.68rem] font-semibold tracking-[0.14em] text-black uppercase">
        <SparklesIcon className="size-3.5" />
        Recipe AI
      </div>
      <p className="mt-2 min-h-11 text-sm leading-5 font-medium text-[#171717] sm:text-[0.95rem]">
        {prompt}
        <span className="od-prompt-cursor" />
      </p>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src={mascotImage}
        alt=""
        width={compact ? 52 : 60}
        height={compact ? 52 : 60}
        className={
          compact
            ? 'size-13 rounded-xl object-cover shadow-sm ring-1 ring-black/10'
            : 'size-15 rounded-xl object-cover ring-1 ring-white/20'
        }
      />
      <div>
        <p
          className={
            compact
              ? 'text-xl font-semibold tracking-[-0.03em] text-[#171717]'
              : 'text-xl font-semibold tracking-[-0.03em] text-white'
          }
        >
          OpenDish
        </p>
        {!compact ? (
          <p className="mt-0.5 text-[0.7rem] tracking-[0.16em] text-white/50 uppercase">
            Your recipes, made yours
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LoginHero() {
  return (
    <section className="relative hidden min-h-svh overflow-hidden bg-[#171717] lg:flex lg:flex-col lg:justify-between lg:p-[clamp(2rem,4vw,4.5rem)]">
      <div className="od-hero-glow" />
      <BrandMark />

      <div className="relative z-10 mx-auto w-full max-w-[38rem] py-12">
        <p className="mb-5 flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-white/55 uppercase">
          <span className="size-1.5 rounded-full bg-white/70" />
          An intelligent kitchen, not just a recipe box
        </p>
        <h2 className="max-w-[11ch] text-[clamp(3.3rem,5vw,6rem)] leading-[0.93] font-semibold tracking-[-0.065em] text-white">
          Cook with what you have.
        </h2>
        <p className="mt-7 max-w-[35rem] text-[clamp(1rem,1.35vw,1.2rem)] leading-7 text-white/65">
          Save the recipes you love, adapt them through conversation, and keep
          every change under your control.
        </p>

        <div className="od-hero-prompts mt-10 max-w-[36rem]">
          <div className="od-float-card">
            <div className="flex items-center gap-2 text-xs text-[#666]">
              <LeafIcon className="size-4 text-black" />
              Make it mine
            </div>
            <p className="mt-3 text-base font-medium text-[#171717]">
              Creamy tomato pasta
            </p>
            <p className="mt-1 text-xs text-[#737373]">
              Vegetarian · 4 servings
            </p>
          </div>

          <div className="od-float-card">
            <div className="flex items-center gap-2 text-xs text-[#666]">
              <Clock3Icon className="size-4 text-black" />
              Ready in 25 min
            </div>
            <div className="mt-4 flex gap-1.5">
              <span className="h-1.5 w-20 rounded-full bg-black" />
              <span className="h-1.5 w-8 rounded-full bg-[#d4d4d4]" />
              <span className="h-1.5 w-12 rounded-full bg-[#d4d4d4]" />
            </div>
          </div>

          <AnimatedPrompt />
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-2 text-xs text-white/45">
        <MessageCircleIcon className="size-3.5" />
        Ask. Adjust. Review. Save.
      </div>
    </section>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    // Only resume a remembered deep link for an existing account signing
    // back in. A freshly created account must always land on '/': the
    // router's `location.state.from` is scoped to the /login history entry,
    // not to a particular identity, so it can otherwise still be set from a
    // previous, different, now-signed-out session and would leak that
    // account's route into a brand-new one created in the same tab.
    const from =
      mode === 'sign-in'
        ? ((location.state as { from?: { pathname?: string } } | null)?.from
            ?.pathname ?? '/')
        : '/';
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
    <main className="grid min-h-svh bg-white lg:grid-cols-[minmax(0,1.12fr)_minmax(30rem,0.88fr)]">
      <h1 className="sr-only">OpenDish</h1>
      <LoginHero />

      <section className="relative flex min-h-svh items-center justify-center overflow-hidden px-5 py-6 sm:px-10 lg:px-[clamp(3rem,5vw,6rem)] lg:py-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_50%_0%,rgba(0,0,0,0.07),transparent_68%)] lg:hidden" />

        <div className="relative z-10 w-full max-w-[25rem]">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <BrandMark compact />
            <span className="rounded-full border border-[#e5e5e5] bg-white/70 px-3 py-1.5 text-[0.68rem] font-semibold tracking-[0.12em] text-[#737373] uppercase backdrop-blur">
              FREE-BYOK
            </span>
          </div>

          <div className="od-mobile-prompt mb-8 lg:hidden">
            <AnimatedPrompt />
          </div>

          <header className="mb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.13em] text-black uppercase">
              Welcome to OpenDish
            </p>
            <h2 className="text-[clamp(2rem,7vw,2.65rem)] leading-[1.03] font-semibold tracking-[-0.055em] text-[#171717]">
              {mode === 'sign-in'
                ? 'Good to have you back.'
                : 'Make it your kitchen.'}
            </h2>
            <p className="mt-3 max-w-[36ch] text-sm leading-6 text-[#737373]">
              {mode === 'sign-in'
                ? 'Sign in to continue cooking, adapting, and organizing your recipes.'
                : 'Create an account for this OpenDish installation.'}
            </p>
          </header>

          <div className="space-y-5">
            <div
              className="grid grid-cols-2 gap-1 rounded-xl bg-[#f0f0f0] p-1"
              role="group"
              aria-label="Authentication mode"
            >
              <Button
                type="button"
                variant={mode === 'sign-in' ? 'default' : 'ghost'}
                aria-pressed={mode === 'sign-in'}
                className="h-10 rounded-lg data-[variant=default]:bg-black data-[variant=default]:text-white data-[variant=default]:shadow-sm"
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
                variant={mode === 'sign-up' ? 'default' : 'ghost'}
                aria-pressed={mode === 'sign-up'}
                className="h-10 rounded-lg data-[variant=default]:bg-black data-[variant=default]:text-white data-[variant=default]:shadow-sm"
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
                    ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700'
                    : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700'
                }
              >
                {message.text}
              </p>
            ) : null}

            <form
              className="space-y-4.5"
              onSubmit={handleEmailSubmit}
              aria-label={
                mode === 'sign-in'
                  ? 'Email sign in form'
                  : 'Create account form'
              }
            >
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-[0.82rem] text-[#404040]"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={pending}
                  className="h-11 rounded-xl border-[#d4d4d4] bg-white px-3.5 shadow-[0_1px_0_rgba(0,0,0,0.02)] focus-visible:border-black focus-visible:ring-black/10"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-[0.82rem] text-[#404040]"
                >
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={pending}
                    placeholder="••••••••"
                    className="h-11 rounded-xl border-[#d4d4d4] bg-white px-3.5 pr-11 shadow-[0_1px_0_rgba(0,0,0,0.02)] focus-visible:border-black focus-visible:ring-black/10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-9 -translate-y-1/2 rounded-lg text-[#737373] hover:bg-[#f0f0f0]"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? (
                      <EyeOffIcon className="size-4" aria-hidden="true" />
                    ) : (
                      <EyeIcon className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              {mode === 'sign-up' ? (
                <div className="space-y-2">
                  <Label
                    htmlFor="confirm-password"
                    className="text-[0.82rem] text-[#404040]"
                  >
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      disabled={pending}
                      placeholder="••••••••"
                      className="h-11 rounded-xl border-[#d4d4d4] bg-white px-3.5 pr-11 shadow-[0_1px_0_rgba(0,0,0,0.02)] focus-visible:border-black focus-visible:ring-black/10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1/2 right-1 size-9 -translate-y-1/2 rounded-lg text-[#737373] hover:bg-[#f0f0f0]"
                      aria-label={
                        showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                      }
                      onClick={() =>
                        setShowConfirmPassword((visible) => !visible)
                      }
                    >
                      {showConfirmPassword ? (
                        <EyeOffIcon className="size-4" aria-hidden="true" />
                      ) : (
                        <EyeIcon className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Button
                type="submit"
                className="mt-2 h-11 w-full rounded-xl bg-black text-white shadow-[0_8px_20px_rgba(0,0,0,0.14)] hover:bg-[#262626]"
                disabled={pending}
              >
                <span>
                  {submitting === 'sign-in'
                    ? 'Signing in…'
                    : submitting === 'sign-up'
                      ? 'Creating account…'
                      : mode === 'sign-in'
                        ? 'Sign in'
                        : 'Create account'}
                </span>
                {!pending ? <ArrowRightIcon className="ml-1 size-4" /> : null}
              </Button>
            </form>

            {googleEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-[0.7rem] text-[#a3a3a3] uppercase before:h-px before:flex-1 before:bg-[#e5e5e5] after:h-px after:flex-1 after:bg-[#e5e5e5]">
                  or
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleSignIn}
                  disabled={pending}
                  className="h-11 w-full rounded-xl border-[#d4d4d4] bg-white hover:bg-[#f5f5f5]"
                >
                  <GoogleIcon className="size-4 shrink-0" />
                  {submitting === 'google'
                    ? 'Redirecting to Google…'
                    : 'Continue with Google'}
                </Button>
              </div>
            ) : null}
          </div>

          <p className="mt-7 text-center text-xs leading-5 text-[#8a8a8a]">
            {mode === 'sign-in'
              ? 'Use the account you already created for this installation.'
              : 'Email confirmation may be required before your first sign-in.'}
          </p>
        </div>
      </section>
    </main>
  );
}
