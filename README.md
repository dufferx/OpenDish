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
- Single-owner authentication
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
cp .env.example apps/web/.env.local
pnpm supabase start
pnpm dev
```

Fill `apps/web/.env.local` with the local Supabase URL and public key printed by
`pnpm supabase start`. Keep provider and OAuth secrets in
`supabase/functions/.env` for local development; both files are ignored by Git.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the end-to-end suite separately with `pnpm test:e2e` while its required
services are available.

## Product documentation

The approved feature specification, architecture plan, data model, API
contracts, and task breakdown live in [`specs/001-ai-recipe-manager`](specs/001-ai-recipe-manager/).

## License

No license has been selected yet. Add a `LICENSE` file before distributing the
project as open source.
