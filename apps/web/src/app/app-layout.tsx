import { Link, NavLink, Outlet } from 'react-router-dom';

import { NAV_ITEMS } from '@/app/nav-items';
import { SignOutButton } from '@/features/auth/sign-out-button';
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

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            OpenDish
          </Link>
          <div className="hidden md:block">
            <PrimaryNav variant="top" />
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <PrimaryNav variant="bottom" />
      </div>
    </div>
  );
}
