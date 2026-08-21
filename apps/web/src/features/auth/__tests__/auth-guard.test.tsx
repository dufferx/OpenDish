import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

import { AuthGuard } from '@/features/auth/auth-guard';
import { AuthProvider } from '@/features/auth/auth-context';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

const getSessionMock = vi.mocked(supabase.auth.getSession);

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <p>protected content</p>
              </AuthGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when there is no session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    renderGuard();

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders children when a session exists', async () => {
    const session = { access_token: 'test-token' } as unknown as Session;
    getSessionMock.mockResolvedValue({ data: { session }, error: null });

    renderGuard();

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('shows a loading state while the session is being resolved', () => {
    getSessionMock.mockReturnValue(new Promise(() => {}));

    renderGuard();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
