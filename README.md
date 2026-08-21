# OpenDish

OpenDish is an open-source, AI-first personal recipe manager. It keeps recipes
structured, editable, and versioned while offering optional conversational AI
features through bring-your-own-key (BYOK) credentials.

> **Status:** Active development. The application is not production-ready yet.

## What it includes

- Manual recipe creation, editing, duplication, history, and serving scaling
- Recipe import with a mandatory review step
- Per-recipe AI conversations and reviewable modification proposals
- Conversational recipe generation
- A global shopping list
- Email/password authentication, with optional Google OAuth
- Provider credentials kept server-side through Supabase Edge Functions

Core recipe management is designed to work without an AI provider configured.

## Tech stack

- React, TypeScript, and Vite
- Supabase (Postgres, Auth, Storage, and Edge Functions)
- pnpm workspaces
- Vitest and Playwright

## Repository structure

```text
apps/web/            React frontend
packages/contracts/  Shared domain schemas and contracts
supabase/             Local config, migrations, seed, and Edge Functions
tests/e2e/            Playwright end-to-end tests
specs/                Product specification and implementation plan
```

## Prerequisites

- Node.js 22 or newer
- pnpm 11.18.0 (the pinned package-manager version)
- Docker, for the local Supabase stack

## Local setup

```bash
corepack enable
pnpm install
pnpm setup:local
pnpm dev:local
```

`pnpm setup:local` checks Docker, starts the localhost-only Supabase stack,
resets it to the committed migrations, derives the local URL and publishable
key from the CLI, and writes `apps/web/.env.local` unless that file already
contains a managed profile. If you already use `apps/web/.env.local` for a
managed installation, rerun with `pnpm setup:local -- --backup-managed-env` or
`--force-env`.

Google OAuth is optional. Hosted installations configure it in the Supabase
Dashboard. Local Google OAuth stays disabled by default; enable
`[auth.external.google]` in `supabase/config.toml`, export
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and rerun `pnpm setup:local`.
Never expose provider secrets through `VITE_` variables.

To validate the portable local profile from a fresh clone:

```bash
pnpm verify:local
```

That command runs linting, type-checking, unit tests, pgTAP, and a local smoke
suite for Auth, Storage, Vault-backed AI configuration, and every committed
Edge Function without making live AI calls.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the end-to-end suite separately with `pnpm test:e2e` while its required
services are available.

## Managed Supabase setup

For an installation-owned hosted Supabase project:

```bash
pnpm supabase link --project-ref YOUR_PROJECT_REF
pnpm supabase db push --linked --dry-run
pnpm supabase db push --linked
cp .env.example apps/web/.env.local
pnpm dev
```

Fill `apps/web/.env.local` with that project's URL and publishable key. The
repository never stores a project ref, service-role key, OAuth secret, or AI
credential for the managed profile.

## Product documentation

The approved feature specification, architecture plan, data model, API
contracts, and task breakdown live in [`specs/001-ai-recipe-manager`](specs/001-ai-recipe-manager/).

## License

No license has been selected yet. Add a `LICENSE` file before distributing the
project as open source.
