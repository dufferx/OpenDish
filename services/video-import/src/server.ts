import http from 'node:http';

import { errorResponse } from './http.js';

export interface NodeServerOptions {
  handler: (request: Request) => Promise<Response>;
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 8 * 1024;

export function createNodeServer(options: NodeServerOptions): http.Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBodyBytes) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'invalid_request',
              message: 'The request body could not be read.',
            },
          }),
        );
      }
    });

    req.on('end', async () => {
      if (totalBytes > maxBodyBytes) {
        const response = errorResponse(
          413,
          'payload_too_large',
          'Request body exceeded the service limit.',
        );
        await writeNodeResponse(res, response);
        return;
      }

      const body = Buffer.concat(chunks);
      const origin = `http://${req.headers.host ?? 'localhost'}`;
      const request = new Request(new URL(req.url ?? '/', origin), {
        method: req.method ?? 'GET',
        headers: new Headers(
          Object.entries(req.headers).flatMap(([key, value]) => {
            if (Array.isArray(value)) {
              return value.map((entry) => [key, entry] as [string, string]);
            }
            return value ? [[key, value] as [string, string]] : [];
          }),
        ),
        body:
          body.byteLength > 0 &&
          req.method !== 'GET' &&
          req.method !== 'HEAD'
            ? body
            : undefined,
      });

      const response = await options.handler(request);
      await writeNodeResponse(res, response);
    });
  });
}

async function writeNodeResponse(
  res: http.ServerResponse,
  response: Response,
): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}
