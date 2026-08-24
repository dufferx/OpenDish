# Implementation Plan: AI-First Personal Recipe Manager

**Branch**: `001-ai-recipe-manager` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ai-recipe-manager/spec.md`

## Summary

Build the initial open-source, AI-first personal recipe manager as a modular monolithic SPA: React + TypeScript + Vite frontend talking directly to Supabase (PostgreSQL + RLS) for ordinary data, with five thin Edge Functions for everything involving secrets, AI providers, or untrusted remote content. Recipes are relational, structured entities (ingredients as exact rational quantities, ordered steps, explicit servings) with snapshot-based JSONB history, same-table variants, one persistent conversation per recipe, and lifecycle-tracked modification proposals. AI (BYOK, one provider — OpenAI via HTTP behind a small provider boundary, key in Supabase Vault) can answer questions, generate recipe drafts, extract imports as a fallback, and propose structured modifications — but only validated data reaches review, and only explicit user action persists anything. Serving scaling and shopping-list aggregation are deterministic domain logic, never AI.

## Technical Context

**Language/Version**: TypeScript strict (Node ≥ 20 for tooling; Deno for Edge Functions)

**Primary Dependencies**: React 18, Vite, React Router, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form, Zod, `@supabase/supabase-js`. Edge Functions: Deno std + shared contracts package. No global state library, no AI SDK framework, no search infra.

**Storage**: PostgreSQL via Supabase (relational recipe model, JSONB only for history snapshots and proposal operations), Supabase Storage private bucket `recipe-images`, Supabase Vault for BYOK keys.

**Testing**: Vitest (unit/integration incl. RLS policy tests against local Supabase), React Testing Library, Playwright (critical flows only). AI provider behind an interface with deterministic test doubles; zero live AI calls in automated tests.

**Target Platform**: Modern desktop and mobile browsers (responsive SPA). One portable backend contract supports Supabase CLI localhost and managed Supabase; advanced production self-hosting is a later version-pinned distribution profile. The frontend is a host-independent static Vite build.

**Project Type**: Web application (modular monolith, single pnpm workspace).

**Performance Goals**: Personal scale — hundreds of recipes; ILIKE search and direct queries are sufficient. AI calls are explicit user actions with loading states; no latency budget beyond "feels responsive".

**Constraints**: Zero/near-zero hosting cost; no paid AI calls in CI; credentials never client-visible; all DB changes via versioned migrations; offline/SSR/native explicitly out of scope.

**Scale/Scope**: Personal collections isolated per authenticated account; an installation may host multiple independent accounts but has no collaboration, sharing, roles, or cross-user data access. Approximately 9 frontend features, 12 tables, and 5 Edge Functions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* — **PASS** (checked both before Phase 0 and after Phase 1).

| Principle | Verdict | Evidence |
|---|---|---|
| I KISS / II YAGNI | Pass | No microservices, event sourcing, queues, vector DBs, external search, global state library, or multi-provider framework — all explicitly excluded; every exclusion in the technical direction is honored. |
| III SOLID / V SoC | Pass | Feature-oriented frontend boundaries; AI behind one provider interface; secrets confined to Edge Functions; domain logic (scaling, aggregation, history) framework-free. |
| IV DRY / XXIX single source of truth | Pass | `packages/contracts` is the one authoritative schema source for client and functions; recipe save path is one domain function. |
| VI domain integrity / XIII strong typing | Pass | Relational entities, rational quantities, Zod at every trust boundary, strict TS, DB CHECK constraints. |
| VII AI untrusted / structured output | Pass | Two-level validation (schema + domain re-application check); AI never mutates persisted data; flow is always response → validate → review → explicit action → persist (contracts doc). |
| VIII provider independence / BYOK | Pass | Small `AiProvider` interface; one v1 provider (OpenAI over plain HTTP); configurable base URL; keys in Vault. |
| IX security | Pass | RLS on every user-owned table, SSRF-guarded fetch, private owner-prefixed storage, no secrets in logs/errors/client, authenticated sessions, and two-user isolation tests. |
| X privacy / XI testability | Pass | No telemetry; BYOK; domain logic unit-testable without network; deterministic AI doubles. |
| XXIII data evolution | Pass | Snapshot history + versioned migrations; variants survive source deletion (SET NULL). |
| XXVII architecture earns complexity | Pass | Monolith, direct client→Supabase, functions only where trust boundaries require them. |

**Complexity Tracking**: none — no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-recipe-manager/
├── plan.md              # This file
├── research.md          # Phase 0 — 13 resolved decisions (R1–R13)
├── data-model.md        # Phase 1 — tables, RLS, invariants, migrations
├── contracts/
│   └── api-contracts.md # Phase 1 — Zod domain contracts + 5 Edge Function APIs
├── quickstart.md        # Phase 1 — local dev, commands, deployment outline
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

Single pnpm workspace — app, shared contracts, and Edge Functions in one repo (modular monolith).

```text
packages/
└── contracts/                # Zod schemas + inferred types + AiProvider interface (runtime-neutral)
    └── src/
        ├── recipe.ts         # Quantity, Ingredient, Step, RecipeDraft, RecipeSnapshot
        ├── modification.ts   # ModificationOp, ModificationProposal
        ├── conversation.ts   # messages, ChatOutcome
        ├── shopping-list.ts
        └── ai-provider.ts    # provider boundary interface + error types

apps/
└── web/                      # Vite SPA (feature-oriented)
    └── src/
        ├── app/              # router, providers (Query client, auth guard), layout, nav
        ├── features/
        │   ├── auth/                 # email/password baseline, optional Google OAuth, session guard
        │   ├── recipes/              # collection list, search, tag filter, recipe view, servings scaler UI
        │   ├── recipe-editor/        # manual create/edit form (React Hook Form + Zod)
        │   ├── recipe-import/        # URL/paste input, review screen
        │   ├── recipe-conversation/  # per-recipe chat thread
        │   ├── modification-review/  # proposal diff, apply / variant / discard, stale handling
        │   ├── recipe-history/       # history list, restore, variants display
        │   ├── shopping-list/        # list UI, add-from-recipe with servings, merge
        │   └── ai-config/            # BYOK settings, status, provider setup instructions
        ├── domain/           # pure logic: rational math, serving scaling, list aggregation,
        │                     # history/save orchestration types (unit-tested, framework-free)
        ├── lib/              # supabase client, signed-url helpers, formatters
        └── components/ui/    # shadcn/ui primitives

supabase/
├── migrations/               # versioned schema + RLS + storage policies
├── tests/                    # RLS / database policy tests against local Supabase
├── functions/
│   ├── ai-configure/
│   ├── ai-recipe-chat/
│   ├── ai-propose-modification/
│   ├── ai-generate-recipe/
│   └── import-recipe/
└── functions/_shared/        # provider implementation (OpenAI HTTP), Vault access,
                              # SSRF-safe fetch, JSON-LD extractor, validation helpers

tests/
└── e2e/                      # Playwright critical flows
```

**Structure Decision**: Single pnpm workspace with `apps/web`, `packages/contracts`, and `supabase/`. Feature-oriented frontend per the technical direction; shared contracts package keeps client and Deno functions on one schema source of truth; `_shared` confines all provider/secret/untrusted-content code to the server side.

## Phase 1 Design Decisions (cross-references)

- Data model, RLS, invariants, migration rules → [data-model.md](./data-model.md)
- Domain Zod contracts, proposal operation model, five Edge Function APIs, direct-to-Supabase surface → [contracts/api-contracts.md](./contracts/api-contracts.md)
- Provider choice, rational quantities, Vault usage, JSON-LD-first import, staleness via `head_version`, conservative list merging → [research.md](./research.md) (R1–R13)

## Testing Strategy Mapping

| Spec requirement | Test focus |
|---|---|
| FR-005 recipe validation | Zod schema + form tests |
| FR-012/013 serving scaling | Rational arithmetic unit tests incl. quantity-less pass-through, fraction rendering |
| FR-025–027 shopping list | Conservative merge unit tests (equal units merge, mismatched units stay separate, manual edits) |
| FR-024 history / FR-023 variants | Save-path integration tests: every change kind snapshots; restore works; variant detach on delete |
| FR-016–020 proposals | Schema validation, domain re-application check, stale `base_version` rejection, lifecycle transitions |
| FR-006–010 import | JSON-LD normalization fixtures; SSRF guard cases; AI-fallback with fake provider; nothing persisted pre-review |
| FR-028–030 BYOK | Vault write/read via service role only; key absent from every response/log; status flow |
| FR-000 / RLS | Policy tests: unauthenticated access denied and a second authenticated user can read/write nothing owned by the first |
| FR-036–039 portability | Fresh local install without Cloud/Google; same migrations/functions against managed Supabase; configuration-only environment switching; no privileged secret in frontend/repository |
| FR-031 degradation | Fake provider failure → core flows unaffected |
| E2E (Playwright) | SC-001 primary flow, SC-002 generation flow, login gate |

## Planned Architecture Extension (Pending Approval): Social Media Video Import

User Story 9 / tasks.md Phase 11.75 (import from Instagram/TikTok/YouTube Shorts, research.md R14) would be the first feature requiring a component outside this plan's architecture: `yt-dlp` + `ffmpeg` need subprocess execution, which Supabase Edge Functions (Deno Deploy) cannot do. It would require a new, separately hosted HTTP microservice — the first departure from "Supabase + independently hosted static frontend, nothing else" and from the "Zero/near-zero hosting cost" constraint above. This is deliberately **not** reflected in the directory structure or Edge Function list below until research.md R14's open questions are explicitly approved; see tasks.md Phase 11.75 for the gated task breakdown.

## Remaining Open Decisions

None blocking implementation. The technical direction fixed the stack and authorized provider selection; research.md selected OpenAI (R1) and rational quantities (R3). The original Google-only single-owner decision (R5) was superseded on 2026-08-21 by portable Auth: email/password baseline, optional Google OAuth, no mandatory allowlist, and per-account RLS isolation. Phase 8.5 freezes local/managed parity before later features; managed distribution and advanced self-hosting follow feature completion.
