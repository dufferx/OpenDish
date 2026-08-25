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

## Phase 11.5: Iterative UI/UX Review in Codex

**Purpose**: Evolve the product experience through focused review iterations in the Codex app. Each iteration starts with user feedback observed against the running local application, turns that feedback into explicit UI/UX requirements and scoped tasks in this documentation, and is approved before any implementation work begins.

**Scope**: Interface clarity, navigation, visual hierarchy, layout, responsive behavior, interaction feedback, accessibility, empty/loading/error states, and consistency across existing flows. This phase does not add new product capabilities, change the data model or API contracts, or implement changes merely by recording feedback.

### Iteration workflow

1. Run the local application in Codex and collect the user's concrete observations, including the affected screen, flow, viewport when relevant, intended outcome, and priority.
2. Add a numbered iteration entry to this phase before changing product code. Each entry MUST state the problem, affected paths/components, acceptance criteria, relevant responsive and accessibility expectations, and the validation method.
3. Identify whether the feedback is a UI/UX adjustment or instead requires a new product requirement, data-model change, API-contract change, or security decision. Escalate the latter to the appropriate design document before it becomes an implementation task.
4. Keep documentation-only iterations separate from approved implementation tasks. No feedback item is implemented until the user explicitly asks to proceed with that item.
5. After implementation is authorized in a later iteration, update the item status and record the verification evidence (manual Codex review, component/integration test, and/or responsive/accessibility check as appropriate).

### UI/UX iteration backlog

#### Iteration UX-001 — Initial settings, authentication, recipe, shopping, and branding review

- [x] T100 [UX-001] **Suppress the redundant AI-configuration banner on Settings**
  - **Feedback / problem**: The AI-unavailable banner on `/settings` instructs the user to open Settings even though they are already there.
  - **Affected experience**: `/settings`; `apps/web/src/features/ai-config/ai-availability-banner.tsx` and settings composition.
  - **Desired outcome**: Settings presents its configuration form/status directly, without a self-referential navigation prompt.
  - **Acceptance criteria**: The banner remains available on AI-dependent screens outside Settings; it is not rendered on `/settings`; no unavailable-AI state becomes hidden or inaccessible on the settings page.
  - **Accessibility and responsive considerations**: Removing the banner must not remove an announced status or guidance needed by assistive technology.
  - **Validation**: Component test for route-aware banner visibility and manual mobile/desktop Codex review.
  - **Status**: verified — `AiAvailabilityBanner` now self-hides on `/settings` (route-aware via `useLocation`), and the settings page no longer renders it explicitly. `AiAvailabilityBanner`/`AiSettingsPage` tests updated + added (route-aware visibility, no-banner-on-settings), all passing. NOT independently confirmed via a live Codex browser session in this environment (no browser tool available here) — recommend a quick manual look at `/settings` vs. `/recipes/:id` before shipping.

- [x] T101 [UX-001] **Use a controlled model selector in AI settings**
  - **Feedback / problem**: The provider model is currently a free-text field; it should always be a dropdown.
  - **Affected experience**: `/settings`; `apps/web/src/features/ai-config/ai-settings-page.tsx`.
  - **Desired outcome**: Users choose the model from an accessible list of supported models rather than entering an arbitrary value.
  - **Acceptance criteria**: The current saved model appears selected; the control exposes a visible label and keyboard-operable options; submissions use only an available option; loading, validation, and unavailable-model states are clear.
  - **Accessibility and responsive considerations**: Use a native or fully accessible select pattern and preserve usable touch targets on mobile.
  - **Validation**: Component tests for selection, saved-value hydration, and submission; manual Codex review.
  - **Status**: verified — replaced the free-text model `Input` with a Radix `Select` (`SUPPORTED_AI_MODELS` in `ai-config-api.ts`); a saved model that has fallen off the supported list is surfaced as its own extra, clearly-labeled option instead of disappearing (tracked as separate state so Radix's Select correctly shows it as selected on first paint). Component tests cover: default selection, keyboard-operable option choice, submission using the selected value, and the unsupported-saved-model case. Added `hasPointerCapture`/`scrollIntoView` jsdom polyfills in `src/test/setup.ts` required for Radix Select under jsdom. Manual Codex browser review not performed (no browser tool in this environment).

- [x] T102 [UX-001] **Replace header sign-out with a settings avatar entry point**
  - **Feedback / problem**: Sign out occupies the global header; the user wants an avatar/profile affordance that opens Settings for now, while sign-out moves into Settings.
  - **Affected experience**: Global layout; `apps/web/src/app/app-layout.tsx`, `apps/web/src/features/auth/sign-out-button.tsx`, and `/settings`.
  - **Desired outcome**: A recognizable user avatar opens Settings; sign-out is available in the settings account area.
  - **Acceptance criteria**: The header contains an accessible avatar button/link labeled for Settings; activating it navigates to `/settings`; the header no longer exposes sign-out; Settings exposes a clearly labeled sign-out action with its existing pending/error behavior.
  - **Accessibility and responsive considerations**: The avatar must not rely on a photo alone—provide an accessible name and a resilient initials/fallback visual until profile settings exist.
  - **Validation**: Navigation and sign-out component tests; keyboard and mobile-header review.
  - **Status**: verified — header now shows a `UserAvatarLink` (initials from the account email, falling back to a generic user icon, `aria-label="Open Settings"`) linking to `/settings`; sign-out moved into a new "Account" card on the Settings page next to the account email, reusing the existing `SignOutButton` with its pending/error behavior unchanged. New tests: header no longer exposes sign-out and exposes the avatar link (`app-layout.test.tsx`), Settings renders the account email and a working sign-out action (`ai-settings-page.test.tsx`). Manual mobile-header visual review not performed live.

- [x] T103 [UX-001] **Add Google brand icon to the OAuth action**
  - **Feedback / problem**: “Continue with Google” lacks the Google logo.
  - **Affected experience**: `/login`; `apps/web/src/features/auth/login-page.tsx`.
  - **Desired outcome**: The optional Google OAuth action includes the recognizable Google mark.
  - **Acceptance criteria**: The icon appears only when Google sign-in is enabled; it is decorative or has correct accessible labeling without duplicating the button name; loading and disabled states retain a stable layout.
  - **Accessibility and responsive considerations**: Keep text as the accessible action name and maintain contrast at all supported sizes.
  - **Validation**: Existing OAuth visibility/loading tests updated; visual review.
  - **Status**: verified — added a decorative (`aria-hidden`) inline multi-color Google "G" `GoogleIcon` inside the existing "Continue with Google" button, rendered only inside the already `googleEnabled`-gated block; button text remains the accessible name and layout stays stable across loading/disabled states (icon is fixed, only trailing text changes). New test asserts the icon renders when Google is enabled; visual/contrast review not performed live.

- [x] T104 [UX-001] **Make the active authentication mode unmistakable**
  - **Feedback / problem**: The Sign in / Create account switch does not visibly communicate which mode is selected.
  - **Affected experience**: `/login`; `apps/web/src/features/auth/login-page.tsx`.
  - **Desired outcome**: Selected and unselected modes are visually distinct and programmatically exposed.
  - **Acceptance criteria**: The selected mode has a persistent high-contrast active treatment; the inactive mode remains clearly actionable; the state is exposed through the appropriate semantic selected/pressed state; switching modes updates title, form, and submit copy coherently.
  - **Accessibility and responsive considerations**: Meet contrast requirements and preserve visible focus independent of selected styling.
  - **Validation**: Component tests for selected semantics and mode changes; keyboard review.
  - **Status**: verified — the mode switch already exposed `aria-pressed`, but both variants (`secondary`/`ghost`) read too similarly; the active button now uses the high-contrast `default` (primary) variant against `ghost` for the inactive one, so selection is unmistakable at a glance while `aria-pressed` continues to expose it programmatically. New test asserts `aria-pressed` and the underlying `data-variant` swap correctly on click. Keyboard/contrast review not performed live.

- [x] T105 [UX-001] **Provide password visibility control**
  - **Feedback / problem**: Password fields cannot be temporarily revealed.
  - **Affected experience**: `/login`; `apps/web/src/features/auth/login-page.tsx`.
  - **Desired outcome**: A user can toggle password masking with an icon control.
  - **Acceptance criteria**: The control changes only the field’s presentation between masked and visible; it has an accessible “Show password” / “Hide password” name; it does not clear the value or submit the form; both authentication modes support it.
  - **Accessibility and responsive considerations**: The icon has a touch-friendly target, visible focus, and does not depend on color alone.
  - **Validation**: Component tests for field type and accessible name transitions; mobile review.
  - **Status**: verified — added an Eye/EyeOff icon toggle button (touch target `size-9`) inside both the password and confirm-password fields, independently toggleable, `aria-label` switching between "Show password"/"Hide password" (and the confirm-password equivalents), never clearing the value or submitting the form (`type="button"`). Tests cover reveal/hide without side effects and independent toggles in create-account mode. Mobile/touch review not performed live.

- [x] T106 [UX-001] **Stabilize recipe search while typing**
  - **Feedback / problem**: Entering search text reloads or remounts the recipe UI, making search unusable.
  - **Affected experience**: `/`; `apps/web/src/features/recipes/recipe-list-page.tsx` and its query/state wiring.
  - **Desired outcome**: Search filters results smoothly without losing focus, text, or the surrounding page state.
  - **Acceptance criteria**: Each keystroke preserves input focus and its current value; the page does not navigate or visually reset; result updates are debounced and show an intentional loading state only when needed; clearing search restores the unfiltered collection.
  - **Accessibility and responsive considerations**: Do not announce every keystroke; announce meaningful result/loading changes through an appropriate live region if one is added.
  - **Validation**: Regression test that types a multi-character query and asserts focus/value persist; manual performance review in Codex.
  - **Status**: verified — root cause was `useRecipes`' `isLoading` flipping true (and replacing the whole page with the full-page `<Loading/>`) on every new search `queryKey`, unmounting the search input on each keystroke. Fixed by: separating the always-mounted `searchInput` (immediate) from a 300ms-debounced `filters.search` used for the query; `placeholderData: keepPreviousData` on `useRecipes` so a filter change no longer flips `isLoading`; a visually-hidden `aria-live="polite"` status region that announces result-count/updating changes once per settled search instead of per keystroke; a small inline spinner during background refetches. New regression test types a multi-character query and asserts input focus/value persist and results update after debounce; a second test confirms Clear restores the unfiltered list. Manual perf review in Codex not performed live.

- [x] T107 [UX-001] **Add clear purchased-state feedback to shopping-list items**
  - **Feedback / problem**: Toggling a shopping-list checkbox gives insufficient feedback.
  - **Affected experience**: `/shopping-list`; `apps/web/src/features/shopping-list/shopping-list-page.tsx`.
  - **Desired outcome**: A purchased toggle responds immediately with a clear, pleasant state transition.
  - **Acceptance criteria**: The checkbox state updates immediately; the item receives a visible purchased treatment (for example, check animation plus text treatment); pending/saved/error states are distinguishable; the item remains undoable.
  - **Accessibility and responsive considerations**: Respect reduced-motion preferences, keep the control’s checked state programmatically correct, and never use animation as the sole confirmation.
  - **Validation**: Component test for state transitions and mutation states; manual reduced-motion and touch review.
  - **Status**: verified — `togglePurchased` now applies an optimistic cache update (`onMutate`/`onError` rollback/`onSettled` reconcile) so the checkbox and row flip immediately instead of waiting on the round trip; the mutation's pending item id is exposed so only the row being saved shows a small spinner + "Saving…" status text (others are unaffected); a purchased item gets an additional small checkmark icon (motion-safe pop-in) alongside the existing line-through/muted text treatment, so confirmation never depends on animation alone; row/text color transitions are gated with `motion-reduce:transition-none` and the checkmark entrance with `motion-safe:`; toggling again remains the undo path (rollback on failure restores the previous state and surfaces a toast). New tests cover the per-row pending indicator, the checkmark treatment, and re-toggling to undo. Manual reduced-motion/touch review not performed live.

- [x] T108 [UX-001] **Redesign recipe assistance as a persistent split-view conversation**
  - **Feedback / problem**: The current assistant is an isolated card. The desired experience is an active, chat-first conversation paired with the relevant recipe, with suggestions appearing as chat messages.
  - **Affected experience**: Recipe detail and assistant flow; `apps/web/src/features/recipes/recipe-detail-page.tsx`, `apps/web/src/features/recipe-conversation/recipe-conversation.tsx`, and `apps/web/src/features/modification-review/`.
  - **Desired outcome**: When a recipe conversation is active, desktop/tablet layouts show recipe and conversation in a balanced split view; the conversation supports normal chat chronology and presents modification suggestions in-message while preserving explicit review/apply control.
  - **Acceptance criteria**: Starting/opening a recipe conversation switches to the conversation-focused layout; wide viewports render recipe and chat side by side with neither pane obscured; narrow viewports provide an intentional stacked or switchable equivalent; messages retain their order and loading/error states; AI suggestions remain unapplied until the existing explicit review action; returning to the recipe preserves the active conversation context.
  - **Accessibility and responsive considerations**: Define keyboard focus order across panes, readable chat announcements, scroll behavior, and a mobile layout that does not create competing nested scroll regions.
  - **Validation**: New component/integration coverage for layout state and proposal actions; responsive Codex review at mobile and desktop widths; accessibility pass.
  - **Status**: implemented (not independently verified — see caveat). `RecipeDetailPage` now opens an "Ask AI" entry point that switches to a two-pane layout: `lg:grid-cols-2` renders the recipe pane and a `lg:sticky`, independently `lg:overflow-y-auto` assistant pane side by side; below `lg` only one pane is visible at a time via an accessible `role="tablist"`/`role="tab"`/`role="tabpanel"` switcher (`aria-selected`, `aria-controls`), with both panes kept mounted (`hidden` class only) so switching tabs never drops conversation state and mobile never has two competing scroll regions. Opening the assistant moves keyboard focus into the pane (`tabIndex={-1}` + `.focus()`). Inside `RecipeConversation`, the pending `ModificationReview` now renders as the last `<li>` of the conversation `<ol>` (an in-message suggestion) instead of a detached card below it — the apply/save-as-variant/discard/regenerate logic in `ModificationReview`/`proposal-actions.ts` was not touched, so suggestions remain unapplied until that same explicit action. New tests (`recipe-detail-page.test.tsx`): assistant stays closed by default, opening it switches layout and moves focus, the mobile tab switcher toggles pane visibility without unmounting either pane (conversation stays in the DOM). Existing `recipe-conversation`/`modification-review` tests continue to pass unchanged, confirming message order/loading/error/proposal-action behavior wasn't altered. **Caveat — not done**: no live browser/Playwright tool was available in this environment, so the explicitly-requested "responsive Codex review at mobile and desktop widths" and a manual accessibility pass (contrast, real screen-reader chat announcements, actual scroll behavior) were **not performed**; only automated component tests and code-level review back this item. Recommend a manual pass in Codex at both viewport sizes before treating this as fully verified.

- [ ] T109 [UX-001] **Define nutrition-macros requirement before designing macro displays**
  - **Feedback / problem**: Macros should be calculated by AI and shown consistently in recipe cards and recipe details.
  - **Affected experience**: Recipe generation/import/edit/save flows, recipe list and detail, AI provider output, shared contracts, data model, and potentially shopping/history presentation.
  - **Desired outcome**: Establish a product-approved, trustworthy nutrition-macros model before creating UI tasks that expose it everywhere.
  - **Acceptance criteria**: Update `spec.md`, `data-model.md`, `contracts/api-contracts.md`, and `research.md` with the approved macro fields, source/provenance, calculation trigger, refresh/edit behavior, failure/degradation behavior, persistence/history rules, and estimate disclaimer; resolve the conflict between “AI should always calculate macros” and the current requirement that core recipe management works without configured AI; then create a separate implementation task sequence and display specifications.
  - **Accessibility and responsive considerations**: Macro summaries must use readable labels and units rather than color-only visuals, and remain understandable when estimates are unavailable.
  - **Validation**: Design-review approval of the updated specification before any data-model, API, or UI implementation begins.
  - **Status**: documented — requires product decision and specification update

- [x] T110 [UX-001] **Adopt the supplied mascot as the application brand mark**
  - **Feedback / problem**: The text-only OpenDish header brand should be replaced throughout the app by the supplied mascot asset.
  - **Affected experience**: Global shell and authentication branding; `apps/web/src/app/app-layout.tsx`, `apps/web/src/features/auth/login-page.tsx`, and `/Users/dufferx/Desktop/opendish/plate_chef_a2_1787334522690.jpg`.
  - **Desired outcome**: A consistent, recognizable mascot-led brand entry point across application screens.
  - **Acceptance criteria**: The supplied mascot is used as the header brand mark on authenticated screens and consistently reflected on the login screen; activating the header mark retains its existing home navigation behavior; image sizing, cropping, loading, and fallback behavior are intentional; the brand remains legible in compact headers.
  - **Accessibility and responsive considerations**: Provide appropriate alternative text or a decorative treatment paired with an accessible OpenDish link name; do not make the logo the only indicator of the destination.
  - **Validation**: Visual review across all primary routes and mobile/desktop header tests.
  - **Status**: verified — the mascot is used on login and in the global authenticated header. Its circular crop was replaced with a rounded-square treatment (`rounded-xl` on login and `rounded-md` in the compact header), preserving explicit sizing, fallback background, and `object-cover`; focused tests and a live Codex review of `/login` passed.

**Entry template**:

- [ ] T### [UX-###] **Title**
  - **Feedback / problem**:
  - **Affected experience**: route(s), component(s), and viewport(s)
  - **Desired outcome**:
  - **Acceptance criteria**:
  - **Accessibility and responsive considerations**:
  - **Validation**:
  - **Status**: documented | approved for implementation | implemented | verified

**Checkpoint**: Each accepted UI/UX iteration is documented with testable acceptance criteria before implementation and verified against those criteria after implementation. The phase may continue alongside release preparation; it does not block managed or self-hosted distribution unless an iteration identifies a release-critical defect.

---

## Phase 11.75: Social Media Video Recipe Import (`yt-dlp`) — Scope Approved

**Purpose**: Let users import recipes from Instagram Reels, TikTok videos, and YouTube Shorts whose recipe lives in the caption or description, by fetching content with `yt-dlp` instead of the plain HTTP fetch `import-recipe` uses today. All three platforms are in scope for this phase without an intentional product limitation. Audio transcription is explicitly deferred to a future phase. Full investigation: research.md R14. User story: spec.md User Story 9.

**✅ SCOPE APPROVED**: The user explicitly approved implementation for Instagram Reels, TikTok videos, and YouTube Shorts using an external `yt-dlp` microservice. The implementation must remain within the existing security, privacy, validation, BYOK, cost-conscious hosting, and mandatory-review constraints. No platform is intentionally excluded from this phase, but upstream platform changes or blocking may still produce a clear, recoverable import failure. The interim Phase 11.5 rejection remains only until these tasks are implemented.

### Scope decision (approved 2026-08-24)

- [x] D1 Approved platform scope: Instagram Reels + TikTok videos + YouTube Shorts. All three use the same metadata-first `yt-dlp` path; Instagram cookies are not a prerequisite and cookie custody is not part of this phase.
- [x] D2 Approved architecture constraint: use a separately hosted, version-pinned HTTP microservice because `yt-dlp`/`ffmpeg` cannot be embedded in the existing Supabase Edge Function. Hosting must remain within the project's existing zero/near-zero-cost preference; the concrete provider is a deployment detail.
- [x] D3 Approved transcript policy: audio transcription is not included in Phase 11.75. It is a future enhancement after metadata-only extraction is validated.
- [x] D4 Instagram cookie custody: not applicable to the approved Phase 11.75 scope. The phase must not require storing or transmitting Instagram session cookies.

### Tests for this phase

- [x] T111 [P] Contract test: video-import microservice HTTP contract (metadata-only success, unsupported-platform error, upstream-blocked error) against a fixture/mock server — no live network calls
- [x] T112 [P] Contract test: `import-recipe` routes Instagram, TikTok, and YouTube Shorts to the new service while still returning the clear message for platforms outside the approved set
- [x] T113 [P] Security test: the metadata-only social import path never accepts, logs, returns, or persists platform session cookies; shared service authentication is never exposed to the client

### Implementation — Track A: metadata-only import (Instagram, TikTok, YouTube Shorts)

- [x] T114 Stand up the version-pinned `yt-dlp` microservice (per D2; `ffmpeg` is reserved for future transcription) exposing one authenticated HTTP endpoint that accepts a URL and returns `{ title, description }` via `--dump-json --skip-download`, with request timeouts and response size limits mirroring `safe-fetch.ts`'s existing discipline
- [x] T115 Extend `supabase/functions/import-recipe/handler.ts` so recognized video-platform URLs call the new service (shared secret) instead of the "unsupported" short-circuit, feeding the returned description into the existing, unmodified `extractRecipe` AI pipeline
- [x] T116 Add an `extractionMethod: 'video_metadata'` value to the import result contract in `packages/contracts` and the review screen's extraction-method indicator (T043)
- [x] T117 Update the import UI hint copy (`import-recipe-page.tsx`) to reflect which platforms are newly supported per D1, keeping the clear "unsupported" message for everything still out of scope

### Future work — Track B: audio-transcript fallback (outside Phase 11.75)

- [ ] T118 [FUTURE] Extend the microservice to fall back to `-x --audio-format mp3` audio extraction when description-only extraction yields no usable recipe, capped to short-form video durations
- [ ] T119 [FUTURE] Send extracted audio to the user's configured OpenAI transcription endpoint (reusing existing BYOK credentials from `ai-configure`); surface the estimated added latency/cost before triggering this path, per FR-042

### Track C: Instagram cookies — explicitly excluded from Phase 11.75

- T120/T121 are not part of the approved phase. Instagram import must not require, collect, or store session cookies. If future platform behavior makes cookies necessary for a later enhancement, that work requires a separate security and product decision.

**Checkpoint**: T111–T117 must be green for Phase 11.75 to close. T118–T119 remain explicitly deferred future work and do not block phase completion. T120–T121 are excluded from this phase. Every supported platform uses the same mandatory review flow, and no import persists data before explicit user save.

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
- **Iterative UI/UX Review (Phase 11.5)**: begins after the Phase 11 baseline and is driven by documented user feedback from the running Codex app; it may proceed independently of Phases 12–13
- **Social Media Video Import (Phase 11.75)**: approved for all three platforms with the metadata-first `yt-dlp` path; independent of Phases 12–13 and does not block managed or self-hosted distribution either way
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
9. Iterative UI/UX review in Codex → document, approve, implement, and verify each accepted adjustment
10. Social media video import → implement the approved all-platform metadata-first path, then validate the future transcription boundary
11. Managed Cloud distribution/reference deployment
12. Advanced self-hosted distribution

### Notes

- No tasks exist for out-of-scope items (social features, meal planning, pantry, multi-provider, multi-list, i18n infra, RAG) — constitution YAGNI
- Phase 11.75 (social media video import) is approved for Instagram Reels, TikTok videos, and YouTube Shorts through the metadata-first `yt-dlp` path. Audio transcription and cookie-based Instagram access are explicitly future work; implementation remains subject to the existing security, validation, hosting-cost, and mandatory-review constraints.
- T081/T082 were appended during `/speckit.analyze` remediation (FR-035 coverage) and live inside their story phases despite the higher IDs
- Every recipe write goes through the single domain save path (T024) — this is how "every saved change creates history" stays structural
- All automated tests use the fake provider (T027); live AI calls happen only in manual verification
- `supabase start` is a local development/personal-local profile only and MUST NOT be documented as Internet-facing production; permanent operator-owned deployments use Phase 13
- Managed Cloud, local CLI, and self-hosted installations share application/migration/function sources; environment-specific behavior belongs in configuration and deployment assets
- Commit after each task or logical group; keep the repo green at every checkpoint
