// Shared Edge Function request/response helpers (T025): CORS, safe error
// envelopes, JWT verification via the Supabase service client, and a
// `handleRequest` wrapper that validates the body with Zod before invoking
// the handler. Runtime-neutral (web-standard Request/Response only) so it
// runs under Deno in production and Node in tests.
import { z } from 'zod';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * The only error shape ever returned to clients. Messages must be safe:
 * no stack traces, no request bodies, no credentials, no provider payloads.
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export type AuthResult = { ok: true; userId: string } | { ok: false };

/**
 * Minimal structural subset of the Supabase service client used for auth.
 * Tests inject a fake; the Deno entrypoint passes a real `supabase-js`
 * client created with the service-role key.
 */
export interface SupabaseAuthClient {
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export type AuthVerifier = (request: Request) => Promise<AuthResult>;

/**
 * Verifies the caller's Supabase JWT by exchanging it for the user via
 * `auth.getUser` on the service client. Never trusts the token's claims
 * without this server-side round trip.
 */
export function createAuthVerifier(client: SupabaseAuthClient): AuthVerifier {
  return async (request) => {
    const header = request.headers.get('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return { ok: false };
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      return { ok: false };
    }
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        return { ok: false };
      }
      return { ok: true, userId: data.user.id };
    } catch {
      // Auth service unreachable or client threw: fail closed.
      return { ok: false };
    }
  };
}

export interface HandlerContext {
  userId: string;
}

export interface HandleRequestOptions<Schema extends z.ZodTypeAny> {
  schema: Schema;
  verifyAuth: AuthVerifier;
  handler: (
    body: z.infer<Schema>,
    ctx: HandlerContext,
  ) => Promise<Response>;
}

/**
 * Uniform request pipeline for every Edge Function:
 * CORS preflight -> method gate -> JWT verification -> JSON parse -> Zod
 * validation -> handler. Unexpected handler errors are caught and returned
 * as a generic 500 envelope — internals never leak to the client.
 */
export function handleRequest<Schema extends z.ZodTypeAny>(
  options: HandleRequestOptions<Schema>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return errorResponse(
        405,
        'method_not_allowed',
        'Only POST requests are supported.',
      );
    }
    try {
      const auth = await options.verifyAuth(request);
      if (!auth.ok) {
        return errorResponse(
          401,
          'unauthorized',
          'A valid sign-in session is required.',
        );
      }
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return errorResponse(
          400,
          'invalid_json',
          'Request body must be valid JSON.',
        );
      }
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(
          400,
          'validation_failed',
          'Request body failed validation.',
        );
      }
      return await options.handler(parsed.data, { userId: auth.userId });
    } catch (cause) {
      // Log the message only (never the request, which may carry secrets)
      // and return a generic envelope.
      console.error(
        'Unhandled Edge Function error:',
        cause instanceof Error ? cause.message : 'unknown',
      );
      return errorResponse(
        500,
        'internal_error',
        'An unexpected error occurred.',
      );
    }
  };
}
