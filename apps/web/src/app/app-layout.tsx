import { UserIcon } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { NAV_ITEMS } from '@/app/nav-items';
import mascotImage from '@/assets/mascot.jpg';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';

interface PrimaryNavProps {
  /** `top` renders inline links for the desktop header; `bottom` renders the mobile tab bar. */
  variant: 'top' | 'bottom';
}

export function PrimaryNav({ variant }: PrimaryNavProps) {
  return (
    <nav aria-label="Primary">
      <ul
        className={cn(
          variant === 'top' && 'flex items-center gap-1',
          variant === 'bottom' && 'flex items-stretch justify-around',
        )}
      >
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 text-sm font-medium transition-colors',
                  variant === 'top' && 'rounded-lg px-3 py-1.5',
                  variant === 'bottom' && 'flex-col gap-1 px-3 py-2 text-xs',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon
                className={variant === 'bottom' ? 'size-5' : 'size-4'}
                aria-hidden
              />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** T102: a recognizable account entry point in the header that opens
 * Settings. Falls back to a generic user icon until profile settings (and a
 * real avatar photo) exist; the accessible name never depends on the
 * initials/photo alone. */
function UserAvatarLink() {
  const auth = useAuth();
  const email =
    auth.status === 'authenticated' ? (auth.session.user.email ?? null) : null;
  const initial = email ? email.trim().charAt(0).toUpperCase() : null;

  return (
    <Link
      to="/settings"
      aria-label="Open Settings"
      title="Settings"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {initial ? (
        <span aria-hidden="true">{initial}</span>
      ) : (
        <UserIcon className="size-4" aria-hidden="true" />
      )}
    </Link>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <img
              src={mascotImage}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-md bg-muted object-cover"
            />
            <span className="hidden sm:inline">OpenDish</span>
            <span className="sr-only sm:hidden">OpenDish</span>
          </Link>
          <div className="hidden md:block">
            <PrimaryNav variant="top" />
          </div>
          <UserAvatarLink />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 outline-none md:pb-6"
      >
        <Outlet />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <PrimaryNav variant="bottom" />
      </div>
    </div>
  );
}
