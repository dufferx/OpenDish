import { z } from 'zod';

import { detectSupportedVideoPlatform, platformLabel } from './platforms.js';
import { errorResponse, jsonResponse } from './http.js';
import type { VideoMetadataFetcher } from './yt-dlp.js';

const requestSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export interface VideoImportHandlerOptions {
  expectedToken: string;
  fetcher: VideoMetadataFetcher;
}

export function createVideoImportHandler(
  options: VideoImportHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    if (request.method !== 'POST') {
      return errorResponse(
        405,
        'method_not_allowed',
        'Only POST requests are supported.',
      );
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${options.expectedToken}`) {
      return errorResponse(
        401,
        'unauthorized',
        'A valid service token is required.',
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
    }

    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return errorResponse(
        400,
        'validation_failed',
        'Request body failed validation.',
      );
    }

    const platform = detectSupportedVideoPlatform(parsed.data.url);
    if (!platform) {
      return errorResponse(
        422,
        'unsupported_platform',
        'Only public Instagram Reels, TikTok videos, and YouTube Shorts URLs are supported.',
      );
    }

    const metadata = await options.fetcher.fetchMetadata(parsed.data.url, platform);
    if (!metadata.ok) {
      if (metadata.error.code === 'upstream_blocked') {
        return errorResponse(
          502,
          'upstream_blocked',
          `${platformLabel(platform)} metadata is currently blocked upstream. Copy the caption or description and use paste text instead.`,
        );
      }
      if (metadata.error.code === 'timeout') {
        return errorResponse(
          504,
          'timeout',
          `${platformLabel(platform)} metadata took too long to load. Copy the caption or description and use paste text instead.`,
        );
      }
      if (metadata.error.code === 'response_too_large') {
        return errorResponse(
          502,
          'upstream_failed',
          'The video metadata response was too large to import safely.',
        );
      }
      return errorResponse(502, 'upstream_failed', metadata.error.message);
    }

    return jsonResponse(metadata.value);
  };
}
