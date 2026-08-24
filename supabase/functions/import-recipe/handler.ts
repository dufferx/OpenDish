// Pure, testable handler for the import-recipe Edge Function (T041).
// Deterministic JSON-LD extraction is tried first for URLs; only when no
// usable markup is found does the function fall back to the AI provider.
// All side effects (auth, fetch, AI, config lookup) are injected.
import { z } from 'zod';
import {
  recipeDraftSchema,
  type AiCredentials,
  type AiError,
  type AiProvider,
  type RecipeDraft,
} from '../../../packages/contracts/src/index.ts';
import {
  errorResponse,
  handleRequest,
  jsonResponse,
  type AuthVerifier,
} from '../_shared/http.ts';
import { extractRecipeDraftFromHtml } from '../_shared/jsonld-recipe.ts';
import { safeFetchHtml, type SafeFetchErrorCode } from '../_shared/safe-fetch.ts';

const urlSchema = z.object({
  mode: z.literal('url'),
  url: z.string().url(),
});

const textSchema = z.object({
  mode: z.literal('text'),
  text: z.string().min(1).max(50_000),
});

const bodySchema = z.union([urlSchema, textSchema]);

export interface AiConfigReader {
  /**
   * Loads the user's AI credentials if configured. The API key itself is never
   * surfaced to the handler's caller; only the provider interface sees it.
   */
  getConfig(
    userId: string,
  ): Promise<
    | { configured: true; credentials: AiCredentials }
    | { configured: false }
  >;
}

export interface SafeFetchResult {
  ok: true;
  html: string;
  finalUrl: string;
}

export interface SafeFetchFailure {
  ok: false;
  errorCode: ImportErrorCode;
  message: string;
}

export type ImportErrorCode =
  | 'no_recipe_found'
  | 'unsupported_url'
  | 'fetch_failed'
  | 'ai_not_configured'
  | 'invalid_ai_output'
  | 'provider_error';

export interface ImportRecipeOptions {
  verifyAuth: AuthVerifier;
  provider: AiProvider;
  /** Fetches and SSRF-screens a public https URL, returning HTML or a safe error. */
  safeFetch: (url: string) => Promise<SafeFetchResult | SafeFetchFailure>;
  aiConfigReader: AiConfigReader;
}

const SAFE_FETCH_CODE_MAP: Record<SafeFetchErrorCode, ImportErrorCode> = {
  invalid_url: 'unsupported_url',
  unsupported_scheme: 'unsupported_url',
  blocked_address: 'unsupported_url',
  fetch_failed: 'fetch_failed',
  timeout: 'fetch_failed',
  too_large: 'fetch_failed',
  redirect_limit: 'fetch_failed',
  unsupported_content_type: 'fetch_failed',
};

const SAFE_FETCH_MESSAGES: Record<SafeFetchErrorCode, string> = {
  invalid_url: 'The URL is not valid.',
  unsupported_scheme: 'Only https:// URLs can be imported.',
  blocked_address: 'The URL points to a non-public network address.',
  fetch_failed: 'The page could not be fetched.',
  timeout: 'The page took too long to respond.',
  too_large: 'The page is too large to import.',
  redirect_limit: 'The page redirected too many times.',
  unsupported_content_type: 'The URL did not return an HTML page.',
};

/** Default production fetch wrapper using the SSRF-guarded safe fetcher. */
export function createSafeFetch(): (
  url: string,
) => Promise<SafeFetchResult | SafeFetchFailure> {
  return async (url: string) => {
    const result = await safeFetchHtml(url);
    if (result.ok) {
      return { ok: true, html: result.value.html, finalUrl: result.value.finalUrl };
    }
    return {
      ok: false,
      errorCode: SAFE_FETCH_CODE_MAP[result.error.code],
      message: SAFE_FETCH_MESSAGES[result.error.code],
    };
  };
}

// Social platforms whose pages require a login/JS session to render, so a
// server-side fetch only ever sees an empty app shell (no caption, no
// og:description). Import from these is out of scope (see spec); detect them
// up front so the failure is a clear, actionable message instead of the
// generic "schema mismatch" produced by feeding the AI an empty page.
const UNSUPPORTED_SOCIAL_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
]);

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

function isUnsupportedSocialUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (UNSUPPORTED_SOCIAL_HOSTS.has(hostname)) {
    return true;
  }
  return YOUTUBE_HOSTS.has(hostname) && url.pathname.startsWith('/shorts/');
}

const UNSUPPORTED_SOCIAL_MESSAGE =
  'Instagram, TikTok, Facebook, and YouTube Shorts links can’t be ' +
  'imported directly — these sites don’t expose the recipe as ' +
  'fetchable text. Open the post, copy the caption, and use "Paste text" ' +
  'instead.';

/** Strips scripts, styles, and tags, leaving sanitized page text for the AI. */
export function sanitizeHtmlForAi(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusForAiError(code: AiError['code']): number {
  if (code === 'invalid_credentials') return 502;
  if (code === 'provider_error') return 502;
  if (code === 'timeout') return 504;
  if (code === 'invalid_ai_output') return 422;
  return 502;
}

function mapAiError(code: AiError['code']): ImportErrorCode {
  if (code === 'invalid_ai_output') return 'invalid_ai_output';
  return 'provider_error';
}

function mapAiErrorMessage(error: AiError): string {
  if (error.code === 'invalid_credentials') {
    return 'The configured AI provider rejected the API key.';
  }
  if (error.code === 'provider_error') {
    return 'The AI provider request failed.';
  }
  if (error.code === 'timeout') {
    return 'The AI provider request timed out.';
  }
  return error.message;
}

interface ValidateDraftResult {
  ok: true;
  draft: RecipeDraft;
}

function validateDraft(draft: RecipeDraft): ValidateDraftResult | { ok: false; message: string } {
  const parsed = recipeDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      message: `The extracted recipe failed validation: ${parsed.error.issues[0]?.message ?? 'invalid data'}.`,
    };
  }
  return { ok: true, draft: parsed.data };
}

async function runAiExtraction(
  provider: AiProvider,
  config: AiCredentials,
  rawContent: string,
): Promise<Response> {
  const aiResult = await provider.extractRecipe(rawContent, config);
  if (!aiResult.ok) {
    return errorResponse(
      statusForAiError(aiResult.error.code),
      mapAiError(aiResult.error.code),
      mapAiErrorMessage(aiResult.error),
    );
  }
  const validated = validateDraft(aiResult.value);
  if (!validated.ok) {
    return errorResponse(422, 'invalid_ai_output', validated.message);
  }
  return jsonResponse({ draft: validated.draft, extractionMethod: 'ai' });
}

/**
 * Creates the import-recipe request handler. All dependencies are injected so
 * the suite runs under Vitest/Node without touching Deno APIs or real network.
 */
export function createImportRecipeHandler(options: ImportRecipeOptions) {
  return handleRequest({
    schema: bodySchema,
    verifyAuth: options.verifyAuth,
    handler: async (body, ctx) => {
      if (body.mode === 'url') {
        if (isUnsupportedSocialUrl(body.url)) {
          return errorResponse(422, 'unsupported_url', UNSUPPORTED_SOCIAL_MESSAGE);
        }

        const fetchResult = await options.safeFetch(body.url);
        if (!fetchResult.ok) {
          return errorResponse(
            fetchResult.errorCode === 'unsupported_url' ? 422 : 422,
            fetchResult.errorCode,
            fetchResult.message,
          );
        }

        const jsonLdResult = extractRecipeDraftFromHtml(
          fetchResult.html,
          fetchResult.finalUrl,
        );
        if (jsonLdResult.ok) {
          return jsonResponse({
            draft: jsonLdResult.value,
            extractionMethod: 'structured_markup',
          });
        }

        const config = await options.aiConfigReader.getConfig(ctx.userId);
        if (!config.configured) {
          return errorResponse(
            422,
            'ai_not_configured',
            'This page has no structured recipe markup and AI is not configured. Configure AI in settings or create the recipe manually.',
          );
        }

        const sanitized = sanitizeHtmlForAi(fetchResult.html);
        return runAiExtraction(options.provider, config.credentials, sanitized);
      }

      // mode === 'text'
      const config = await options.aiConfigReader.getConfig(ctx.userId);
      if (!config.configured) {
        return errorResponse(
          422,
          'ai_not_configured',
          'AI is not configured. Paste import requires AI; configure it in settings or create the recipe manually.',
        );
      }
      return runAiExtraction(options.provider, config.credentials, body.text);
    },
  });
}
