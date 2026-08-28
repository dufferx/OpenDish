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
  type RecipeImportExtractionMethod,
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
  videoImport: VideoImportClient;
}

export interface VideoImportSuccess {
  ok: true;
  title: string;
  description: string;
}

export interface VideoImportFailure {
  ok: false;
  errorCode: ImportErrorCode;
  message: string;
}

export interface VideoImportClient {
  fetchMetadata(url: string): Promise<VideoImportSuccess | VideoImportFailure>;
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

type SupportedVideoPlatform = 'instagram_reel' | 'tiktok_video' | 'youtube_short';

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

const UNSUPPORTED_SOCIAL_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
]);

function detectSupportedVideoPlatform(rawUrl: string): SupportedVideoPlatform | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const segments = pathname.split('/').filter(Boolean);

  if (INSTAGRAM_HOSTS.has(hostname) && segments[0] === 'reel' && segments.length >= 2) {
    return 'instagram_reel';
  }

  if (TIKTOK_HOSTS.has(hostname)) {
    if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') {
      return pathname !== '/' ? 'tiktok_video' : null;
    }
    if (
      /^\/@[^/]+\/video\/[^/]+\/?$/.test(pathname) ||
      /^\/(?:t|v)\/[^/]+\/?$/.test(pathname)
    ) {
      return 'tiktok_video';
    }
  }

  if (YOUTUBE_HOSTS.has(hostname) && segments[0] === 'shorts' && segments.length >= 2) {
    return 'youtube_short';
  }

  return null;
}

function isKnownUnsupportedSocialUrl(rawUrl: string): boolean {
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

  return (
    INSTAGRAM_HOSTS.has(hostname) ||
    TIKTOK_HOSTS.has(hostname) ||
    YOUTUBE_HOSTS.has(hostname)
  );
}

const UNSUPPORTED_SOCIAL_MESSAGE =
  'Only public Instagram Reels, TikTok videos, and YouTube Shorts links ' +
  'are supported for direct video import. For anything else, copy the ' +
  'caption or description and use "Paste text" instead.';

const VIDEO_METADATA_NO_RECIPE_MESSAGE =
  'This video did not expose a usable caption or description for import. ' +
  'Copy the caption or description and use "Paste text" instead.';

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
  extractionMethod: RecipeImportExtractionMethod = 'ai',
  invalidOutputErrorCode: ImportErrorCode = 'invalid_ai_output',
  invalidOutputMessage?: string,
): Promise<Response> {
  const aiResult = await provider.extractRecipe(rawContent, config);
  if (!aiResult.ok) {
    if (aiResult.error.code === 'invalid_ai_output') {
      return errorResponse(
        422,
        invalidOutputErrorCode,
        invalidOutputMessage ?? aiResult.error.message,
      );
    }
    return errorResponse(
      statusForAiError(aiResult.error.code),
      mapAiError(aiResult.error.code),
      mapAiErrorMessage(aiResult.error),
    );
  }
  const validated = validateDraft(aiResult.value);
  if (!validated.ok) {
    return errorResponse(
      422,
      invalidOutputErrorCode,
      invalidOutputMessage ?? validated.message,
    );
  }
  return jsonResponse({ draft: validated.draft, extractionMethod });
}

function buildVideoMetadataContent(title: string, description: string): string {
  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  // A title alone is not recipe content. Requiring a non-empty caption or
  // description prevents the AI fallback from hallucinating a recipe from a
  // video title when metadata-only extraction found no usable source text.
  if (!normalizedDescription) {
    return '';
  }
  return [
    normalizedTitle ? `Video title: ${normalizedTitle}` : null,
    `Caption or description:\n${normalizedDescription}`,
  ]
    .filter((value): value is string => value !== null)
    .join('\n\n');
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
        const supportedVideoPlatform = detectSupportedVideoPlatform(body.url);
        if (supportedVideoPlatform) {
          const videoImportResult = await options.videoImport.fetchMetadata(body.url);
          if (!videoImportResult.ok) {
            return errorResponse(
              422,
              videoImportResult.errorCode,
              videoImportResult.message,
            );
          }

          const rawVideoContent = buildVideoMetadataContent(
            videoImportResult.title,
            videoImportResult.description,
          );
          if (rawVideoContent.length === 0) {
            return errorResponse(
              422,
              'no_recipe_found',
              VIDEO_METADATA_NO_RECIPE_MESSAGE,
            );
          }

          const config = await options.aiConfigReader.getConfig(ctx.userId);
          if (!config.configured) {
            return errorResponse(
              422,
              'ai_not_configured',
              'Video caption import requires AI to be configured. Configure AI in settings or paste the recipe manually.',
            );
          }

          return runAiExtraction(
            options.provider,
            config.credentials,
            rawVideoContent,
            'video_metadata',
            'no_recipe_found',
            VIDEO_METADATA_NO_RECIPE_MESSAGE,
          );
        }

        if (isKnownUnsupportedSocialUrl(body.url)) {
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
