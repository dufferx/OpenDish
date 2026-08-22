# Phase 1 Data Model: AI-First Personal Recipe Manager

**Feature**: `001-ai-recipe-manager` | **Date**: 2026-08-19 | **Source**: `spec.md` Key Entities + `research.md`

PostgreSQL (Supabase). Every user-owned table carries `user_id uuid not null references auth.users(id)` and an RLS policy `using (auth.uid() = user_id) with check (auth.uid() = user_id)`. Any account accepted by an installation's enabled Auth providers may exist, and those ownership policies are the mandatory cross-user isolation boundary. Email/password is the provider-independent baseline; Google OAuth is optional and there is no schema-level email allowlist. All tables get `created_at`/`updated_at timestamptz not null default now()` (omitted below for brevity).

## Entity-relationship overview

```text
auth.users 1───* recipes *───* tags            (via recipe_tags)
recipes    1───* recipe_ingredients            (ordered)
recipes    1───* recipe_steps                  (ordered)
recipes    1───* recipes (variants)            (source_recipe_id self-FK, ON DELETE SET NULL)
recipes    1───* recipe_history                (JSONB snapshots, ON DELETE CASCADE)
recipes    1───1 conversations                 (unique recipe_id, ON DELETE CASCADE)
conversations 1───* conversation_messages      (ordered)
conversation_messages 1───0..1 modification_proposals
recipes    1───* modification_proposals        (base_version_id staleness check)
auth.users 1───* shopping_list_items
auth.users 1───1 ai_configurations             (metadata only; key in Vault)
recipes    0..1───* shopping_list_items        (source_recipe_id, ON DELETE SET NULL)
```

## Tables

### recipes

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | NOT NULL, FK auth.users |
| title | text | NOT NULL, CHECK length 1–300 |
| description | text | NULL |
| servings | int | NOT NULL, CHECK > 0 |
| prep_time_minutes | int | NULL, CHECK >= 0 |
| cook_time_minutes | int | NULL, CHECK >= 0 |
| image_path | text | NULL — Storage object path only, never binary |
| source_name | text | NULL |
| source_url | text | NULL |
| is_favorite | boolean | NOT NULL default false |
| source_recipe_id | uuid | NULL, FK recipes(id) ON DELETE SET NULL — variant link |
| head_version | bigint | NOT NULL default 1 — incremented on every save; staleness anchor for proposals |
| origin | text | NOT NULL default 'manual', CHECK in ('manual','imported','ai_generated') |

Indexes: `(user_id)`, `(source_recipe_id)`. Full-row ownership via RLS.

### recipe_ingredients

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| recipe_id | uuid | NOT NULL, FK recipes ON DELETE CASCADE |
| position | int | NOT NULL — display/scale ordering |
| name | text | NOT NULL, CHECK length 1–300 |
| quantity_num | int | NULL — numerator; NULL pair = quantity-less ingredient |
| quantity_den | int | NULL — denominator; CHECK > 0; num/den always both NULL or both set (CHECK) |
| unit | text | NULL — free text, e.g. "cup", "g" |

Unique `(recipe_id, position)`. Exact-rational quantity per research R3.

### recipe_steps

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| recipe_id | uuid | NOT NULL, FK recipes ON DELETE CASCADE |
| position | int | NOT NULL, unique with recipe_id |
| text | text | NOT NULL, CHECK length 1–5000 |

### tags / recipe_tags

`tags`: `id`, `user_id`, `name text NOT NULL`, unique `(user_id, lower(name))`.
`recipe_tags`: `(recipe_id, tag_id)` composite PK, both FKs ON DELETE CASCADE.

### recipe_history

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| recipe_id | uuid | NOT NULL, FK recipes ON DELETE CASCADE |
| version | bigint | NOT NULL — the head_version this snapshot was current at |
| snapshot | jsonb | NOT NULL — complete recipe: title, description, servings, times, source, tags, ordered ingredients, ordered steps |
| change_kind | text | NOT NULL, CHECK in ('manual_edit','ai_applied','serving_adjustment','restore','variant_created') |
| created_at | timestamptz | ordering + audit |

Unique `(recipe_id, version)`. Written exclusively by the application-level save path (research R6). Snapshot shape is the Zod `RecipeSnapshot` schema in `packages/contracts` — one authoritative definition.

### conversations

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL |
| recipe_id | uuid | NULL, FK recipes ON DELETE CASCADE, UNIQUE — one thread per recipe; NULL only for pre-save generation threads |
| kind | text | NOT NULL, CHECK in ('recipe','generation') |

### conversation_messages

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| conversation_id | uuid | NOT NULL, FK ON DELETE CASCADE |
| position | int | NOT NULL, unique with conversation_id |
| role | text | NOT NULL, CHECK in ('user','assistant') |
| content | text | NOT NULL |

### modification_proposals

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| conversation_id / message_id | uuid | NOT NULL — the assistant message that presented it |
| recipe_id | uuid | NOT NULL, FK recipes ON DELETE CASCADE |
| base_version | bigint | NOT NULL — recipe.head_version the proposal was generated from |
| operations | jsonb | NOT NULL — validated `ModificationOperations` Zod schema |
| status | text | NOT NULL default 'pending', CHECK in ('pending','applied','variant_created','discarded') |

Stale-apply rule (research R8): apply/variant requires `base_version = recipes.head_version`; otherwise the proposal is reported stale and the UI offers regeneration.

### shopping_list_items

| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL |
| name | text | NOT NULL |
| quantity_num / quantity_den | int | NULL pair — same rational rule as ingredients |
| unit | text | NULL |
| is_purchased | boolean | NOT NULL default false |
| source_recipe_id | uuid | NULL, FK recipes ON DELETE SET NULL — provenance only; items survive recipe deletion |
| servings_used | int | NULL — serving count chosen at add time |
| position | int | NOT NULL — user ordering |

Merging (research R9) happens in domain logic at add time; stored rows are the already-merged result.

### ai_configurations

| Column | Type | Constraints / notes |
|---|---|---|
| user_id | uuid | PK — one configuration per user |
| provider | text | NOT NULL, CHECK in ('openai') — v1 single provider |
| base_url | text | NULL — override for OpenAI-compatible endpoints |
| model | text | NOT NULL |
| vault_secret_name | text | NOT NULL — opaque Vault reference, NOT the key |
| status | text | NOT NULL default 'unverified', CHECK in ('unverified','valid','invalid') |
| last_verified_at | timestamptz | NULL |

The API key itself lives only in `vault.secrets`, written/read exclusively by Edge Functions (service role, server-side). The key is never selectable via PostgREST and never appears in any response.

## Domain invariants enforced in application logic (not just DB)

- Recipe must have ≥ 1 ingredient and ≥ 1 step to save (Zod + UI validation; DB CHECKs cover the scalar rules).
- Every save path (manual edit, AI apply, serving adjustment, restore, variant creation) increments `head_version` and writes a `recipe_history` snapshot of the previous state — one shared domain function, per FR-024.
- Quantity-less ingredients: num/den both NULL; scaling skips them.
- Applying a proposal writes a history entry with `change_kind = 'ai_applied'`; creating a variant writes the new recipe with `origin` unchanged and a history entry on the new row with `change_kind = 'variant_created'`.
- Deleting a recipe: confirmation warns about variants; `source_recipe_id` SET NULL detaches them; history/conversation/proposals cascade with the recipe.

## Migration strategy

All schema changes ship as versioned Supabase migrations (`supabase/migrations/*.sql`), numbered and immutable once applied. RLS policies are part of the same migrations as their tables — a table never exists without its policy. Seed data: none required (owner signs in with Google on first run).
