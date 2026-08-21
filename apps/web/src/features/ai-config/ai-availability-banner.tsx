import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import type { AiConfiguration } from './ai-config-api.ts';

interface AiAvailabilityBannerProps {
  capability: string;
  configuration: AiConfiguration | null;
  isLoading?: boolean;
  error?: string | null;
}

function providerLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI';
  return provider;
}

export function AiAvailabilityBanner({
  capability,
  configuration,
  isLoading = false,
  error = null,
}: AiAvailabilityBannerProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        Checking AI configuration for {capability}…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
      >
        <p>
          Could not verify AI configuration for {capability}. {error}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/settings">Open Settings</Link>
        </Button>
      </div>
    );
  }

  if (!configuration) {
    return null;
  }

  if (!configuration.configured) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      >
        <p>Configure AI in Settings to use {capability}.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/settings">Open Settings</Link>
        </Button>
      </div>
    );
  }

  if (configuration.status === 'valid') {
    return null;
  }

  const provider = providerLabel(configuration.provider);
  const message =
    configuration.status === 'invalid'
      ? `${provider} is configured for ${capability}, but the saved credentials need attention.`
      : `${provider} is configured for ${capability}, but the connection still needs verification.`;

  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p>{message}</p>
      <p className="mt-1 text-muted-foreground">
        Update the API key in Settings and save again.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-3">
        <Link to="/settings">Open Settings</Link>
      </Button>
    </div>
  );
}
