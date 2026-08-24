# Phase 0 Research: AI-First Personal Recipe Manager

**Feature**: `001-ai-recipe-manager` | **Date**: 2026-08-19

All technical unknowns from the specification are resolved here. Each entry records the decision, the rationale, and the alternatives considered. The user's technical direction fixed the stack (React/TS/Vite, Supabase, TanStack Query, Zod, pnpm, Vitest/RTL/Playwright); this document resolves only what the direction left open.

## R1. Initial AI provider

**Decision**: OpenAI, via its HTTP API (chat/responses with structured JSON-schema output), accessed only from Supabase Edge Functions. No official SDK dependency — plain `fetch` against the provider HTTP API inside a thin provider module.

**Rationale**:
- The constitution requires provider independence without an elaborate abstraction framework. An HTTP call behind an application-level provider interface gives isolation with the least code.
- OpenAI supports schema-constrained structured output, which directly serves the "AI output must match application-defined contracts" requirement (generateRecipe, proposeRecipeModification, extractRecipe fallback).
- BYOK users overwhelmingly already have or can trivially create an OpenAI key; base URL is configurable so OpenAI-compatible endpoints (e.g., local/proxied providers) work without code changes.

**Alternatives considered**:
- Anthropic: equally viable; not chosen only because one provider must be picked for v1. The provider boundary keeps adding it later a small, contained change.
- Vercel AI SDK / LangChain-style frameworks: rejected — adds a heavy dependency and leaks framework semantics across the domain, violating KISS and provider isolation.

**Provider boundary contract** (the only surface the app sees):

```text
AiProvider
  generateRecipe(request, credentials) -> GeneratedRecipeDraft (zod-validated)
  answerRecipeQuestion(recipe, history, question, credentials) -> string
  proposeRecipeModification(recipe, request, credentials) -> RecipeModificationProposal (zod-validated)
  extractRecipe(rawContent, credentials) -> GeneratedRecipeDraft (zod-validated)   // fallback path
  validateCredentials(credentials) -> ok | error
```

## R2. Deterministic web recipe extraction

**Decision**: Server-side Edge Function `import-url`: fetch the page → parse `<script type="application/ld+json">` blocks → find the `Recipe` node per schema.org (including `@graph` and array forms) → normalize into the recipe draft Zod schema. Pasted-text import (`import-text`) goes directly to the AI extraction fallback. If a URL page has no usable Recipe markup, fall back to AI extraction over sanitized page text.

**Rationale**: The vast majority of recipe sites publish schema.org Recipe JSON-LD (for SEO). Deterministic parsing is free, instant, testable without AI, and aligns with "prefer deterministic extraction before AI".

**Alternatives considered**:
- AI-first extraction for everything: rejected — slow, costs the user's API quota, non-deterministic, and unnecessary for the common case.
- Full HTML scraping heuristics (CSS selectors per site): rejected — unbounded maintenance for v1.

**Security requirements for fetch** (imported content is untrusted):
- URL allowlist of schemes (`https:` only; `http:` rejected or upgraded), DNS resolution with rejection of private/loopback/link-local ranges (SSRF protection).
- Response size cap (e.g., 2 MB), timeout (e.g., 10 s), redirect limit, `text/html` content-type check.
- HTML is parsed structurally, never rendered or executed; extracted strings are treated as data.
- Content sent to the AI fallback is wrapped as untrusted data with instructions that it may contain injected instructions (prompt-injection mitigation), and output still passes full schema + domain validation.

## R3. Quantity representation and serving scaling

**Decision**: Store ingredient quantity as an exact rational: `quantity_num` and `quantity_den` (integers, nullable pair) in PostgreSQL, mirroring a `Quantity = { num, den } | null` domain type. Scaling is exact rational arithmetic (`value * desiredServings / baseServings`, reduced). Display formatting converts to mixed-number Unicode fractions (½, ¼, ¾…) with a decimal fallback for awkward denominators. Quantity-less ingredients have NULL num/den and pass through scaling untouched.

**Rationale**: Exact fractions avoid floating-point drift (0.333… × 3), match how cooks think, and keep scaling deterministic and trivially testable. No external fraction library needed — the rational type plus `gcd` reduce is ~30 lines, well under the dependency-discipline threshold.

**Alternatives considered**:
- `numeric`/`float` column: rejected — rounding artifacts in both storage and display.
- Store display string only: rejected — makes deterministic scaling impossible, violating the spec.

## R4. Credential storage (BYOK)

**Decision**: Supabase Vault (`vault.secrets`) for the API key itself. The application table `ai_configurations` stores only non-secret metadata: provider id, base URL, model name, a Vault secret reference (opaque UUID/name), and status fields. All credential writes and all AI calls happen in Edge Functions; the key is never returned by any API, never logged, never sent to the browser.

**Rationale**: Vault is the Supabase-native encrypted secret store; it satisfies the constitution without introducing external infrastructure. Edge Functions can read Vault secrets via the service role inside the function only.

**Alternatives considered**:
- pgcrypto-encrypted column: workable but reinvents key management; Vault is the platform capability (constitution: prefer platform capabilities).
- Plaintext column with RLS: rejected outright.

**Flows**: create/update → Edge Function validates key with a cheap provider call → upserts Vault secret → writes metadata row. Delete → removes Vault secret + metadata row. Status check → Edge Function reports configured/valid without exposing the key.

## R5. Portable authentication and per-account ownership

**Decision (supersedes the 2026-08-19 single-owner decision)**: Supabase Auth protects the app without a mandatory email allowlist. Email/password is the provider-independent baseline so a local installation requires neither Supabase Cloud nor Google Cloud; Google OAuth remains optional per installation. All user-owned tables and Storage paths use `auth.uid()`-scoped RLS so multiple authenticated accounts in one installation remain fully isolated.

**Rationale**: The project must be reproducible on Supabase local, managed Cloud, and later self-hosted infrastructure without forcing an external OAuth provider or embedding an operator's identity in migrations. Per-account ownership preserves the personal-product model while allowing independent users and installations; collaboration, sharing, roles, and cross-user access remain out of scope.

**Alternatives considered**:
- Email/password with one seeded user: rejected — custom password management was explicitly excluded by the technical direction.
- Shared static password gate in frontend: rejected — not real security, no ownership identity for RLS.

## R6. Recipe history representation

**Decision**: `recipe_history` table storing full immutable JSONB snapshots (recipe + ingredients + steps + servings + tags), written by a single application-level "save recipe" path (all writes — manual edit, AI-applied proposal, saved serving adjustment — go through it). Restore = read snapshot → write as new current state → which itself creates a history entry. History rows are append-only per recipe and deleted with their recipe.

**Rationale**: Snapshot history is explicitly preferred in the direction; JSONB is the natural PostgreSQL representation; routing every save through one domain function makes the "every saved change creates an entry" rule structural rather than remembered.

**Alternatives considered**: event sourcing (explicitly excluded), row-level triggers (rejected — hides business rules in the database, harder to test; history creation is a domain rule).

## R7. Variant modeling

**Decision**: Variants are rows in the same `recipes` table with a nullable `source_recipe_id` self-reference. A variant is a full recipe in every respect (own ingredients, steps, history, conversation). On source deletion, variants' `source_recipe_id` is set NULL (they become standalone) via an explicit application flow behind a confirmation — enforced with `ON DELETE SET NULL` as the database backstop.

**Rationale**: "Variants remain normal recipes" from the direction; one table avoids duplicating the entire recipe machinery and keeps queries, RLS, and UI uniform.

## R8. Conversation and proposal modeling

**Decision**: `conversations` (1:1 with recipe, unique FK), `conversation_messages` (role user/assistant, ordered), and `modification_proposals` as a separate table linked to a conversation message and to the recipe's `head_version_id` at generation time. Proposal lifecycle states: `pending`, `applied`, `variant_created`, `discarded`, plus `stale` handling: apply is rejected when the recipe's current version no longer equals the proposal's base version — the UI offers regeneration from the current state.

**Rationale**: Proposals are domain objects with a lifecycle, not chat text — the direction requires them modeled separately. Version-pointer staleness check is the concrete mechanism for the spec's "recipe changed since proposal" edge case.

## R9. Shopping-list aggregation

**Decision**: Deterministic merge in domain logic: two items merge only when normalized ingredient name matches (trim/lowercase) AND units are equal after a small built-in synonym normalization (g/gram/grams). Merged quantities use exact rational addition. Everything else stays as separate lines. AI is never involved.

**Rationale**: Constitution forbids incorrect aggregation; a conservative exact-match rule is predictable, testable, and always user-correctable. Unit conversion (g↔kg, ml↔l) is deliberately out of v1 — mismatched units stay separate.

## R10. Search

**Decision**: PostgreSQL `ILIKE` over title/description plus exact tag filtering, executed through Supabase PostgREST from the client. Debounced client input; no indexes beyond the PKs and `user_id` initially.

**Rationale**: Personal-collection scale (hundreds of recipes) makes ILIKE effectively instant; anything more (tsvector, trigrams, external search) is speculative infrastructure the constitution excludes.

## R11. Recipe images

**Decision**: Private Supabase Storage bucket `recipe-images`, RLS-style storage policies scoped to the owner's path prefix (`{user_id}/{recipe_id}/{file}`). Client uploads directly to Storage with a signed flow; the recipe row stores only the object path. Validation client-side and via bucket constraints: JPEG/PNG/WebP, ≤ 5 MB. Display via short-lived signed URLs.

## R12. Edge Function set

**Decision**: Exactly five Edge Functions, each thin and Zod-validated at the boundary:

1. `ai-configure` — validate + store/delete BYOK credentials (Vault).
2. `ai-recipe-chat` — answerRecipeQuestion (and modification intent routing to propose).
3. `ai-propose-modification` — produce a validated modification proposal.
4. `ai-generate-recipe` — conversational recipe generation draft.
5. `import-recipe` — URL fetch + JSON-LD extraction, with AI fallback; also pasted-text extraction.

All ordinary CRUD (recipes, tags, history restore writes, shopping list, conversations read/write) goes directly from the client to Supabase with RLS — no custom REST layer.

**Rationale**: Functions exist only where secrets, untrusted remote fetches, or provider calls are involved; everything else uses the platform (constitution XXVII).

## R13. Shared contracts location

**Decision**: A single `packages/contracts` (workspace package, pure TypeScript + Zod) holding recipe/ingredient/step/draft/proposal/shopping-list schemas and derived types, imported by both the Vite app and the Edge Functions (Deno-compatible: no Node APIs, no build step). Supabase Edge Functions run on Deno; the contracts package is kept runtime-neutral so both toolchains consume the same source of truth (constitution XXIX).

## R14. Social media video recipe import (`yt-dlp`) — planned, pending approval

**Status**: Researched only. Not authorized for implementation — see the four open questions below and Phase 11.75 in `tasks.md`, which is explicitly gated on them.

**Problem**: Real recipe URLs users want to import increasingly point at Instagram Reels, TikTok videos, and YouTube Shorts, where the recipe lives in the caption/description or the spoken narration, not in fetchable page HTML. `import-recipe`'s current `safeFetchHtml` does a plain HTTPS `fetch` of the URL. Direct testing (curl, with and without a browser User-Agent) against a real Instagram Reel confirmed Instagram serves an empty JS-app-shell login wall (`<title>Instagram</title>`, no `og:description`, no caption text) to unauthenticated, non-browser requests — repeatedly and consistently from this environment. `sanitizeHtmlForAi` then hands the AI extractor nothing usable, producing a schema-validation failure. A short-term hotfix (Phase 11.5) now detects known social-media domains up front and returns a clear "unsupported, paste the caption instead" message rather than that confusing error; this entry researches what a *real* fix would require.

**How the rest of the open-source ecosystem solves this**: every real project that does this — [Mealie](https://github.com/mealie-recipes/mealie)'s own merged "social media video import" feature, and third-party tools [social-to-mealie](https://github.com/GerardPolloRebozado/social-to-mealie), [pick-a-recipe](https://github.com/pickeld/pick-a-recipe), [instagram-to-tandoor](https://github.com/doen1el/instagram-to-tandoor), and [recipe-extractor](https://github.com/sleeper/recipe-extractor) — uses **`yt-dlp`** (or, in one case, a full headless-browser session) instead of a plain HTTP fetch, because it talks to each platform's internal/mobile API rather than the public web page. None of them do what our code currently does.

**Decision (recommended, pending explicit approval)**: if built, follow the same `yt-dlp`-based approach:

1. `yt-dlp --dump-json --skip-download <url>` returns title/description/uploader without downloading video — covers the common case where the recipe is fully in the caption. Feeds straight into the existing, unmodified `extractRecipe` AI pipeline.
2. When the caption alone has no usable recipe (narration-only videos), fall back to `yt-dlp -x --audio-format mp3` (shells out to `ffmpeg`) to extract audio, then transcribe it with OpenAI's Whisper endpoint using the user's own already-configured BYOK credentials (no separately hosted Whisper needed) — mirroring Mealie's own pipeline (captions/subtitles first, else audio → Whisper → LLM structuring).

**Per-platform reliability, verified via direct research (August 2026)**:

- **YouTube (incl. Shorts)**: works without login for most public videos; occasionally blocked with "Sign in to confirm you're not a bot," especially from datacenter/cloud IPs — exactly what a hosted microservice would use.
- **TikTok**: works without login for public videos in the common case; datacenter-IP blocking is a known, recurring `yt-dlp` issue that sometimes needs a residential proxy or cookies.
- **Instagram**: since mid-2023, nearly all content sits behind a login wall — **cookies from an authenticated Instagram session are required in practice, not optional** — and open `yt-dlp` issues report extraction still intermittently fails ("Instagram sent an empty media response") even with valid cookies. This matches what we observed directly with our own plain fetch: the same URL sometimes returned the login shell and sometimes (from a different request context) apparently returned enough content for AI extraction to succeed — Instagram's bot-detection response is not deterministic per URL, it depends on the requesting context each time.

**Critical architecture constraint**: `yt-dlp` and `ffmpeg` are external binaries requiring subprocess execution. **Supabase Edge Functions run on Deno Deploy, which does not allow spawning subprocesses** (confirmed directly — a hard platform limitation, not a configuration gap). The extraction step for this feature therefore **cannot live inside the existing `supabase/functions/import-recipe` Edge Function** and requires a new backend component entirely outside Supabase — the first departure from this project's "Supabase + independently hosted static frontend, nothing else" architecture (plan.md Constraints: "Zero/near-zero hosting cost").

**Proposed shape if approved**: a small, version-pinned HTTP microservice (Node or Python, `yt-dlp` + `ffmpeg` installed) on a container host (Fly.io/Render/Cloud Run — free/near-free tiers exist but are not zero-cost or zero-maintenance the way the rest of this stack is). `import-recipe` calls it over HTTPS with a shared secret for recognized video-platform domains, gets back `{ title, description, transcript? }`, and feeds that into the existing `extractRecipe` pipeline unchanged. No `RecipeDraft` schema change is needed — only a new `extractionMethod` value (e.g. `'video_transcript'`) alongside the existing `'structured_markup'` / `'ai'`.

**Alternatives considered**:
- **Headless browser (Selenium/Playwright)**, as `instagram-to-tandoor` does: heavier runtime than `yt-dlp`, same Instagram login-wall problem (still needs an authenticated session), and doesn't solve narration-only recipes without also transcribing audio. Rejected as strictly worse than `yt-dlp` here.
- **Third-party paid scraping APIs** (RapidAPI-style Instagram/TikTok scrapers): recurring per-call cost, another vendor dependency, no meaningfully better reliability against Instagram's login wall than `yt-dlp` with cookies. Rejected — conflicts with the project's zero/near-zero-cost and minimal-dependency principles.
- **Keep only the existing "Paste text" fallback**: zero engineering/hosting/ToS cost, already shipped today. Remains the interim recommendation until the open questions below are resolved.

**Known risks/costs surfaced for the approval decision (deliberately not resolved by this research)**:
1. **Instagram requires the user's own session cookies to work reliably.** Storing another platform's session cookie is a materially bigger trust/security surface than the existing OpenAI API key BYOK model — a leaked Instagram cookie lets an attacker act as that Instagram account, not just call one API — and using it this way may itself sit against Instagram's Terms of Service independent of `yt-dlp`'s own legality.
2. **A new hosting component contradicts the current "zero/near-zero hosting cost" constraint** (plan.md) and the "Supabase + static frontend, nothing else" architecture — a real, not cosmetic, deviation requiring conscious approval.
3. **Extractor maintenance burden**: `yt-dlp` ships near-daily updates chasing platform changes; a stale pinned version degrades silently over time. This project has not had an "external dependency needs regular manual updates to keep working" commitment before.
4. **The reliability ceiling is inherently partial, even with the best available tool.** Mealie's own merged-feature discussion has an open user report that Instagram extraction fails even with `yt-dlp` and cookies — "often works, sometimes doesn't" is the realistic ceiling, not a bug to eliminate.
5. **License/legal**: `yt-dlp` itself is Unlicense (public domain) and safe to depend on; the legal exposure is around each platform's scraping ToS and downloaded-content copyright, not the tool's license. Extracting only caption text / a short spoken recipe for personal use (not redistributing video) is materially lower-risk than bulk video downloading, but is not zero-risk and should be disclosed to users.

## Unresolved decisions requiring user input

None blocking current-phase work. The technical direction fixed the stack and explicitly authorized the plan to select the initial provider (R1: OpenAI). The discretionary technical choices are R1 (provider), R3 (rational quantities), and the superseding R5 portable Auth model. Local/managed parity is verified before Phase 9; permanent production self-hosting is intentionally deferred until after feature completion.

**Non-blocking, deferred to Phase 11.75 (R14) — must be answered before that phase's implementation tasks start**:
1. Is TikTok + YouTube Shorts support (no cookies needed in the common case) acceptable as this phase's v1 scope on its own, deferring Instagram (which needs cookie custody) to a later, separately approved iteration?
2. If Instagram is in scope, is the user willing to accept the account-session-cookie custody/security model, and where would those cookies be stored (Vault, like the OpenAI key) with what expiry/rotation UX?
3. What hosting target and budget is acceptable for the new external microservice, given it is a genuine new cost/ops surface beyond the rest of this stack?
4. Is audio transcription via Whisper (extra OpenAI API cost per import, on the user's own BYOK key) an acceptable default, or should it require explicit per-import opt-in given the added latency/cost?
