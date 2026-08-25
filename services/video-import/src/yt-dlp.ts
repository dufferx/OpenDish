import { spawn } from 'node:child_process';

import type { SupportedVideoPlatform } from './platforms.js';

export interface VideoMetadata {
  title: string;
  description: string;
}

export type VideoMetadataErrorCode =
  | 'unsupported_platform'
  | 'upstream_blocked'
  | 'upstream_failed'
  | 'timeout'
  | 'response_too_large';

export interface VideoMetadataError {
  code: VideoMetadataErrorCode;
  message: string;
}

export type VideoMetadataResult =
  | { ok: true; value: VideoMetadata }
  | { ok: false; error: VideoMetadataError };

export interface VideoMetadataFetcher {
  fetchMetadata(
    url: string,
    platform: SupportedVideoPlatform,
  ): Promise<VideoMetadataResult>;
}

export interface RunCommandResult {
  ok: true;
  stdout: string;
  stderr: string;
}

export type RunCommandFailureCode =
  | 'timeout'
  | 'response_too_large'
  | 'exit'
  | 'spawn';

export interface RunCommandFailure {
  ok: false;
  code: RunCommandFailureCode;
  stderr: string;
}

export interface RunCommandOptions {
  command: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export type RunCommand = (
  options: RunCommandOptions,
) => Promise<RunCommandResult | RunCommandFailure>;

export interface YtDlpMetadataFetcherOptions {
  command?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runCommand?: RunCommand;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function ok(value: VideoMetadata): VideoMetadataResult {
  return { ok: true, value };
}

function fail(
  code: VideoMetadataErrorCode,
  message: string,
): VideoMetadataResult {
  return { ok: false, error: { code, message } };
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
}

function safeParseMetadata(stdout: string): VideoMetadata | null {
  const jsonLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!jsonLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as { title?: unknown; description?: unknown };
  return {
    title: sanitizeText(record.title, 300),
    description: sanitizeText(record.description, 50_000),
  };
}

function mapExitFailure(stderr: string): VideoMetadataError {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes('login required') ||
    normalized.includes('please log in') ||
    normalized.includes('sign in') ||
    normalized.includes('forbidden') ||
    normalized.includes('http error 403') ||
    normalized.includes('requested content is not available') ||
    normalized.includes('not available from your location')
  ) {
    return {
      code: 'upstream_blocked',
      message:
        'The upstream platform blocked metadata extraction for this link.',
    };
  }

  return {
    code: 'upstream_failed',
    message: 'The upstream platform metadata request failed.',
  };
}

export async function defaultRunCommand(
  options: RunCommandOptions,
): Promise<RunCommandResult | RunCommandFailure> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let totalBytes = 0;

    const finish = (result: RunCommandResult | RunCommandFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const appendChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      totalBytes += chunk.byteLength;
      if (totalBytes > options.maxOutputBytes) {
        child.kill('SIGKILL');
        finish({ ok: false, code: 'response_too_large', stderr });
        return;
      }
      const text = chunk.toString('utf8');
      if (target === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, code: 'timeout', stderr });
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => appendChunk(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => appendChunk(chunk, 'stderr'));

    child.on('error', () => {
      finish({ ok: false, code: 'spawn', stderr });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, stdout, stderr });
        return;
      }
      finish({ ok: false, code: 'exit', stderr });
    });
  });
}

export function createYtDlpMetadataFetcher(
  options: YtDlpMetadataFetcherOptions = {},
): VideoMetadataFetcher {
  const command = options.command ?? 'yt-dlp';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const runCommand = options.runCommand ?? defaultRunCommand;

  return {
    async fetchMetadata(url) {
      const result = await runCommand({
        command,
        timeoutMs,
        maxOutputBytes,
        args: [
          '--dump-json',
          '--skip-download',
          '--no-playlist',
          '--no-warnings',
          '--socket-timeout',
          String(Math.max(1, Math.ceil(timeoutMs / 1000))),
          url,
        ],
      });

      if (!result.ok) {
        if (result.code === 'timeout') {
          return fail(
            'timeout',
            'The metadata extraction request timed out.',
          );
        }
        if (result.code === 'response_too_large') {
          return fail(
            'response_too_large',
            'The metadata extraction response was too large.',
          );
        }
        if (result.code === 'spawn') {
          return fail(
            'upstream_failed',
            'The metadata extractor is unavailable on this service instance.',
          );
        }
        const exitFailure = mapExitFailure(result.stderr);
        return fail(exitFailure.code, exitFailure.message);
      }

      const metadata = safeParseMetadata(result.stdout);
      if (!metadata) {
        return fail(
          'upstream_failed',
          'The metadata extractor returned an invalid response.',
        );
      }

      return ok(metadata);
    },
  };
}
