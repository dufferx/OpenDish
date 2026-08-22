# Quickstart: Supported Installation Profiles

**Feature**: `001-ai-recipe-manager` | **Updated**: 2026-08-21

OpenDish uses one frontend, one migration chain, and one Edge Function source tree across supported environments. Choose either fully local or managed Supabase. Permanent production self-hosting is an advanced post-feature phase and is not the same as the CLI local stack.

Phase 8.5 now ships reproducible local-profile scripts. The commands below are the supported paths they automate.

## Shared prerequisites

- Node.js 22 or newer
- pnpm 11.18.0
- Dependencies installed with `pnpm install`
- Optional OpenAI-compatible API credentials for AI features; non-AI features require none

The real frontend environment belongs in ignored `apps/web/.env.local`. Never expose a service-role/secret key, database password, OAuth secret, or AI credential through a `VITE_` variable.

## Path A: Fully local

Use this path to develop, evaluate, or personally run OpenDish on the same computer without a Supabase Cloud project or Google OAuth client.

Additional prerequisite: Docker or a Docker-compatible runtime.

```bash
# Check Docker, start local Postgres/Auth/Storage/Vault/Studio/Mailpit,
# rebuild from committed migrations, and generate apps/web/.env.local from the
# CLI-reported localhost URL and publishable key.
pnpm setup:local

# Start the frontend against the local profile.
pnpm dev:local
```

Email/password is the provider-independent baseline. Mailpit captures local
Auth email traffic without sending real email. Google OAuth is optional and
disabled by default locally; when needed, export
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, set
`[auth.external.google].enabled = true` in `supabase/config.toml`, and rerun
`pnpm setup:local`. Its secret is never a `VITE_` variable.

The CLI stack is localhost-only. It has development credentials and lacks production hardening such as public TLS and operator-managed recovery. Do not expose it to external traffic.

## Path B: Managed Supabase

Use this path for the maintainer's personal production installation or for an independent third-party Cloud installation.

Additional prerequisites: an installation-owned Supabase project, Supabase CLI authentication, and the project's database password.

```bash
# Associate this checkout with the operator's own project.
pnpm supabase link --project-ref YOUR_PROJECT_REF

# Preview, then apply only pending committed migrations.
pnpm supabase db push --linked --dry-run
pnpm supabase db push --linked

# Deploy the committed Edge Functions.
pnpm supabase functions deploy --project-ref YOUR_PROJECT_REF

# Copy the template and configure the managed project URL/publishable key.
cp .env.example apps/web/.env.local

# Run the frontend locally while validating the managed backend.
pnpm dev
```

Configure enabled Auth providers, redirect URLs, and function secrets in the installation-owned project. Email/password remains the baseline; Google OAuth is optional. The repository must never hard-code the maintainer's project ref or credentials.

## Daily validation commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Vite frontend using `apps/web/.env.local` |
| `pnpm dev:local` | Start the Vite frontend after validating the local CLI profile |
| `pnpm build` | Build the static frontend |
| `pnpm lint` / `pnpm format:check` | Lint and formatting checks |
| `pnpm typecheck` | Strict TypeScript checking |
| `pnpm test` | Unit/component/function tests with deterministic AI doubles |
| `pnpm test:e2e` | Critical browser flows when required services are available |
| `pnpm setup:local` | Refresh the localhost Supabase profile and regenerate `apps/web/.env.local` safely |
| `pnpm smoke:local` | Fresh local smoke suite for Auth, Storage, Vault, pgTAP, and Edge Functions |
| `pnpm verify:local` | Full local validation gate from a fresh clone |
| `pnpm supabase db reset --local` | Rebuild only the local database from migrations |
| `pnpm supabase functions serve` | Serve Edge Functions locally |

Automated tests make zero live AI calls. The local smoke suite uses a local
OpenAI-compatible stub to cover Vault-backed AI config and every committed Edge
Function without a Supabase Cloud account.

## Advanced self-hosted profile

Phase 13 will document a version-pinned official Supabase Docker Compose deployment for permanent operator-owned infrastructure. It must include TLS, generated secrets, SMTP, persistent Storage, backups/restores, monitoring, upgrades, rollback, and a compatibility matrix. Until that phase passes, OpenDish does not claim supported production self-hosting.
