import { describe, expect, it } from 'vitest';

import { createVideoImportHandler } from '../src/handler.js';
import type {
  VideoMetadataFetcher,
  VideoMetadataResult,
} from '../src/yt-dlp.js';

function makeRequest(
  body: unknown,
  token = 'service-secret',
  method = 'POST',
): Request {
  return new Request('http://localhost/metadata', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function staticFetcher(
  result: VideoMetadataResult,
): VideoMetadataFetcher {
  return {
    async fetchMetadata() {
      return result;
    },
  };
}

describe('video import handler', () => {
  it('returns metadata for a supported Instagram Reel URL', async () => {
    const handler = createVideoImportHandler({
      expectedToken: 'service-secret',
      fetcher: staticFetcher({
        ok: true,
        value: {
          title: 'Tomato Pasta',
          description: 'Full recipe in the caption.',
        },
      }),
    });

    const response = await handler(
      makeRequest({ url: 'https://www.instagram.com/reel/C9abc123/' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      title: 'Tomato Pasta',
      description: 'Full recipe in the caption.',
    });
  });

  it('rejects unsupported platforms with a safe contract error', async () => {
    const handler = createVideoImportHandler({
      expectedToken: 'service-secret',
      fetcher: staticFetcher({
        ok: true,
        value: { title: 'unused', description: 'unused' },
      }),
    });

    const response = await handler(
      makeRequest({ url: 'https://www.facebook.com/watch/?v=123' }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unsupported_platform',
        message:
          'Only public Instagram Reels, TikTok videos, and YouTube Shorts URLs are supported.',
      },
    });
  });

  it('returns a clear upstream-blocked error for supported platforms', async () => {
    const handler = createVideoImportHandler({
      expectedToken: 'service-secret',
      fetcher: staticFetcher({
        ok: false,
        error: {
          code: 'upstream_blocked',
          message: 'blocked',
        },
      }),
    });

    const response = await handler(
      makeRequest({ url: 'https://www.youtube.com/shorts/abc123' }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'upstream_blocked',
        message:
          'YouTube Short metadata is currently blocked upstream. Copy the caption or description and use paste text instead.',
      },
    });
  });

  it('rejects extra request fields so cookies are never accepted', async () => {
    const handler = createVideoImportHandler({
      expectedToken: 'service-secret',
      fetcher: staticFetcher({
        ok: true,
        value: { title: 'unused', description: 'unused' },
      }),
    });

    const response = await handler(
      makeRequest({
        url: 'https://www.tiktok.com/@cook/video/123',
        cookies: 'sessionid=secret-cookie',
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Request body failed validation.');
    expect(JSON.stringify(body)).not.toContain('secret-cookie');
  });

  it('requires the shared service token', async () => {
    const handler = createVideoImportHandler({
      expectedToken: 'service-secret',
      fetcher: staticFetcher({
        ok: true,
        value: { title: 'unused', description: 'unused' },
      }),
    });

    const response = await handler(
      makeRequest(
        { url: 'https://www.instagram.com/reel/C9abc123/' },
        'wrong-secret',
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unauthorized',
        message: 'A valid service token is required.',
      },
    });
  });
});
