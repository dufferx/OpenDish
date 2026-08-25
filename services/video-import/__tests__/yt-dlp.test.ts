import { describe, expect, it, vi } from 'vitest';

import { createYtDlpMetadataFetcher } from '../src/yt-dlp.js';

describe('yt-dlp metadata fetcher', () => {
  it('uses metadata-only yt-dlp flags and parses the JSON result', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({
        title: 'Spicy Noodles',
        description: 'Cook noodles, add chili oil.',
      }),
      stderr: '',
    });

    const fetcher = createYtDlpMetadataFetcher({
      command: '/usr/local/bin/yt-dlp',
      runCommand,
      timeoutMs: 9_000,
      maxOutputBytes: 123_456,
    });

    const result = await fetcher.fetchMetadata(
      'https://www.tiktok.com/@cook/video/123',
      'tiktok_video',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        title: 'Spicy Noodles',
        description: 'Cook noodles, add chili oil.',
      },
    });
    expect(runCommand).toHaveBeenCalledWith({
      command: '/usr/local/bin/yt-dlp',
      timeoutMs: 9_000,
      maxOutputBytes: 123_456,
      args: [
        '--dump-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '9',
        'https://www.tiktok.com/@cook/video/123',
      ],
    });
  });

  it('maps login walls and 403s to upstream_blocked without leaking stderr', async () => {
    const fetcher = createYtDlpMetadataFetcher({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        code: 'exit',
        stderr:
          'ERROR: [Instagram] login required and forbidden 403 sessionid=secret-cookie',
      }),
    });

    const result = await fetcher.fetchMetadata(
      'https://www.instagram.com/reel/C9abc123/',
      'instagram_reel',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'upstream_blocked',
        message: 'The upstream platform blocked metadata extraction for this link.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-cookie');
  });

  it('maps oversized output to a safe response_too_large error', async () => {
    const fetcher = createYtDlpMetadataFetcher({
      runCommand: vi.fn().mockResolvedValue({
        ok: false,
        code: 'response_too_large',
        stderr: '',
      }),
    });

    const result = await fetcher.fetchMetadata(
      'https://www.youtube.com/shorts/abc123',
      'youtube_short',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'response_too_large',
        message: 'The metadata extraction response was too large.',
      },
    });
  });
});
