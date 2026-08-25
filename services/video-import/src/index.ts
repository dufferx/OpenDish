import { createVideoImportHandler } from './handler.js';
import { createNodeServer } from './server.js';
import { createYtDlpMetadataFetcher } from './yt-dlp.js';

function readNumber(
  value: string | undefined,
  fallback: number,
  field: string,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeNumber(value: string | undefined, fallback: number, field: string): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return parsed;
}

const expectedToken = process.env.VIDEO_IMPORT_SERVICE_SECRET ?? '';
if (expectedToken.length === 0) {
  throw new Error('VIDEO_IMPORT_SERVICE_SECRET is required.');
}

const port = readNumber(process.env.PORT, 8080, 'PORT');
const timeoutMs = readNumber(
  process.env.YT_DLP_TIMEOUT_MS,
  20_000,
  'YT_DLP_TIMEOUT_MS',
);
const maxOutputBytes = readNumber(
  process.env.YT_DLP_MAX_OUTPUT_BYTES,
  2 * 1024 * 1024,
  'YT_DLP_MAX_OUTPUT_BYTES',
);
const command = process.env.YT_DLP_BIN ?? 'yt-dlp';
const maxAttempts = readNumber(process.env.YT_DLP_MAX_ATTEMPTS, 2, 'YT_DLP_MAX_ATTEMPTS');
const retryBaseDelayMs = readNumber(process.env.YT_DLP_RETRY_BASE_DELAY_MS, 350, 'YT_DLP_RETRY_BASE_DELAY_MS');
const cacheTtlMs = readNonNegativeNumber(process.env.VIDEO_METADATA_CACHE_TTL_MS, 5 * 60 * 1000, 'VIDEO_METADATA_CACHE_TTL_MS');
const cacheMaxEntries = readNumber(process.env.VIDEO_METADATA_CACHE_MAX_ENTRIES, 256, 'VIDEO_METADATA_CACHE_MAX_ENTRIES');

const handler = createVideoImportHandler({
  expectedToken,
  fetcher: createYtDlpMetadataFetcher({
    command,
    timeoutMs,
    maxOutputBytes,
    maxAttempts,
    retryBaseDelayMs,
    cacheTtlMs,
    cacheMaxEntries,
  }),
});

const server = createNodeServer({ handler });

server.listen(port, () => {
  console.log(`video-import service listening on :${port}`);
});
