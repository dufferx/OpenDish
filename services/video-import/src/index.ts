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

const expectedToken = process.env.VIDEO_IMPORT_SERVICE_SECRET ?? '';
if (expectedToken.length === 0) {
  throw new Error('VIDEO_IMPORT_SERVICE_SECRET is required.');
}

const port = readNumber(process.env.PORT, 8080, 'PORT');
const timeoutMs = readNumber(
  process.env.YT_DLP_TIMEOUT_MS,
  10_000,
  'YT_DLP_TIMEOUT_MS',
);
const maxOutputBytes = readNumber(
  process.env.YT_DLP_MAX_OUTPUT_BYTES,
  2 * 1024 * 1024,
  'YT_DLP_MAX_OUTPUT_BYTES',
);
const command = process.env.YT_DLP_BIN ?? 'yt-dlp';

const handler = createVideoImportHandler({
  expectedToken,
  fetcher: createYtDlpMetadataFetcher({
    command,
    timeoutMs,
    maxOutputBytes,
  }),
});

const server = createNodeServer({ handler });

server.listen(port, () => {
  console.log(`video-import service listening on :${port}`);
});
