---

description: "Task list for 001-ai-recipe-manager"

---

# Tasks: AI-First Personal Recipe Manager

**Input**: Design documents from `/specs/001-ai-recipe-manager/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md

**Tests**: Included — the plan and constitution mandate them (testing priority: domain rules, transformations, AI-output validation, security, persistence, critical flows). Write story tests FIRST and watch them fail before implementing.

**Organization**: Tasks are grouped by user story (US1–US8 from spec.md) so each story is independently implementable and testable. Approved decisions baked in: OpenAI-only v1 provider behind `AiProvider`, rational `num`/`den` quantities, authenticated per-user ownership enforced by RLS, email/password as the provider-independent baseline with optional Google OAuth, snapshot history, same-table variants with SET NULL detach, conservative list merging, JSON-LD-first import, and one portable codebase for Supabase local, managed Cloud, and advanced self-hosted installations.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US8)
- Paths follow plan.md: `apps/web/`, `packages/contracts/`, `supabase/`, `tests/e2e/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [ ] T001 Create pnpm workspace with `apps/web`, `packages/contracts`, `supabase/`, `tests/e2e` per plan.md structure in `pnpm-workspace.yaml` and root `package.json`
- [ ] T002 Scaffold Vite + React 18 + TypeScript strict app in `apps/web` with React Router
- [ ] T003 [P] Configure Tailwind CSS and shadcn/ui in `apps/web` (`tailwind.config.ts`, `src/components/ui/`)
- [ ] T004 [P] Configure ESLint + Prettier + strict `tsconfig` across workspace; add root scripts `dev`, `build`, `lint`, `format`, `typecheck`, `test`, `test:e2e`
- [ ] T005 [P] Initialize Supabase project (`supabase init`), local config for Auth/Storage/Functions/Vault
- [ ] T006 [P] Create `.env.example` documenting `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, optional OAuth configuration, and Edge Function secrets (no real values)
- [ ] T007 [P] Configure Vitest + React Testing Library in `apps/web` and `packages/contracts` with jsdom setup
- [ ] T008 [P] Configure Playwright in `tests/e2e` with local Supabase + dev-server bootstrap

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contracts, schema, auth, domain core, and server trust boundaries that EVERY story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Contracts package

- [ ] T009 [P] Implement `Quantity`, `Ingredient`, `Step`, `RecipeDraft`, `RecipeSnapshot` Zod schemas + inferred types in `packages/contracts/src/recipe.ts`
- [ ] T010 [P] Implement `ModificationOp` (all 11 op kinds), `ModificationProposal` Zod schemas in `packages/contracts/src/modification.ts`
- [ ] T011 [P] Implement conversation message and `ChatOutcome` schemas in `packages/contracts/src/conversation.ts`, and shopping-list item schema in `packages/contracts/src/shopping-list.ts`
- [ ] T012 Implement `AiProvider` interface (generateRecipe, answerRecipeQuestion, proposeRecipeModification, extractRecipe, validateCredentials) + provider error types in `packages/contracts/src/ai-provider.ts` (depends on T009–T011)

### Database (versioned migrations, RLS mandatory)

- [ ] T013 Migration: `recipes`, `recipe_ingredients` (rational num/den CHECKs), `recipe_steps`, `tags`, `recipe_tags` with constraints + RLS policies in `supabase/migrations/`
- [ ] T014 [P] Migration: `recipe_history` (JSONB snapshot, change_kind CHECK, unique recipe+version) with RLS in `supabase/migrations/`
- [ ] T015 [P] Migration: `conversations`, `conversation_messages`, `modification_proposals` (status CHECK, base_version) with RLS in `supabase/migrations/`
- [ ] T016 [P] Migration: `shopping_list_items` and `ai_configurations` (metadata only, `vault_secret_name`) with RLS in `supabase/migrations/`
- [ ] T017 [P] Migration: private `recipe-images` storage bucket + owner-scoped storage policies (`{user_id}/{recipe_id}/...`, JPEG/PNG/WebP ≤ 5 MB)

### Auth and app shell

- [ ] T018 Implement Supabase Auth session handling and auth guard in `apps/web/src/features/auth/`; email/password is the provider-independent baseline and Google OAuth is an optional installation-level provider, with every authenticated account isolated by RLS and no built-in email allowlist
- [ ] T019 Implement app shell in `apps/web/src/app/`: router, TanStack Query provider, primary navigation (recipes, create/import, AI create, shopping list, settings), responsive layout, intentional loading/empty/error primitives
- [ ] T020 [P] Create typed Supabase client + signed-URL image helper in `apps/web/src/lib/`

### Domain core (framework-free, unit-tested)

- [ ] T021 [P] Implement rational arithmetic + fraction display formatting (mixed numbers, Unicode ½/¼/¾, decimal fallback) in `apps/web/src/domain/rational.ts` with unit tests
- [ ] T022 Implement serving scaling (exact rational scaling, quantity-less pass-through) in `apps/web/src/domain/scaling.ts` with unit tests (depends on T021)
- [ ] T023 Implement conservative shopping-list merge (normalized name + equal-unit only, rational addition) in `apps/web/src/domain/shopping.ts` with unit tests (depends on T021)
- [ ] T024 Implement the single recipe save path — validation, `head_version` increment, previous-state snapshot to `recipe_history` with `change_kind` — in `apps/web/src/domain/recipe-save.ts` with integration tests against local Supabase

### Server trust boundary (Edge Functions shared layer)

- [ ] T025 Implement `_shared` request/response helpers: JWT verification, Zod body validation, safe error envelope (no stack traces/credentials) in `supabase/functions/_shared/http.ts`
- [ ] T026 Implement OpenAI provider over plain `fetch` (structured JSON-schema output, configurable base URL, credential lookup from Vault) in `supabase/functions/_shared/openai-provider.ts` implementing the `AiProvider` contract (depends on T012)
- [ ] T027 Implement deterministic fake `AiProvider` test double in `packages/contracts` test utilities (used by all automated tests; zero live AI calls)
- [ ] T028 Implement `ai-configure` Edge Function (upsert: validate key → Vault store → metadata row; remove; status — key never returned) in `supabase/functions/ai-configure/` with tests
- [ ] T029 Implement SSRF-safe fetch (https-only, private-range DNS rejection, 2 MB cap, 10 s timeout, redirect limit) in `supabase/functions/_shared/safe-fetch.ts` with unit tests
- [ ] T030 Implement schema.org JSON-LD Recipe extractor + normalizer to `RecipeDraft` in `supabase/functions/_shared/jsonld-recipe.ts` with fixture tests (depends on T009)

**Checkpoint**: Contracts compile, migrations apply clean (`supabase db reset`), login works, domain core tests green, `ai-configure` verified against local Vault — user story implementation can now begin

---

## Phase 3: User Story 1 — Create and Manage Recipes Manually (Priority: P1) 🎯 MVP

**Goal**: Full manual recipe lifecycle: create with review, browse, search, tag, favorite, edit, duplicate, delete (with confirmation)

**Independent Test**: AI unconfigured — create, save, search, open, edit, duplicate, delete; all persisted across reloads

### Tests for User Story 1

- [ ] T031 [P] [US1] Integration test: recipe CRUD round-trip via save path incl. validation failures in `apps/web/src/features/recipes/__tests__/`
- [ ] T032 [P] [US1] Integration test: search (ILIKE title/description) + tag filtering + favorites in `apps/web/src/features/recipes/__tests__/`
- [ ] T033 [P] [US1] RLS test: second test user can read/write nothing in `supabase/tests/`

### Implementation for User Story 1

- [ ] T034 [US1] Implement recipe list page: cards, empty state, favorite toggle, tag chips, debounced search, tag filter in `apps/web/src/features/recipes/`
- [ ] T035 [US1] Implement recipe editor form (React Hook Form + Zod `RecipeDraft`): title, description, servings, times, dynamic ingredient rows (name/quantity/unit), dynamic ordered steps, tags, source fields, image upload to private bucket in `apps/web/src/features/recipe-editor/`
- [ ] T036 [US1] Wire create/edit through the domain save path (T024) with TanStack Query mutations + cache invalidation in `apps/web/src/features/recipe-editor/`
- [ ] T037 [US1] Implement duplicate (title suffix " (copy)") and delete-with-confirmation flows in `apps/web/src/features/recipes/`
- [ ] T038 [US1] Implement recipe detail view page (title, servings, ingredients, steps, times, source, image via signed URL) in `apps/web/src/features/recipes/` — read path for all later stories

**Checkpoint**: US1 fully functional and testable independently — manual recipe management works end to end

---

## Phase 4: User Story 2 — Import a Recipe With Mandatory Review (Priority: P1)

**Goal**: Import from URL (JSON-LD first, AI fallback) or pasted text (AI), always into an editable review screen; nothing persists before explicit save; source preserved; graceful failure with manual fallback

**Independent Test**: Paste text / import URL with fake provider → structured draft → correct one ingredient + one step → save → verify corrections and source stored

### Tests for User Story 2

- [ ] T039 [P] [US2] Contract test: `import-recipe` function — JSON-LD success, AI fallback, `no_recipe_found`, SSRF rejection cases in `supabase/functions/import-recipe/` tests (fake provider, recorded fixtures)
- [ ] T040 [P] [US2] Component test: review screen renders draft, edits apply, discard persists nothing in `apps/web/src/features/recipe-import/__tests__/`

### Implementation for User Story 2

- [ ] T041 [US2] Implement `import-recipe` Edge Function (`mode: 'url'` via safe-fetch + JSON-LD with AI fallback; `mode: 'text'` via AI extraction; both Zod-validated) in `supabase/functions/import-recipe/` (depends on T026, T029, T030)
- [ ] T042 [US2] Implement import UI: URL/paste input, extraction loading state, failure message with manual-entry fallback in `apps/web/src/features/recipe-import/`
- [ ] T043 [US2] Implement import review screen reusing the recipe editor (T035) pre-filled with the draft + `extractionMethod` indicator; save goes through the domain save path with `origin: 'imported'` and source fields in `apps/web/src/features/recipe-import/`

**Checkpoint**: US1 AND US2 both work independently — recipes can be acquired manually or via reviewed import

---

## Phase 5: User Story 3 — View a Recipe and Adjust Servings (Priority: P1)

**Goal**: Cooking-focused recipe view with temporary serving scaling (exact, fraction-rendered, non-destructive) and explicit savable adjustment

**Independent Test**: 4-serving recipe → view at 2 (halved, fractions) → leave → still 4 saved → explicitly save 6 → persisted + history entry

### Tests for User Story 3

- [x] T044 [P] [US3] Unit tests already exist via T021/T022 — add integration test: temporary vs. saved adjustment persistence + `serving_adjustment` history entry in `apps/web/src/features/recipes/__tests__/`
- [x] T045 [P] [US3] Component test: scaling display incl. quantity-less ingredients unchanged, fraction rendering in `apps/web/src/features/recipes/__tests__/`

### Implementation for User Story 3

- [x] T046 [US3] Implement servings scaler control on recipe view: local-state displayed servings, scaled quantities via domain scaling, fraction formatting in `apps/web/src/features/recipes/`
- [x] T047 [US3] Implement explicit "save adjustment" action: scales stored quantities to new servings through the domain save path with `change_kind: 'serving_adjustment'`, plus validation rejecting non-positive/absurd servings in `apps/web/src/features/recipes/`
- [x] T048 [US3] Polish recipe view states: missing optional fields render clean, loading/error states, mobile-first cooking layout in `apps/web/src/features/recipes/`

**Checkpoint**: All three P1 stories work — the app is a viable AI-less recipe manager

---

## Phase 6: User Story 4 — Per-Recipe Conversation With Reviewed AI Modifications (Priority: P2)

**Goal**: One persistent conversation per recipe; informational answers; structured modification proposals with comparison review; apply / save-as-variant / discard; staleness protection; coherence validation

**Independent Test**: Fake provider — ask question (recipe unchanged) → request modification → review diff → discard one, apply another → verify only applied change persisted + history entry

### Tests for User Story 4

- [x] T049 [P] [US4] Contract test: `ai-recipe-chat` + `ai-propose-modification` — answer vs. proposal outcomes, schema-invalid AI output rejected, domain re-application mismatch rejected, error envelope safety in `supabase/functions/` tests (fake provider)
- [x] T050 [P] [US4] Integration test: proposal lifecycle (pending → applied/variant_created/discarded), stale `base_version` apply rejected, apply writes `ai_applied` history in `apps/web/src/features/modification-review/__tests__/`
- [x] T051 [P] [US4] Component test: comparison/diff review renders operations summary + resulting recipe in `apps/web/src/features/modification-review/__tests__/`

### Implementation for User Story 4

- [x] T052 [US4] Implement `ai-propose-modification` Edge Function: snapshot at `head_version`, provider call, two-level validation (schema + deterministic op re-application coherence check), persist proposal + assistant message in `supabase/functions/ai-propose-modification/` (depends on T026)
- [x] T053 [US4] Implement `ai-recipe-chat` Edge Function: create the recipe's conversation row on first message (insert guarded by the unique `recipe_id`, so exactly one thread ever exists per FR-014), load recipe + recent ~20 messages, answer questions or route modification intent to proposal logic, persist messages in `supabase/functions/ai-recipe-chat/` (depends on T052)
- [x] T054 [US4] Implement conversation UI bound to recipe (message list, input, loading/cancellable states, AI-unavailable state, submit disabled while a request is in flight — no double-submission) in `apps/web/src/features/recipe-conversation/`
- [x] T055 [US4] Implement modification review UI: operations summary + current-vs-resulting comparison, apply / save-as-variant / discard actions in `apps/web/src/features/modification-review/`
- [x] T056 [US4] Implement apply path: `base_version = head_version` guard (stale → regenerate offer), single in-flight apply (action disabled while pending — no duplicate application), write resulting recipe via domain save path (`ai_applied`), proposal status transitions in `apps/web/src/features/modification-review/`
- [x] T057 [US4] Implement save-as-variant path: new recipe with `source_recipe_id`, status `variant_created`, navigation to the variant in `apps/web/src/features/modification-review/`
- [x] T082 [US4] Visually distinguish AI-generated content from saved user data in the conversation and review UIs (AI message styling, proposal marked as unapplied suggestion until user action) per FR-035 in `apps/web/src/features/recipe-conversation/` + `apps/web/src/features/modification-review/`

**Checkpoint**: US4 independently functional — the defining conversational flow works with full user control

---

## Phase 7: User Story 5 — Generate a Recipe Through Conversation (Priority: P2)

**Goal**: Conversational recipe creation (clarify when needed) → structured draft → review/edit → save → behaves like any recipe

**Independent Test**: Fake provider — request recipe → draft → edit one field → save → use it in view/scale/chat/shopping

### Tests for User Story 5

- [ ] T058 [P] [US5] Contract test: `ai-generate-recipe` — clarify vs. draft outcomes, invalid output rejected, generation conversation persistence in `supabase/functions/ai-generate-recipe/` tests
- [ ] T059 [P] [US5] Component test: generation review edit-then-save in `apps/web/src/features/recipe-import/__tests__/` (shared review screen)

### Implementation for User Story 5

- [ ] T060 [US5] Implement `ai-generate-recipe` Edge Function: generation conversation (kind `generation`, recipe_id NULL), clarifying-question vs. draft outcomes, Zod validation in `supabase/functions/ai-generate-recipe/` (depends on T026)
- [ ] T061 [US5] Implement AI-create UI: conversation screen, draft handoff to the shared review screen (T043) with `origin: 'ai_generated'`, discard in `apps/web/src/features/recipe-conversation/` + `apps/web/src/app/` nav entry
- [ ] T081 [US5] Label AI-generated estimates (timing, nutrition-like values) as estimates — never as guaranteed facts — in the generation review screen per FR-035 / US5 scenario 7 in `apps/web/src/features/recipe-import/` (shared review screen)

**Checkpoint**: Both critical success flows (SC-001, SC-002) now completable

---

## Phase 8: User Story 6 — Shopping List From Recipes (Priority: P2)

**Goal**: Single global list; add recipe at chosen servings; conservative deterministic grouping; manual entries, edit, delete, purchased flags; items survive recipe deletion

**Independent Test**: AI-less — add two recipes at chosen servings → correct quantities/merges → edit, add manual, purchase, delete → persisted across reloads

### Tests for User Story 6

- [ ] T062 [P] [US6] Integration test: add-recipe-at-servings writes scaled items, merge behavior (equal units merge, mismatched stay separate, quantity-less entries intact) in `apps/web/src/features/shopping-list/__tests__/`
- [ ] T063 [P] [US6] Integration test: item CRUD + purchased toggle + provenance survives source recipe deletion in `apps/web/src/features/shopping-list/__tests__/`

### Implementation for User Story 6

- [ ] T064 [US6] Implement add-to-list flow from recipe view: servings chooser, domain scaling, conservative merge into list in `apps/web/src/features/shopping-list/`
- [ ] T065 [US6] Implement shopping list page: grouped/displayed items, manual add, inline edit, delete, purchased toggle with visual distinction, empty state in `apps/web/src/features/shopping-list/`

**Checkpoint**: Primary end-to-end flow (SC-001) complete: recipe → AI mod → servings → shopping list

---

## Phase 8.5: Portable Foundation (Blocking Before Phase 9)

**Purpose**: Stabilize one backend contract and one frontend build across Supabase local and managed Cloud before the remaining features add more schema, Auth, Vault, and deployment dependencies. This phase deliberately does **not** build production self-hosting.

**⚠️ CRITICAL**: Phase 9 and all later phases are blocked until a fresh local installation and the managed Cloud reference backend pass the same portability checks.

### Migration, Auth, and Vault baseline

- [x] T083 Replace the unreleased create-then-drop single-owner allowlist migration sequence with a clean baseline that contains no `app_settings`, `assert_allowed_email`, Auth hook, placeholder owner email, or other mandatory single-owner state; rebuild the disposable local database from the full migration chain and verify migration history
- [x] T084 Implement provider-independent email/password sign-up/sign-in UX and revise owner-only copy in `apps/web/src/features/auth/`; retain Google OAuth as an optional provider that appears only when the installation enables it, and cover normal/loading/error/session-expiry states
- [x] T085 Make the BYOK Vault adapter portable across supported Supabase environments: declare/verify the Vault dependency, replace the unavailable `vault.delete_secret` call with a supported deletion path, and integration-test create/read/replace/remove without exposing secret values
- [x] T086 Make Data API access deterministic for new Cloud projects and local/self-hosted stacks: explicitly verify required schema/table grants separately from RLS, keep RLS enabled on every exposed table, and add a regression test for authenticated access plus anonymous denial

### Reproducible local and Cloud profiles

- [x] T087 Add project scripts for a reproducible local profile (`setup:local`, `dev:local`, and `verify:local` or equivalent): check Docker, start Supabase, apply migrations, obtain the local URL/publishable key without printing privileged keys, create the ignored `apps/web/.env.local`, and report the app/Studio/Mailpit URLs
- [x] T088 Add a fresh-install local smoke suite covering Auth without Google, migrations, Storage, Vault, and all Edge Functions; it MUST run without a Supabase Cloud account or live AI call
- [x] T089 Extend RLS integration coverage to two authenticated users across recipes, history, tags, conversations, proposals, shopping-list items, AI configuration metadata, and Storage; each user can access only their own records and objects
- [x] T090 Verify environment switching with the same frontend and function sources: local profile uses the CLI-provided URL/key, managed profile uses an installation-owned Cloud URL/publishable key, and neither profile contains hard-coded project refs, service-role keys, or provider secrets
- [x] T091 Finalize and validate `quickstart.md` around two supported paths — fully local and managed Supabase — with Google explicitly optional; confirm that every documented command works from a fresh clone and that the CLI local stack is identified as localhost-only

**Checkpoint**: A fresh clone can run OpenDish locally without Supabase Cloud or Google, the reference managed backend accepts the same migrations/functions, two-user isolation is verified, and changing environments requires configuration only

---

## Phase 9: User Story 7 — Recipe Variants and Modification History (Priority: P2)

**Goal**: History list with restore; variants visible with source relationship; variant detach on source deletion with confirmation warning

**Independent Test**: Apply AI mod → restore prior state from history → create variant → edit independently → delete source → variant standalone

### Tests for User Story 7

- [x] T066 [P] [US7] Integration test: restore writes snapshot as new state + creates `restore` history entry; every change kind snapshots (manual_edit, ai_applied, serving_adjustment, variant_created) in `apps/web/src/features/recipe-history/__tests__/`
- [x] T067 [P] [US7] Integration test: source deletion detaches variants (SET NULL) and cascades history/conversation/proposals in `apps/web/src/features/recipe-history/__tests__/`

### Implementation for User Story 7

- [x] T068 [US7] Implement history UI on recipe page: version list (change kind, timestamp), view snapshot, restore action in `apps/web/src/features/recipe-history/`
- [x] T069 [US7] Implement variants UI: variant badges/links on source and variant pages, delete confirmation warning about variants in `apps/web/src/features/recipe-history/` + `apps/web/src/features/recipes/`

**Checkpoint**: All modification flows are recoverable — FR-023/FR-024 satisfied end to end

---

## Phase 10: User Story 8 — AI Configuration (BYOK) and Graceful Degradation (Priority: P2)

**Goal**: Settings UI for credentials with clear status; AI actions explain configuration state; provider failure degrades gracefully; zero credential leakage

**Independent Test**: No credentials → all non-AI flows work, AI actions explain what's missing → configure → AI works → invalidate → graceful failure, no key in any response/log

### Tests for User Story 8

- [x] T070 [P] [US8] Security test: API key absent from all function responses, error bodies, and client-visible data; status endpoint leaks nothing in `supabase/functions/ai-configure/` tests
- [x] T071 [P] [US8] Component test: settings states (unconfigured/valid/invalid) + AI-unavailable banners on chat/import/generate in `apps/web/src/features/ai-config/__tests__/`

### Implementation for User Story 8

- [x] T072 [US8] Implement AI settings page: provider setup instructions, key entry (write-only), model/base URL, status display, update/remove in `apps/web/src/features/ai-config/` (backend already built in T028)
- [x] T073 [US8] Implement degradation UX: AI status query shared by chat/import/generate UIs — clear "not configured" / "provider error" states that never block recipe management in `apps/web/src/features/ai-config/` + affected features

**Checkpoint**: All eight user stories independently functional

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates and release readiness across all stories

- [x] T074 [P] E2E: SC-001 primary flow (create/import → save → chat → modify → apply/variant → servings → shopping list) in `tests/e2e/primary-flow.spec.ts`
- [x] T075 [P] E2E: SC-002 generation flow + portable Auth (unauthenticated redirect, email/password session, optional Google provider when configured, and cross-user data isolation) in `tests/e2e/`
- [x] T076 [P] Accessibility pass: keyboard navigation, semantic elements, contrast, focus states across all pages
- [x] T077 [P] Responsive/mobile pass on all flows (recipe view, editor, chat, review, shopping list)
- [x] T078 Write `README.md`: choose local or managed setup, `.env.example` reference, optional Google OAuth, AI provider configuration, deployment overview, self-hosting support level, and architecture links into `specs/001-ai-recipe-manager/`
- [x] T079 Security review sweep: no secrets in repo/logs/errors, RLS on every table, SSRF guards active, storage policies verified (constitution IX, XXV)
- [ ] T080 Run full quality gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, clean local database rebuild, and `verify:local` — then validate both supported `quickstart.md` paths from scratch
  <!-- Verified in this environment: pnpm lint, pnpm typecheck, pnpm test, pnpm test:e2e (6/6), pnpm build, a clean local database rebuild + full `pnpm verify:local` (lint+typecheck+test+pgTAP+live Edge Function smoke suite), and quickstart.md Path A (fully local) end to end. NOT verified: quickstart.md Path B (managed Supabase) — this sandbox has no operator-owned Supabase Cloud project, CLI authentication, or database password to link against, so that path cannot be exercised for real here. Leaving unchecked until Path B is validated against an actual managed project. -->

**Checkpoint**: Feature-complete OpenDish is green, secure, responsive, and reproducible before any public deployment workflow is promoted

---

## Phase 12: Managed Cloud Distribution and Reference Deployment

**Purpose**: Make managed Supabase the simplest supported production path without coupling OpenDish to the maintainer's project or frontend host

- [ ] T092 Write an operator guide for a new managed installation: create a Supabase project, link the repository, preview/apply migrations, deploy Edge Functions, configure required secrets, choose Auth providers, configure redirect URLs, and set frontend URL/publishable-key variables
- [ ] T093 Add secret-driven deployment automation for migrations and Edge Functions from protected GitHub environments; no project ref, database password, access token, service-role key, or OAuth secret may be committed, and pull-request CI must never mutate production
- [ ] T094 Deploy and smoke-test the maintainer's personal reference installation — managed Supabase backend plus independently hosted static frontend — using the same documented path available to third parties
- [ ] T095 Complete managed-production hardening: Supabase Security/Performance Advisors, Auth and function rate limits, redirect allowlist, RLS/Data API checks, Storage limits, recovery/backups review, and an abuse-cost assessment for public registration

**Checkpoint**: The maintainer and an independent third party can each deploy isolated Cloud installations from the same repository, and the reference frontend is live without repository-owned secrets

---

## Phase 13: Advanced Self-Hosted Distribution

**Purpose**: Support a permanent Internet/LAN installation on operator-owned infrastructure. This is distinct from the Supabase CLI local stack and remains an advanced, explicitly maintained deployment profile.

- [ ] T096 Add a version-pinned self-hosted deployment profile based on the official Supabase Docker Compose release, with explicit supported versions and no fork of application, migration, or Edge Function source
- [ ] T097 Automate applying OpenDish migrations and installing/restarting Edge Functions on the self-hosted stack; map frontend, Auth, Vault, Storage, and function environment variables without Cloud-only management APIs
- [ ] T098 Document and validate production operator responsibilities: domain/DNS, TLS reverse proxy, SMTP, generated secrets, persistent Storage or S3, database/Storage backups, restore procedure, monitoring, updates, and rollback
- [ ] T099 Add a self-hosted smoke/upgrade suite and compatibility matrix covering Auth, RLS, Data API, Storage, Vault, and all Edge Functions; document known differences from managed Supabase and refuse unsupported version combinations clearly

**Checkpoint**: A qualified operator can run OpenDish permanently on owned infrastructure with documented security, persistence, backup, upgrade, and rollback procedures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories**
- **User Stories 1–6 (Phases 3–8)**: all depend on Foundational; P1 stories (US1–US3) first for MVP, then P2
- **Portable Foundation (Phase 8.5)**: depends on the implemented foundation and completed stories through Phase 8; **BLOCKS Phases 9–13**
- **User Stories 7–8 (Phases 9–10)**: depend on Foundational plus Portable Foundation
- **Polish (Phase 11)**: depends on all desired stories and Portable Foundation being complete
- **Managed Cloud Distribution (Phase 12)**: depends on Phase 11 release readiness
- **Advanced Self-Hosted Distribution (Phase 13)**: depends on Phase 11 and the stable portable contract; it follows the managed reference path but does not depend on Supabase Cloud at runtime

### User Story Dependencies

- **US1 (P1)**: Foundational only — no story dependencies
- **US2 (P1)**: reuses US1's editor (T035) and save path; independently testable
- **US3 (P1)**: reuses US1's recipe view (T038); independently testable
- **US4 (P2)**: needs US1 recipe data + US3 view to host chat; needs T028 (`ai-configure`, Foundational) for credentials; independently testable
- **US5 (P2)**: reuses US2's review screen (T043) and US4's provider plumbing; independently testable
- **US6 (P2)**: needs US1 recipes + US3 scaling domain logic only — **no AI dependency**; independently testable
- **Portable Foundation**: uses the existing Auth/RLS/Vault/storage/function boundaries and freezes their cross-environment contract before more feature work
- **US7 (P2)**: needs US4's apply/variant flows, the Foundational save path, and the Portable Foundation checkpoint; independently testable
- **US8 (P2)**: backend (T028) already exists, but UI/UX work begins only after Vault portability is verified in Phase 8.5; independently testable

### Within Each User Story

- Tests FIRST — confirm they fail before implementing
- Contracts/domain logic before UI; Edge Function before its client wiring
- Story checkpoint green before moving to the next priority

### Parallel Opportunities

- Phase 1: T003–T008 parallel after T001/T002
- Phase 2: T009–T011 parallel; T014–T017 parallel after T013; T020–T023 parallel; T025/T027/T029/T030 parallel
- After Foundational: US1/US2/US3 sequential where they share files, then US4–US6; after the Portable Foundation checkpoint, US7 and US8 can proceed across separate feature folders
- Per-story test tasks ([P]) run in parallel

## Parallel Example: Foundational Domain Core

```bash
# After T021 lands, these run together:
Task: "Serving scaling in apps/web/src/domain/scaling.ts"          # T022
Task: "Shopping-list merge in apps/web/src/domain/shopping.ts"     # T023
Task: "Recipe save path in apps/web/src/domain/recipe-save.ts"     # T024
```

---

## Implementation Strategy

### MVP First (P1 stories only)

1. Phase 1 Setup → Phase 2 Foundational (CRITICAL — blocks everything)
2. Phase 3 US1 → **STOP and VALIDATE** — manual recipe management works
3. Phase 4 US2 + Phase 5 US3 → complete AI-less recipe manager
4. Deployable demo: create, import, browse, scale — zero AI required

### Incremental Delivery

1. Setup + Foundational → foundation green
2. US1 → validate → MVP
3. US2, US3 → validate → P1 complete (viable product)
4. US4 → validate → defining AI flow live
5. US5–US6 → validate each
6. Portable Foundation → prove local + managed parity and freeze the environment contract
7. US7–US8 → validate each → v1 feature-complete
8. Polish → full quality gates
9. Managed Cloud distribution/reference deployment
10. Advanced self-hosted distribution

### Notes

- No tasks exist for out-of-scope items (social features, meal planning, pantry, multi-provider, multi-list, i18n infra, RAG) — constitution YAGNI
- T081/T082 were appended during `/speckit.analyze` remediation (FR-035 coverage) and live inside their story phases despite the higher IDs
- Every recipe write goes through the single domain save path (T024) — this is how "every saved change creates history" stays structural
- All automated tests use the fake provider (T027); live AI calls happen only in manual verification
- `supabase start` is a local development/personal-local profile only and MUST NOT be documented as Internet-facing production; permanent operator-owned deployments use Phase 13
- Managed Cloud, local CLI, and self-hosted installations share application/migration/function sources; environment-specific behavior belongs in configuration and deployment assets
- Commit after each task or logical group; keep the repo green at every checkpoint
