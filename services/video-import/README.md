# Video Import Service

This service is the separately hosted Phase 11.75 metadata importer for public
Instagram Reels, TikTok videos, and YouTube Shorts.

It accepts one authenticated `POST /metadata` request with a JSON body:

```json
{ "url": "https://www.instagram.com/reel/..." }
```

The response is metadata-only and never downloads media bytes:

```json
{ "title": "Recipe title", "description": "Caption or description text" }
```

## Behavior

- Uses `yt-dlp --dump-json --skip-download --no-playlist`
- Enforces a strict URL allowlist for Instagram Reels, TikTok videos, and
  YouTube Shorts only
- Requires a shared secret in the `Authorization: Bearer ...` header
- Applies a 20 s subprocess timeout, one bounded retry for transient upstream
  failures, and a 2 MB stdout/stderr cap by default
- Caches successful metadata for five minutes (up to 256 URLs)
- Emits safe structured timing/outcome logs without URLs, captions, cookies, or
  secrets
- Returns safe error envelopes with no cookies, secrets, or raw upstream stderr

## Environment

- `VIDEO_IMPORT_SERVICE_SECRET` (required): shared secret also configured in
  Supabase as `VIDEO_IMPORT_SERVICE_SECRET`
- `PORT` (optional, default `8080`)
- `YT_DLP_BIN` (optional, default `yt-dlp`)
- `YT_DLP_TIMEOUT_MS` (optional, default `20000`)
- `YT_DLP_MAX_OUTPUT_BYTES` (optional, default `2097152`)
- `YT_DLP_MAX_ATTEMPTS` (optional, default `2`)
- `YT_DLP_RETRY_BASE_DELAY_MS` (optional, default `350`)
- `VIDEO_METADATA_CACHE_TTL_MS` (optional, default `300000`; set to `0` to disable)
- `VIDEO_METADATA_CACHE_MAX_ENTRIES` (optional, default `256`)

## Local Run

Install a pinned `yt-dlp` binary first. The included Dockerfile pins
`yt-dlp==2026.08.19`.

```bash
pnpm install
pnpm --filter @opendish/video-import-service build
VIDEO_IMPORT_SERVICE_SECRET=replace-me \
YT_DLP_BIN=yt-dlp \
pnpm --filter @opendish/video-import-service start
```

## Container Build

```bash
docker build -f services/video-import/Dockerfile -t opendish-video-import .
docker run -p 8080:8080 \
  -e VIDEO_IMPORT_SERVICE_SECRET=replace-me \
  opendish-video-import
```
