# Contracts: Shared Schemas and Edge Function APIs

**Feature**: `001-ai-recipe-manager` | **Date**: 2026-08-19

Two contract layers, one source of truth:

1. **Domain contracts** (`packages/contracts`, Zod) — shared verbatim by the Vite client and Deno Edge Functions. Every AI output, import draft, and cross-boundary payload validates against these.
2. **Edge Function APIs** — the only server-controlled surface. Everything else is direct Supabase PostgREST/Storage access under RLS.

## 1. Domain contracts (packages/contracts)

All schemas are Zod; TypeScript types are inferred, never hand-duplicated.

### Core recipe

```text
Quantity        = { num: int > 0, den: int > 0 }            // exact rational; reduced
Ingredient      = { name: 1..300, quantity: Quantity | null, unit: string | null }
Step            = { text: 1..5000 }                          // ordering by array index
RecipeDraft     = {                                          // creation/import/generation review
                    title: 1..300,
                    description: string | null,
                    servings: int >= 1,
                    prepTimeMinutes: int >= 0 | null,
                    cookTimeMinutes: int >= 0 | null,
                    sourceName: string | null,
                    sourceUrl: url | null,
                    ingredients: Ingredient[] (min 1),
                    steps: Step[] (min 1),
                    tags: string[]
                  }
RecipeSnapshot  = RecipeDraft + { imagePath }                // history snapshot payload
```

### Modification proposal

Structured operations, not rewritten blobs. The proposal carries the full resulting recipe (so review/diff is trivial) plus the operation list (so the UI can summarize changes).

```text
ModificationOp  = addIngredient    { ingredient: Ingredient, afterPosition?: int }
                | removeIngredient { position: int }
                | updateIngredient { position: int, patch: Partial<Ingredient> }
                | addStep          { step: Step, afterPosition?: int }
                | removeStep       { position: int }
                | updateStep       { position: int, text }
                | reorderSteps     { order: int[] }
                | setServings      { servings: int >= 1 }
                | setTitle         { title }
                | setDescription   { description }
                | setTimes         { prepTimeMinutes?, cookTimeMinutes? }

ModificationProposal = {
  summary: string,                    // human-readable, shown in review UI
  operations: ModificationOp[] (min 1),
  resultingRecipe: RecipeDraft        // must equal base recipe + operations; domain-validated
}
```

Domain validation (beyond schema): `resultingRecipe` must be derivable by applying `operations` to the base recipe — deterministic re-application check in the Edge Function; mismatch = provider error, graceful retry. This is the coherence guarantee behind FR-019.

### AI answers and generation

```text
RecipeAnswer    = { kind: 'answer', content: string }
ChatOutcome     = RecipeAnswer | { kind: 'proposal', proposal: ModificationProposal }
GeneratedRecipe = RecipeDraft          // same contract as manual/import — FR-022
```

## 2. Edge Function APIs

All functions: `POST`, Supabase JWT required (`verify_jwt`), request/response bodies Zod-validated both sides, errors returned as `{ error: { code, message } }` with safe messages only — never stack traces, never credentials, never provider payloads verbatim. Rate/cost control: AI functions are explicit user actions; no background AI calls exist.

### `ai-configure`

Manages BYOK credentials. The only function that ever touches the raw key.

```text
POST /ai-configure
  { action: 'upsert', provider: 'openai', apiKey: string, model: string, baseUrl?: string }
    -> validateCredentials() against provider -> store key in Vault -> write ai_configurations
    -> 200 { status: 'valid' } | 422 { error: { code: 'invalid_credentials' } }
  { action: 'remove' }
    -> delete Vault secret + metadata row -> 200 { status: 'unconfigured' }
  { action: 'status' }
    -> 200 { configured: bool, provider?, model?, baseUrl?, status }   // NEVER returns apiKey
```

### `ai-recipe-chat`

Per-recipe conversation turn.

```text
POST /ai-recipe-chat
  { recipeId: uuid, message: string (1..4000) }
  Server: load recipe + recent messages (last ~20) -> provider.answerRecipeQuestion
          or, when intent is modification, delegate to ai-propose-modification logic
  -> 200 ChatOutcome (answer text, or validated proposal + persisted proposal row + assistant message)
  -> 409 { error: { code: 'ai_not_configured' } } | 502 { error: { code: 'provider_error' } }
     | 422 { error: { code: 'invalid_ai_output' } }
```

### `ai-propose-modification`

Explicit modification request (also used for regeneration after staleness).

```text
POST /ai-propose-modification
  { recipeId: uuid, request: string (1..4000) }
  Server: snapshot recipe at head_version -> provider.proposeRecipeModification
          -> schema validation -> domain re-application check -> persist proposal
             (base_version = head_version) + assistant message
  -> 200 { proposalId, proposal: ModificationProposal }
  -> same error envelope as ai-recipe-chat
```

Apply / save-as-variant / discard are **not** Edge Functions — they are direct Supabase writes under RLS through the domain save path:
- apply: verify `base_version = head_version` (else 409-stale → UI offers regenerate), write resulting recipe, history entry `ai_applied`, proposal status `applied`.
- variant: insert new recipe with `source_recipe_id`, proposal status `variant_created`.
- discard: proposal status `discarded`.

### `ai-generate-recipe`

Conversational generation, pre-save (conversation kind = 'generation', recipe_id NULL).

```text
POST /ai-generate-recipe
  { conversationId?: uuid, message: string (1..4000) }
  -> 200 { conversationId, outcome: { kind: 'clarify', question } | { kind: 'draft', draft: GeneratedRecipe } }
  -> same error envelope
```

Saving the draft is an ordinary client insert of `RecipeDraft` under RLS — no function needed.

### `import-recipe`

```text
POST /import-recipe
  { mode: 'url',  url: string }       -> fetch (SSRF-guarded, 2MB cap, 10s timeout)
                                        -> JSON-LD Recipe extraction -> normalize
                                        -> if no usable markup: AI fallback over sanitized text
  { mode: 'text', text: string (1..50000) } -> AI extraction
  -> 200 { draft: RecipeDraft, extractionMethod: 'structured_markup' | 'ai' }
  -> 422 { error: { code: 'no_recipe_found' | 'unsupported_url' | 'fetch_failed' } }
```

The draft is returned to the client for the review screen; persistence happens only via the normal user-confirmed save path (FR-007).

## 3. Direct-to-Supabase surface (no functions)

Under RLS, the client performs all CRUD for: recipes + ingredients + steps + tags, history reads and restore writes, conversations/messages reads and user-message inserts, proposal status transitions, shopping list items, image upload/download on the private `recipe-images` bucket (path `{user_id}/{recipe_id}/{filename}`, JPEG/PNG/WebP ≤ 5 MB, signed URLs for display), and search via PostgREST filters (`ilike` on title/description, tag joins).
