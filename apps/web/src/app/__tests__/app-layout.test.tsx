import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout, PrimaryNav } from '@/app/app-layout';
import { NAV_ITEMS } from '@/app/nav-items';
import { AuthProvider } from '@/features/auth/auth-context';

// app-layout imports auth-context, which imports the supabase client module;
// mock it so the env guard in lib/supabase does not fire under test.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn(),
    },
  },
}));

describe('PrimaryNav', () => {
  it('renders all five primary destinations (FR-034)', () => {
    render(
      <MemoryRouter>
        <PrimaryNav variant="top" />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    for (const item of NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.to);
    }
  });

  it('marks the current destination as active', () => {
    render(
      <MemoryRouter initialEntries={['/shopping-list']}>
        <PrimaryNav variant="bottom" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Shopping' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

function renderAppLayout(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<p>home</p>} />
            <Route path="settings" element={<p>settings page</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AppLayout header (T102, T110)', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({
      data: { session: { user: { email: 'cook@example.com' } } },
      error: null,
    });
    mocks.onAuthStateChange.mockReset().mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
  });

  it('replaces the header sign-out control with an avatar link to Settings', async () => {
    renderAppLayout();

    const avatarLink = await screen.findByRole('link', {
      name: /open settings/i,
    });
    expect(avatarLink).toHaveAttribute('href', '/settings');
    expect(
      screen.queryByRole('button', { name: /sign out/i }),
    ).not.toBeInTheDocument();
  });

  it('shows an initials fallback derived from the account email', async () => {
    renderAppLayout();

    const avatarLink = await screen.findByRole('link', {
      name: /open settings/i,
    });
    expect(avatarLink).toHaveTextContent('C');
  });

  it('keeps the brand mark linking home with an accessible name', async () => {
    renderAppLayout();

    const brandLink = await screen.findByRole('link', { name: /opendish/i });
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('uses a softly rounded square treatment for the header mascot', async () => {
    renderAppLayout();

    await screen.findByRole('link', { name: /opendish/i });
    const mascot = document.querySelector('img[src$="mascot.jpg"]');
    expect(mascot).toHaveClass('rounded-md');
    expect(mascot).not.toHaveClass('rounded-full');
  });
});
