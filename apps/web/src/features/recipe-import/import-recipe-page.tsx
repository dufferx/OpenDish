import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState } from '@/app/states';
import {
  AiAvailabilityBanner,
  type AiConfiguration,
  useAiConfigurationStatus,
} from '@/features/ai-config';

import {
  importRecipe,
  ImportRecipeError,
  type ImportErrorCode,
  type ImportResult,
} from './import-recipe-api.ts';
import { ReviewScreen } from './review-screen.tsx';

type Tab = 'url' | 'text';

const ERROR_TITLES: Record<ImportErrorCode, string> = {
  no_recipe_found: 'No recipe found',
  unsupported_url: 'Unsupported URL',
  fetch_failed: 'Could not fetch the page',
  ai_not_configured: 'AI is not configured',
  invalid_ai_output: 'Extracted recipe was invalid',
  provider_error: 'AI provider error',
};

function hasValidAiConfiguration(
  configuration: AiConfiguration | null | undefined,
): boolean {
  return (
    typeof configuration === 'object' &&
    configuration !== null &&
    'configured' in configuration &&
    configuration.configured === true &&
    'status' in configuration &&
    configuration.status === 'valid'
  );
}

function shouldOfferSettings(
  error: {
    code: ImportErrorCode;
    message: string;
  } | null,
): boolean {
  return Boolean(
    error &&
    (error.code === 'ai_not_configured' ||
      error.code === 'provider_error' ||
      /rejected the api key|provider credentials|provider settings/i.test(
        error.message,
      )),
  );
}

export function ImportRecipePage() {
  const navigate = useNavigate();
  const {
    configuration,
    isLoading: isAiConfigurationLoading,
    error: aiConfigurationError,
  } = useAiConfigurationStatus();
  const [activeTab, setActiveTab] = useState<Tab>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{
    code: ImportErrorCode;
    message: string;
  } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const canUseAi =
    !aiConfigurationError && hasValidAiConfiguration(configuration);
  const showAiAvailabilityBanner =
    isAiConfigurationLoading || aiConfigurationError || !canUseAi;
  const textImportDisabled = isLoading || isAiConfigurationLoading || !canUseAi;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (activeTab === 'text' && textImportDisabled) return;
    setError(null);
    setResult(null);
    setIsLoading(true);

    try {
      const payload =
        activeTab === 'url'
          ? { mode: 'url' as const, url: url.trim() }
          : { mode: 'text' as const, text: text.trim() };
      const data = await importRecipe(payload);
      setResult(data);
    } catch (cause) {
      if (cause instanceof ImportRecipeError) {
        setError({ code: cause.code, message: cause.message });
      } else if (cause instanceof Error) {
        setError({ code: 'fetch_failed', message: cause.message });
      } else {
        setError({
          code: 'fetch_failed',
          message: 'Import failed. Please try again.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleDiscard() {
    setResult(null);
    setError(null);
    setUrl('');
    setText('');
  }

  if (result) {
    return (
      <ReviewScreen
        draft={result.draft}
        origin="imported"
        extractionMethod={result.extractionMethod}
        onDiscard={handleDiscard}
        onSaved={(recipeId) => navigate(`/recipes/${recipeId}`)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="import-title">
      <h1 id="import-title" className="text-2xl font-semibold tracking-tight">
        Import a recipe
      </h1>

      {showAiAvailabilityBanner ? (
        <AiAvailabilityBanner
          capability="importing recipes"
          configuration={configuration}
          isLoading={isAiConfigurationLoading}
          error={aiConfigurationError}
        />
      ) : null}

      <div className="flex gap-2">
        <TabButton
          active={activeTab === 'url'}
          onClick={() => setActiveTab('url')}
          label="From URL"
        />
        <TabButton
          active={activeTab === 'text'}
          onClick={() => setActiveTab('text')}
          label="Paste text"
        />
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        {activeTab === 'url' ? (
          <div className="grid gap-2">
            <Label htmlFor="recipe-url">Recipe URL</Label>
            <Input
              id="recipe-url"
              type="url"
              placeholder="https://example.com/recipe"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Supports recipe pages with structured markup. Pages without it
              require AI to be configured in settings. Instagram, TikTok,
              Facebook, and YouTube Shorts links aren't supported — copy the
              caption and use "Paste text" instead.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="recipe-text">Recipe text</Label>
            <Textarea
              id="recipe-text"
              placeholder="Paste the full recipe here..."
              value={text}
              onChange={(event) => setText(event.target.value)}
              required
              disabled={textImportDisabled}
              rows={10}
            />
            <p className="text-xs text-muted-foreground">
              Pasted text import requires AI to be configured in settings.
            </p>
          </div>
        )}

        <Button
          type="submit"
          disabled={
            activeTab === 'url'
              ? isLoading || !url.trim()
              : textImportDisabled || !text.trim()
          }
        >
          {isLoading ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden />
          ) : null}
          {isLoading ? 'Extracting…' : 'Extract recipe'}
        </Button>
      </form>

      {error ? (
        <ErrorState
          title={ERROR_TITLES[error.code]}
          description={error.message}
          onRetry={() => setError(null)}
          retryLabel="Try again"
        />
      ) : null}

      {shouldOfferSettings(error) ? (
        <div className="flex justify-center">
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">Open Settings</Link>
          </Button>
        </div>
      ) : null}

      {error || showAiAvailabilityBanner ? (
        <p className="text-center text-sm text-muted-foreground">
          Or{' '}
          <Link
            to="/recipes/new"
            className="text-foreground underline-offset-4 hover:underline"
          >
            create the recipe manually instead
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function TabButton({ active, onClick, label }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
