import { useEffect, useMemo, useState } from 'react';
import { KeyRoundIcon, RefreshCcwIcon, Trash2Icon } from 'lucide-react';

import { ConfirmDialog } from '@/app/confirm-dialog.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  removeAiConfiguration,
  upsertAiConfiguration,
} from './ai-config-api.ts';
import { AiAvailabilityBanner } from './ai-availability-banner.tsx';
import { useAiConfigurationStatus } from './use-ai-configuration-status.ts';

interface FeedbackState {
  tone: 'status' | 'error';
  message: string;
}

function providerLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI';
  return provider;
}

function statusLabel(status: 'unverified' | 'valid' | 'invalid'): string {
  if (status === 'valid') return 'Verified';
  if (status === 'invalid') return 'Needs attention';
  return 'Unverified';
}

function statusVariant(
  status: 'unverified' | 'valid' | 'invalid',
): 'default' | 'destructive' | 'outline' {
  if (status === 'valid') return 'default';
  if (status === 'invalid') return 'destructive';
  return 'outline';
}

function formatVerifiedAt(value: string | null): string {
  if (!value) return 'Not available';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function isValidOptionalUrl(value: string): boolean {
  if (value.trim() === '') return true;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function AiSettingsPage() {
  const { configuration, isLoading, error, refresh } =
    useAiConfigurationStatus();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [baseUrl, setBaseUrl] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [modelTouched, setModelTouched] = useState(false);
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);

  useEffect(() => {
    if (configuration?.configured) {
      if (!modelTouched) setModel(configuration.model);
      if (!baseUrlTouched) {
        setBaseUrl(configuration.baseUrl ?? DEFAULT_AI_BASE_URL);
      }
      return;
    }

    if (configuration && !configuration.configured) {
      if (!modelTouched) setModel(DEFAULT_AI_MODEL);
      if (!baseUrlTouched) setBaseUrl('');
    }
  }, [baseUrlTouched, configuration, modelTouched]);

  const formError = useMemo(() => {
    if (apiKey.trim() === '' && isSubmitting) {
      return 'API key is required.';
    }

    if (model.trim() === '') {
      return 'Model is required.';
    }

    if (!isValidOptionalUrl(baseUrl)) {
      return 'Base URL must be a valid URL.';
    }

    return null;
  }, [apiKey, baseUrl, isSubmitting, model]);

  const configurationSummary = useMemo(() => {
    if (!configuration) return null;
    if (!configuration.configured) {
      return 'No AI provider is configured for this account.';
    }

    return `${providerLabel(configuration.provider)} is configured with model ${configuration.model}.`;
  }, [configuration]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const trimmedApiKey = apiKey.trim();
    const trimmedModel = model.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (trimmedApiKey === '') {
      setFeedback({ tone: 'error', message: 'API key is required.' });
      return;
    }

    if (trimmedModel === '') {
      setFeedback({ tone: 'error', message: 'Model is required.' });
      return;
    }

    if (!isValidOptionalUrl(trimmedBaseUrl)) {
      setFeedback({ tone: 'error', message: 'Base URL must be a valid URL.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await upsertAiConfiguration({
        provider: DEFAULT_AI_PROVIDER,
        apiKey: trimmedApiKey,
        model: trimmedModel,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
      });
      setApiKey('');
      setModelTouched(false);
      setBaseUrlTouched(false);
      setFeedback({
        tone: 'status',
        message: 'AI settings saved and verified.',
      });
      await refresh();
    } catch (cause) {
      setFeedback({
        tone: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Could not save AI settings. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveConfirmed() {
    setFeedback(null);
    setIsRemoving(true);

    try {
      await removeAiConfiguration();
      setApiKey('');
      setModel(DEFAULT_AI_MODEL);
      setBaseUrl('');
      setModelTouched(false);
      setBaseUrlTouched(false);
      setShowRemoveConfirm(false);
      setFeedback({
        tone: 'status',
        message: 'AI settings removed.',
      });
      await refresh();
    } catch (cause) {
      setFeedback({
        tone: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Could not remove AI settings. Please try again.',
      });
    } finally {
      setIsRemoving(false);
    }
  }

  const canRemove = configuration?.configured === true;
  const isBusy = isSubmitting || isRemoving;

  return (
    <section className="grid gap-6" aria-labelledby="ai-settings-title">
      <header className="grid gap-2">
        <h1
          id="ai-settings-title"
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight"
        >
          <KeyRoundIcon className="size-6" aria-hidden />
          AI Settings
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Bring your own OpenAI API key for recipe generation, recipe import,
          and recipe chat. Your key is write-only and is never rendered back
          after it is saved.
        </p>
      </header>

      <AiAvailabilityBanner
        capability="AI-powered recipe tools"
        configuration={configuration}
        isLoading={isLoading}
        error={error}
      />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1">
              <CardTitle>Saved configuration</CardTitle>
              <p className="text-sm text-muted-foreground">
                {configurationSummary ?? 'Checking saved AI configuration…'}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refresh()}
              disabled={isLoading || isBusy}
            >
              <RefreshCcwIcon className="size-4" aria-hidden />
              Refresh status
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isLoading && !configuration ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking saved AI configuration…
            </p>
          ) : configuration?.configured ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <dt className="text-sm font-medium text-muted-foreground">
                  Provider
                </dt>
                <dd>{providerLabel(configuration.provider)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm font-medium text-muted-foreground">
                  Model
                </dt>
                <dd>{configuration.model}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm font-medium text-muted-foreground">
                  Status
                </dt>
                <dd>
                  <Badge variant={statusVariant(configuration.status)}>
                    {statusLabel(configuration.status)}
                  </Badge>
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm font-medium text-muted-foreground">
                  Last verified
                </dt>
                <dd>{formatVerifiedAt(configuration.lastVerifiedAt)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No AI provider is configured for this account yet.
            </p>
          )}

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <p>{error}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="grid gap-2">
          <CardTitle>Provider setup</CardTitle>
          <p className="text-sm text-muted-foreground">
            Save your OpenAI credentials here. The app validates the key before
            marking the configuration as verified.
          </p>
        </CardHeader>
        <CardContent className="grid gap-6">
          <ol className="grid gap-2 text-sm text-muted-foreground">
            <li>1. Create an OpenAI API key in your provider account.</li>
            <li>2. Paste the key below and choose the model to use.</li>
            <li>
              3. Leave Base URL blank for the default endpoint:{' '}
              {DEFAULT_AI_BASE_URL}
            </li>
          </ol>

          <form
            className="grid gap-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="grid gap-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Input id="ai-provider" value="OpenAI" readOnly disabled />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-api-key">API key</Label>
              <Input
                id="ai-api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                placeholder="sk-..."
                onChange={(event) => setApiKey(event.target.value)}
                disabled={isBusy}
              />
              <p className="text-sm text-muted-foreground">
                Write-only. Re-enter the key whenever you update the
                configuration.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setModelTouched(true);
                }}
                disabled={isBusy}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                inputMode="url"
                value={baseUrl}
                placeholder={DEFAULT_AI_BASE_URL}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setBaseUrlTouched(true);
                }}
                disabled={isBusy}
              />
              <p className="text-sm text-muted-foreground">
                Endpoint used for this provider. Keep the default for OpenAI, or
                enter a compatible OpenAI-style endpoint.
              </p>
            </div>

            {feedback ? (
              <p
                className={
                  feedback.tone === 'error'
                    ? 'text-sm text-destructive'
                    : 'text-sm text-muted-foreground'
                }
                role={feedback.tone === 'error' ? 'alert' : 'status'}
              >
                {feedback.message}
              </p>
            ) : formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isBusy || apiKey.trim() === ''}>
                {isSubmitting ? 'Saving…' : 'Save and verify'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!canRemove || isBusy}
                onClick={() => setShowRemoveConfirm(true)}
              >
                <Trash2Icon className="size-4" aria-hidden />
                Remove configuration
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showRemoveConfirm}
        onOpenChange={setShowRemoveConfirm}
        title="Remove AI configuration?"
        description="This removes the saved provider metadata and vault secret for your account."
        confirmLabel={isRemoving ? 'Removing…' : 'Remove'}
        pending={isRemoving}
        onConfirm={() => void handleRemoveConfirmed()}
      />
    </section>
  );
}
