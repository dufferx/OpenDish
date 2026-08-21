import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AiAvailabilityBanner } from '@/features/ai-config';

function renderBanner(
  overrides: Partial<Parameters<typeof AiAvailabilityBanner>[0]> = {},
) {
  render(
    <MemoryRouter>
      <AiAvailabilityBanner
        capability="recipe generation"
        configuration={{ configured: false }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('AiAvailabilityBanner', () => {
  it('renders a loading status while configuration is being checked', () => {
    renderBanner({ configuration: null, isLoading: true });

    expect(screen.getByRole('status')).toHaveTextContent(
      /checking ai configuration for recipe generation/i,
    );
  });

  it('renders a setup alert when AI is not configured', () => {
    renderBanner();

    expect(screen.getByRole('alert')).toHaveTextContent(
      /configure ai in settings to use recipe generation/i,
    );
    expect(
      screen.getByRole('link', { name: /open settings/i }),
    ).toHaveAttribute('href', '/settings');
  });

  it('renders a remediation alert for invalid or unverified credentials', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AiAvailabilityBanner
          capability="recipe chat"
          configuration={{
            configured: true,
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            status: 'invalid',
            lastVerifiedAt: '2026-08-21T12:00:00.000Z',
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /openai is configured for recipe chat, but the saved credentials need attention/i,
    );

    rerender(
      <MemoryRouter>
        <AiAvailabilityBanner
          capability="recipe chat"
          configuration={{
            configured: true,
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            status: 'unverified',
            lastVerifiedAt: null,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /connection still needs verification/i,
    );
  });

  it('renders a query error alert and hides itself when the configuration is valid', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AiAvailabilityBanner
          capability="recipe import"
          configuration={null}
          error="Could not reach the AI settings service."
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not verify ai configuration for recipe import/i,
    );

    rerender(
      <MemoryRouter>
        <AiAvailabilityBanner
          capability="recipe import"
          configuration={{
            configured: true,
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: 'https://api.openai.com/v1',
            status: 'valid',
            lastVerifiedAt: '2026-08-21T12:00:00.000Z',
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
