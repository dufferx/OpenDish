// SSRF-guarded fetch for URL recipe import (T029, research R2): https only,
// DNS resolution with rejection of private/loopback/link-local/reserved
// ranges (IPv4 and IPv6), 2 MB response cap, 10 s timeout, max 3 redirects,
// and a text/html content-type requirement. DNS and fetch are injected so
// the guard logic is fully testable without network access.
import type { FetchLike } from './openai-provider.ts';

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'blocked_address'
  | 'fetch_failed'
  | 'timeout'
  | 'too_large'
  | 'redirect_limit'
  | 'unsupported_content_type';

export interface SafeFetchError {
  code: SafeFetchErrorCode;
  message: string;
}

export interface SafeFetchSuccess {
  html: string;
  finalUrl: string;
}

export type SafeFetchResult =
  | { ok: true; value: SafeFetchSuccess }
  | { ok: false; error: SafeFetchError };

export type DnsResolver = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
  fetchFn?: FetchLike;
  resolveHost?: DnsResolver;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function fail(code: SafeFetchErrorCode, message: string): SafeFetchResult {
  return { ok: false, error: { code, message } };
}

/** Parses a dotted-decimal IPv4 literal into a 32-bit number, or null. */
function parseIpv4(ip: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) {
    return null;
  }
  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(match[i]);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Expands an IPv6 literal into 8 hextets, or null when invalid. */
function parseIpv6(ip: string): number[] | null {
  let input = ip;
  const zoneIndex = input.indexOf('%');
  if (zoneIndex !== -1) {
    input = input.slice(0, zoneIndex);
  }
  const v4Tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(input);
  let tailHextets: number[] = [];
  if (v4Tail) {
    const v4 = parseIpv4(v4Tail[1]);
    if (v4 === null) {
      return null;
    }
    tailHextets = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    input = input.slice(0, input.length - v4Tail[1].length).replace(/:$/, '');
  }
  const halves = input.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parseGroup = (group: string): number[] | null => {
    if (group.length === 0) {
      return [];
    }
    const parts = group.split(':').map((part) => {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
        return Number.NaN;
      }
      return parseInt(part, 16);
    });
    return parts.some(Number.isNaN) ? null : parts;
  };
  const left = parseGroup(halves[0]);
  const right = halves.length === 2 ? parseGroup(halves[1]) : [];
  if (left === null || right === null) {
    return null;
  }
  const hextets = [...left, ...right, ...tailHextets];
  if (halves.length === 2) {
    const missing = 8 - hextets.length;
    if (missing < 0) {
      return null;
    }
    return [
      ...left,
      ...Array<number>(missing).fill(0),
      ...right,
      ...tailHextets,
    ];
  }
  return hextets.length === 8 ? hextets : null;
}

function isPrivateIpv4(value: number): boolean {
  const inRange = (base: number, prefix: number): boolean => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  };
  return (
    inRange(0x00000000, 8) || // 0.0.0.0/8 "this host"
    inRange(0x0a000000, 8) || // 10.0.0.0/8 private
    inRange(0x64400000, 10) || // 100.64.0.0/10 CGNAT
    inRange(0x7f000000, 8) || // 127.0.0.0/8 loopback
    inRange(0xa9fe0000, 16) || // 169.254.0.0/16 link-local (cloud metadata)
    inRange(0xac100000, 12) || // 172.16.0.0/12 private
    inRange(0xc0000000, 24) || // 192.0.0.0/24 IETF protocol assignments
    inRange(0xc0000200, 24) || // 192.0.2.0/24 documentation
    inRange(0xc0a80000, 16) || // 192.168.0.0/16 private
    inRange(0xc6120000, 15) || // 198.18.0.0/15 benchmarking
    inRange(0xc6336400, 24) || // 198.51.100.0/24 documentation
    inRange(0xcb007100, 24) || // 203.0.113.0/24 documentation
    inRange(0xe0000000, 4) || // 224.0.0.0/4 multicast
    inRange(0xf0000000, 4) // 240.0.0.0/4 reserved
  );
}

function isPrivateIpv6(hextets: number[]): boolean {
  const allZero = hextets.every((h) => h === 0);
  if (allZero) {
    return true; // :: unspecified
  }
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) {
    return true; // ::1 loopback
  }
  if ((hextets[0] & 0xfe00) === 0xfc00) {
    return true; // fc00::/7 unique local
  }
  if ((hextets[0] & 0xffc0) === 0xfe80) {
    return true; // fe80::/10 link-local
  }
  if ((hextets[0] & 0xff00) === 0xff00) {
    return true; // ff00::/8 multicast
  }
  if (hextets[0] === 0x2001 && hextets[1] === 0x0db8) {
    return true; // 2001:db8::/32 documentation
  }
  // IPv4-embedded forms: ::ffff:a.b.c.d (mapped) and 64:ff9b::/96 (NAT64).
  const isMapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  const isNat64 =
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((h) => h === 0);
  if (isMapped || isNat64) {
    const embedded = ((hextets[6] << 16) | hextets[7]) >>> 0;
    return isPrivateIpv4(embedded);
  }
  return false;
}

/** True when the literal IP address is public/routable. */
export function isPublicIpAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) {
    return !isPrivateIpv4(v4);
  }
  const v6 = parseIpv6(ip);
  if (v6 !== null) {
    return !isPrivateIpv6(v6);
  }
  return false;
}

/**
 * Default resolver for the Deno edge runtime. `Deno.resolveDns` requires an
 * unstable API; when the runtime cannot resolve hostnames the guard fails
 * closed rather than skipping the SSRF check.
 */
async function defaultResolveHost(hostname: string): Promise<string[]> {
  const deno = (
    globalThis as {
      Deno?: { resolveDns?: (h: string, record: string) => Promise<string[]> };
    }
  ).Deno;
  if (!deno || typeof deno.resolveDns !== 'function') {
    throw new Error('DNS resolution is unavailable in this runtime.');
  }
  const [aRecords, aaaaRecords] = await Promise.all([
    deno.resolveDns(hostname, 'A').catch(() => [] as string[]),
    deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[]),
  ]);
  return [...aRecords, ...aaaaRecords];
}

function extractHostname(hostname: string): string {
  // Strip IPv6 literal brackets.
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

async function assertPublicTarget(
  url: URL,
  resolveHost: DnsResolver,
): Promise<SafeFetchError | null> {
  const hostname = extractHostname(url.hostname);
  const literalV4 = parseIpv4(hostname);
  const literalV6 = literalV4 === null ? parseIpv6(hostname) : null;
  if (literalV4 !== null || literalV6 !== null) {
    if (!isPublicIpAddress(hostname)) {
      return {
        code: 'blocked_address',
        message: 'The URL points to a non-public network address.',
      };
    }
    return null;
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    return {
      code: 'fetch_failed',
      message: 'The remote host could not be verified.',
    };
  }
  if (addresses.length === 0) {
    return { code: 'fetch_failed', message: 'The remote host did not resolve.' };
  }
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    return {
      code: 'blocked_address',
      message: 'The URL resolves to a non-public network address.',
    };
  }
  return null;
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string } | { tooLarge: true }> {
  if (!response.body) {
    const text = await response.text();
    return text.length > maxBytes ? { tooLarge: true } : { text };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {
        // Best-effort stream cleanup.
      });
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged) };
}

/**
 * Fetches an HTML page defensively for recipe import. Every redirect target
 * is re-validated (scheme + DNS) before being followed.
 */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const fetchFn: FetchLike =
    options.fetchFn ?? ((input, init) => fetch(input, init));
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return fail('invalid_url', 'The URL is not valid.');
  }

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (current.protocol !== 'https:') {
      return fail('unsupported_scheme', 'Only https:// URLs can be imported.');
    }
    const targetError = await assertPublicTarget(current, resolveHost);
    if (targetError) {
      return { ok: false, error: targetError };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'text/html' },
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timer);
      if (cause instanceof Error && cause.name === 'AbortError') {
        return fail('timeout', 'The page took too long to respond.');
      }
      return fail('fetch_failed', 'The page could not be fetched.');
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (isRedirect) {
      clearTimeout(timer);
      const location = response.headers.get('Location');
      if (!location) {
        return fail('fetch_failed', 'The page returned an invalid redirect.');
      }
      if (redirectCount >= maxRedirects) {
        return fail('redirect_limit', 'The page redirected too many times.');
      }
      try {
        current = new URL(location, current);
      } catch {
        return fail('fetch_failed', 'The page returned an invalid redirect.');
      }
      continue;
    }

    if (!response.ok) {
      clearTimeout(timer);
      return fail(
        'fetch_failed',
        `The page request failed (HTTP ${response.status}).`,
      );
    }
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      clearTimeout(timer);
      return fail(
        'unsupported_content_type',
        'The URL did not return an HTML page.',
      );
    }
    try {
      const body = await readBodyCapped(response, maxBytes);
      clearTimeout(timer);
      if ('tooLarge' in body) {
        return fail('too_large', 'The page is too large to import.');
      }
      return {
        ok: true,
        value: { html: body.text, finalUrl: current.toString() },
      };
    } catch {
      clearTimeout(timer);
      return fail('fetch_failed', 'The page body could not be read.');
    }
  }
}
