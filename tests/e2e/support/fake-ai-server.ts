import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Minimal recipe draft shape accepted by the fake provider. Kept structurally
 * compatible with `RecipeDraft` from `@opendish/contracts` without importing
 * it, so this file has zero dependency on the app build graph.
 */
export interface FakeRecipeDraft {
  title: string
  description: string | null
  servings: number
  prepTimeMinutes: number | null
  cookTimeMinutes: number | null
  sourceName: string | null
  sourceUrl: string | null
  ingredients: Array<{
    name: string
    quantity: { num: number; den: number } | null
    unit: string | null
  }>
  steps: Array<{ text: string }>
  tags: string[]
}

export interface FakeAiServerHandle {
  /**
   * Candidate OpenAI-compatible base URLs for this server, ordered by
   * likeliness to be reachable from the Supabase Edge Functions runtime
   * (which runs inside Docker, not on the test host). The local smoke suite
   * (`scripts/local/lib.mjs`) uses the same candidate strategy.
   */
  baseUrlCandidates: string[]
  close: () => Promise<void>
}

interface ChatCompletionRequestBody {
  response_format?: { json_schema?: { name?: string } }
  messages?: Array<{ role?: string; content?: unknown }>
}

function extractEmbeddedJson(
  messages: ChatCompletionRequestBody['messages'],
  marker: string,
): Record<string, unknown> | null {
  if (!Array.isArray(messages)) return null
  for (const message of messages) {
    const content = message?.content
    if (typeof content !== 'string') continue
    const markerIndex = content.indexOf(marker)
    if (markerIndex === -1) continue
    // Search only from the marker onward: the prompt's own injection-
    // mitigation note mentions the literal string "<untrusted>" earlier in
    // the same message, so an unanchored regex would match that mention
    // instead of the real embedded block that follows the marker.
    const match = /<untrusted>([\s\S]*?)<\/untrusted>/.exec(
      content.slice(markerIndex),
    )
    if (!match) continue
    try {
      return JSON.parse(match[1]) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

async function readJsonBody(
  request: http.IncomingMessage,
): Promise<ChatCompletionRequestBody> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as ChatCompletionRequestBody) : {}
}

function respondJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

/**
 * Starts a local, ephemeral, OpenAI-compatible HTTP stub that the
 * `openai-provider` Edge Function code talks to when a test configures AI
 * with this server's base URL. It never makes a live AI call — content is
 * generated deterministically from the request's declared JSON schema name,
 * mirroring `scripts/local/lib.mjs`'s `createFakeAiServer`.
 *
 * For `modification_proposal` requests specifically, the response is derived
 * from the actual base recipe embedded in the prompt (a `setServings`
 * bump) so it always passes the Edge Function's deterministic coherence
 * check (`validateModificationProposal` in
 * `supabase/functions/_shared/recipe-modification.ts`, which re-applies the
 * operations to the real recipe and requires an exact match) regardless of
 * which recipe a given test created — a fixed/hardcoded proposal fixture
 * would only satisfy that check for one exact recipe shape.
 */
export async function startFakeAiServer(
  recipeDraftFixture: FakeRecipeDraft,
): Promise<FakeAiServerHandle> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/v1/models') {
        respondJson(response, 200, { data: [{ id: 'e2e-fake-model' }] })
        return
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readJsonBody(request)
        const schemaName = body.response_format?.json_schema?.name
        let content =
          'This is a helpful answer from the local end-to-end fake AI provider.'

        if (schemaName === 'generate_recipe_outcome') {
          content = JSON.stringify({
            kind: 'draft',
            draft: recipeDraftFixture,
          })
        } else if (schemaName === 'recipe_draft') {
          content = JSON.stringify(recipeDraftFixture)
        } else if (schemaName === 'modification_proposal') {
          const base = extractEmbeddedJson(
            body.messages,
            'base recipe as JSON',
          )
          if (base && typeof base.servings === 'number') {
            delete base.imagePath
            const servings = (base.servings as number) + 1
            content = JSON.stringify({

              summary: `Increase servings from ${base.servings} to ${servings}.`,
              operations: [{ kind: 'setServings', servings }],
              resultingRecipe: { ...base, servings },
            })
          }
        }

        respondJson(response, 200, { choices: [{ message: { content } }] })
        return
      }

      respondJson(response, 404, { error: 'not_found' })
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '0.0.0.0', () => resolve())
    server.once('error', reject)
  })

  const { port } = server.address() as AddressInfo

  return {
    baseUrlCandidates: [
      `http://host.docker.internal:${port}/v1`,
      `http://127.0.0.1:${port}/v1`,
      `http://172.17.0.1:${port}/v1`,
    ],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
