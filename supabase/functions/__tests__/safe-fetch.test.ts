import { describe, expect, it } from 'vitest';
import {
  isPublicIpAddress,
  safeFetchHtml,
  type DnsResolver,
  type FetchLike,
} from '../_shared/safe-fetch.ts';

const publicResolver =
  (...ips: string[]): DnsResolver =>
  async () =>
    ips;

function makeResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'text/html' },
): Response {
  return new Response(body, { status, headers });
}

function makeRedirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: location },
  });
}

function makeStreamResponse(
  chunks: string[],
  headers: Record<string, string> = { 'Content-Type': 'text/html' },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

function failingFetch(message: string): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

function staticFetch(response: Response): FetchLike {
  return async () => response;
}

function sequentialFetch(responses: Response[]): FetchLike {
  let index = 0;
  return async () => {
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error('unexpected fetch call');
    }
    return response;
  };
}

describe('isPublicIpAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['192.168.1.1', false],
    ['10.0.0.1', false],
    ['127.0.0.1', false],
    ['169.254.1.1', false],
    ['172.16.0.1', false],
    ['100.64.0.1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['::ffff:192.168.1.1', false],
    ['::ffff:8.8.8.8', true],
    ['64:ff9b::192.168.1.1', false],
    // NAT64 with a public embedded IPv4 is treated as non-public by this parser
    // because the IPv4 tail parser normalizes the address conservatively.
    ['64:ff9b::8.8.8.8', false],
  ])('%s -> public=%s', (ip, expected) => {
    expect(isPublicIpAddress(ip)).toBe(expected);
  });
});

describe('safeFetchHtml', () => {
  it('rejects non-https schemes', async () => {
    const result = await safeFetchHtml('http://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported_scheme');
    }
  });

  it('rejects private IPv4 addresses resolved from a hostname', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('192.168.1.1'),
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked_address');
    }
  });

  it('rejects loopback IPv4 addresses resolved from a hostname', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('127.0.0.1'),
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked_address');
    }
  });

  it('rejects link-local IPv6 addresses resolved from a hostname', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('fe80::1'),
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked_address');
    }
  });

  it('rejects literal loopback IPv6 addresses without DNS', async () => {
    const result = await safeFetchHtml('https://[::1]/recipe', {
      resolveHost: publicResolver(),
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked_address');
    }
  });

  it('succeeds for a public https target', async () => {
    const html = '<html><body>Recipe</body></html>';
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: staticFetch(makeResponse(html)),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.html).toBe(html);
      expect(result.value.finalUrl).toBe('https://example.com/recipe');
    }
  });

  it('rejects responses that exceed the byte cap', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: staticFetch(makeStreamResponse(['x'.repeat(33)])),
      maxBytes: 32,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('too_large');
    }
  });

  it('rejects a timeout when the fetch aborts', async () => {
    const fetchFn: FetchLike = async (_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new Error('AbortError'));
          return;
        }
        const onAbort = () => {
          const error = new Error('AbortError');
          (error as Error).name = 'AbortError';
          reject(error);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn,
      timeoutMs: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
    }
  });

  it('rejects network failures as fetch_failed', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: failingFetch('network error'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fetch_failed');
    }
  });

  it('follows a redirect and reports the final URL', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: sequentialFetch([
        makeRedirectResponse('https://example.com/recipe-final'),
        makeResponse('<html>Final</html>'),
      ]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.finalUrl).toBe('https://example.com/recipe-final');
    }
  });

  it('rejects too many redirects', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: sequentialFetch([
        makeRedirectResponse('https://example.com/r1'),
        makeRedirectResponse('https://example.com/r2'),
        makeRedirectResponse('https://example.com/r3'),
        makeRedirectResponse('https://example.com/r4'),
      ]),
      maxRedirects: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('redirect_limit');
    }
  });

  it('rejects non-HTML content types', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: publicResolver('93.184.216.34'),
      fetchFn: staticFetch(
        makeResponse('{}', 200, { 'Content-Type': 'application/json' }),
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unsupported_content_type');
    }
  });

  it('validates redirect targets before following them', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: async (hostname) => {
        return hostname === 'example.com' ? ['93.184.216.34'] : ['127.0.0.1'];
      },
      fetchFn: sequentialFetch([
        makeRedirectResponse('https://internal.example.com/recipe'),
        makeResponse('<html></html>'),
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('blocked_address');
    }
  });

  it('rejects a missing DNS response', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: async () => [],
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fetch_failed');
    }
  });

  it('rejects DNS resolution errors', async () => {
    const result = await safeFetchHtml('https://example.com/recipe', {
      resolveHost: async () => {
        throw new Error('dns failure');
      },
      fetchFn: staticFetch(makeResponse('<html></html>')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('fetch_failed');
    }
  });
});
