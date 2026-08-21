import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { PrimaryNav } from '@/app/app-layout';
import { NAV_ITEMS } from '@/app/nav-items';

// app-layout imports SignOutButton, which imports the supabase client module;
// mock it so the env guard in lib/supabase does not fire under test.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
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
