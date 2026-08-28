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
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  runCommand?: RunCommand;
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  logger?: (event: MetadataLogEvent) => void;
}

export interface MetadataLogEvent {
  event: 'metadata_attempt' | 'metadata_result';
  platform: SupportedVideoPlatform;
  attempt: number;
  durationMs: number;
  outcome: 'attempt' | 'success' | 'retry' | 'failure' | 'cache_hit';
  errorCode?: VideoMetadataErrorCode;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;

function ok(value: VideoMetadata): { ok: true; value: VideoMetadata } {
  return { ok: true, value };
}

function fail(
  code: VideoMetadataErrorCode,
  message: string,
): { ok: false; error: VideoMetadataError } {
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

function isRetryableFailure(result: RunCommandFailure): boolean {
  if (result.code === 'timeout') return true;
  if (result.code !== 'exit') return false;

  const normalized = result.stderr.toLowerCase();
  return [
    'rate-limit',
    'rate limit',
    'too many requests',
    'http error 429',
    'temporarily unavailable',
    'connection reset',
    'connection timed out',
    'temporary failure',
  ].some((marker) => normalized.includes(marker));
}

function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function defaultLogger(event: MetadataLogEvent): void {
  console.info(JSON.stringify(event));
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
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const cacheMaxEntries = Math.max(1, options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;
  const cache = new Map<string, { expiresAt: number; value: VideoMetadata }>();

  return {
    async fetchMetadata(url, platform) {
      const cacheKey = canonicalizeUrl(url);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > now()) {
        logger({ event: 'metadata_result', platform, attempt: 0, durationMs: 0, outcome: 'cache_hit' });
        return ok(cached.value);
      }
      if (cached) cache.delete(cacheKey);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = now();
        logger({ event: 'metadata_attempt', platform, attempt, durationMs: 0, outcome: 'attempt' });
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

        if (result.ok) {
          const metadata = safeParseMetadata(result.stdout);
          if (metadata) {
            if (cacheTtlMs > 0) {
              if (cache.size >= cacheMaxEntries) {
                const oldestKey = cache.keys().next().value;
                if (oldestKey) cache.delete(oldestKey);
              }
              cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, value: metadata });
            }
            logger({ event: 'metadata_result', platform, attempt, durationMs: Math.max(0, now() - startedAt), outcome: 'success' });
            return ok(metadata);
          }
        }

        if (!result.ok && isRetryableFailure(result) && attempt < maxAttempts) {
          const errorCode = result.code === 'timeout' ? 'timeout' : mapExitFailure(result.stderr).code;
          logger({ event: 'metadata_result', platform, attempt, durationMs: Math.max(0, now() - startedAt), outcome: 'retry', errorCode });
          await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }

        let failure: VideoMetadataResult;
        if (!result.ok) {
          if (result.code === 'timeout') {
            failure = fail('timeout', 'The metadata extraction request timed out.');
          } else if (result.code === 'response_too_large') {
            failure = fail('response_too_large', 'The metadata extraction response was too large.');
          } else if (result.code === 'spawn') {
            failure = fail('upstream_failed', 'The metadata extractor is unavailable on this service instance.');
          } else {
            const exitFailure = mapExitFailure(result.stderr);
            failure = fail(exitFailure.code, exitFailure.message);
          }
        } else {
          failure = fail('upstream_failed', 'The metadata extractor returned an invalid response.');
        }
        logger({ event: 'metadata_result', platform, attempt, durationMs: Math.max(0, now() - startedAt), outcome: 'failure', errorCode: failure.error.code });
        return failure;
      }

      return fail('upstream_failed', 'The metadata request failed.');
    },
  };
}
