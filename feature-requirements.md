# Feature Requirements: AI Nutrition and Product Pantry

## Status

Phase C in progress

## Summary

Investigate and define two related personal-use features for OpenDish:

1. AI-assisted nutrition calculation for every recipe, including recalculation
   after edits.
2. A personal product pantry containing nutrition values extracted from product
   labels, so recipes can use real products and produce more precise macros.

## Goals

- Make nutrition and macros a first-class part of the recipe experience.
- Improve precision over generic ingredient estimates by allowing user-owned
  products and nutrition labels.
- Keep AI assistance transparent, editable, and safe when data is incomplete.
- Define an intuitive mobile-first flow before implementation.

## Non-Goals

- No implementation starts until requirements and scope are confirmed.
- No medical, dietetic, or disease-treatment advice.
- No assumption that every recipe can have exact nutrition without complete
  ingredient quantities and product data.

## Users and Entry Points

- Primary user: the owner of a personal OpenDish installation.
- Entry points to investigate: recipe creation, recipe import, recipe editor,
  recipe detail, product pantry, and nutrition label capture.

## Confirmed Facts

- User wants AI-focused macro calculation across the recipe UI.
- User wants nutrition-label capture and reusable personal products.
- User wants products to influence recipe creation and later recalculation.
- User wants this investigation before Phase 12 deployment work.

## Current Code Findings

- `packages/contracts/src/recipe.ts`: `RecipeDraft` currently contains title,
  servings, free-text ingredients (`name`, rational quantity, unit), steps,
  tags, and source fields; it has no nutrition or product reference.
- `supabase/migrations/20260819000001_recipes_core.sql`: recipes and
  recipe_ingredients are user-owned through RLS, but quantities are stored as
  free-form units and there are no product or nutrition tables.
- `apps/web/src/features/recipe-editor/form-schema.ts`: ingredient quantities
  are parsed as exact rational numbers, while units remain free text. This is
  useful for display/scaling but insufficient by itself for converting cups,
  pieces, or spoons into grams.
- `apps/web/src/domain/recipe-save.ts`: all recipe writes share one validated
  save path and previous states are snapshotted in recipe history. Nutrition
  should follow this versioning boundary rather than being an unrelated client
  calculation.
- `apps/web/src/features/recipes/recipe-detail-page.tsx`: servings can be
  adjusted and saved; the detail page is the natural primary nutrition display.
- `apps/web/src/features/recipe-editor/recipe-editor-form.tsx`: ingredients
  currently have only name, quantity, and unit inputs; there is no product
  selector or nutrition feedback state.
- `supabase/functions/_shared/openai-provider.ts`: AI uses text-only structured
  recipe output and validates `RecipeDraft`; the existing recipe image upload
  is a private display image and is not sent to the AI as a label-reading input.
- `apps/web/src/app/router.tsx` and `apps/web/src/app/app-layout.tsx`: there is
  no pantry route or navigation item yet.
- Existing Storage policies are recipe-image-specific; product label images
  would need a separate private bucket/prefix and owner-scoped policies.

## External Evidence

- USDA FoodData Central provides food search and food-details APIs, including
  branded-food data, but requires an API key and applies request limits. It can
  be a useful fallback/reference source, not the sole source for a user's local
  products. See <https://fdc.nal.usda.gov/api-guide/>.
- FoodData Central distinguishes branded label-derived data from analytically
  derived food data, so the product record should preserve its source and
  confidence rather than presenting every value as exact. See
  <https://fdc.nal.usda.gov/data-documentation/>.

## Existing Patterns To Reuse

- `recipeDraftSchema` and `recipeSnapshotSchema`: extend the validated domain
  contract and history snapshot instead of bypassing schema validation.
- `saveRecipeWithStore` and `recipe_history`: use the existing owner-scoped,
  versioned save boundary for recipe nutrition changes.
- `useRecipeDetail` and `useRecipeMutation`: follow the existing query/mutation
  and invalidation patterns for nutrition display and recalculation.
- `validateRecipeImage` and private Storage policies: reuse the image validation
  behavior, but create product-label storage ownership rules separately.
- `AiAvailabilityBanner` and structured AI provider output: use the existing
  BYOK status/error patterns for label extraction and recipe assistance.

## Open Questions

- Which food-data strategy should v1 use for generic ingredients: a curated
  local catalog, a cached external database, or a live external API?
- Should product matching be automatic, user-confirmed, or manual-only when an
  ingredient resembles multiple saved products?
- How should raw-vs-cooked ingredient variants be selected when the source data
  differs materially?

Resolution proposed and accepted for the next phase: use a hybrid catalog with
cached generic records plus private user products; keep raw/cooked variants as
separate selectable records; and request user confirmation when matching is
ambiguous. Live external lookups should enrich the catalog, not run during
every recipe calculation.

## Assumptions

- The first release is personal or small-beta use, not a regulated nutrition
  product.
- Existing mandatory recipe review remains the confirmation point for
  AI-generated nutrition values.
- Nutrition arithmetic will be deterministic after data extraction; AI may
  read labels or suggest matches, but it should not be the final calculator.
- v1 nutrition metrics are calories, protein, and carbohydrates.
- Recipes may be saved with estimated nutrition when some ingredients are not
  matched to a confirmed product.
- Ingredients may be measured using grams/ml or product-label servings.

## Decisions

- Iteration 1: v1 shows calories, protein, and carbohydrates only.
- Iteration 1: recipes can be saved with estimated values when data is
  incomplete; the UI must disclose the estimate state.
- Iteration 1: both canonical mass/volume units and product-label servings are
  supported.

## Candidate Requirements

### R1: Nutrition is a visible, reviewable recipe property

Evidence:

- User decision: user wants macros calculated for every recipe and shown
  throughout the UI.
- Code evidence: recipe contracts and detail/list views currently have no
  nutrition fields.
- User decision: v1 metrics are calories, protein, and carbohydrates.
- Inference: totals should be shown per serving and optionally for the whole
  recipe, with a visible estimate/precision state.

### R2: Nutrition recalculates from recipe state

Evidence:

- User decision: edits and added products must trigger recalculation.
- Code evidence: recipe edits and serving adjustments already pass through a
  shared save/version path.
- Inference: calculations should be derived from the current ingredient and
  product assignments and preserved with recipe versions for reproducibility.

### R3: Users can create private products from nutrition labels

Evidence:

- User decision: user wants to upload a nutrition label, extract values, and
  reuse the product.
- Code evidence: existing private image storage is scoped to recipe images;
  no product entity exists.
- Inference: label extraction must end in a confirmation form before saving.

### R4: Product matching is explicit when confidence is low

Evidence:

- User decision: recipes should use saved products for more precise macros.
- Code evidence: ingredients are currently free text, so automatic matching can
  be ambiguous and lacks a stable product identifier.
- Inference: each ingredient should show its matched product, generic estimate,
  or unresolved state; the user can change the choice.

### R5: Missing precision is communicated honestly

Evidence:

- User decision: macros should be more precise through personal products.
- External evidence: food databases contain different source types and label
  data, and branded values can change.
- Inference: the UI should distinguish verified label values, database values,
  AI estimates, and missing/unconvertible quantities.

### R6: The calculator uses source data plus deterministic arithmetic

Evidence:

- User question: user wants to understand where values such as calories for
  200 g of meat and 100 g of onion come from.
- Code evidence: current recipes have no nutrient source or calculator yet.
- External evidence: USDA FoodData Central exposes food search/details and
  distinguishes branded label-derived data from analytically derived food
  data; values therefore need source/context metadata. See
  <https://fdc.nal.usda.gov/api-guide/> and
  <https://fdc.nal.usda.gov/data-documentation/>.
- Inference: AI should identify or extract the food and context, while a
  deterministic calculator scales nutrient values from a declared basis (for
  example per 100 g or per label serving) and sums ingredients.

## Proposed UX Direction

1. Pantry: `Products` is a first-class destination. Add product → photograph or
   upload label → AI drafts normalized fields → user confirms serving basis and
   nutrient values → save private product.
2. Recipe creation: generate or enter ingredients → review draft → nutrition
   card identifies matched pantry products and unresolved ingredients → user
   confirms matches or selects generic values → save recipe.
3. Recipe editor: each ingredient gets a product/match control. Changing the
   product or amount updates a preview; save performs the authoritative
   recalculation and records the result.
4. Recipe detail: show calories, protein, and carbs per serving first;
   expose whole-recipe totals, data sources, unresolved ingredients, and a
   recalculation action without overwhelming the main recipe view.
5. Mobile: label capture must work from the camera, and confirmation should be
   a short step-by-step form rather than a dense nutrition table initially.

## Nutrition Calculation Model

Nutrition is not obtained from a magic AI lookup. Each ingredient needs a
nutrient record with a declared basis and context:

- Generic food: calories, protein, and carbohydrates per 100 g or 100 ml,
  including raw/cooked variant where relevant.
- Saved product: values per label serving, plus serving mass/volume when the
  label provides it.
- Recipe ingredient: selected food/product, amount, unit, and conversion to
  the source basis when possible.

The deterministic calculation is:

`ingredient nutrient = source nutrient × ingredient basis amount / source basis`

Then the recipe total is the sum of all ingredient nutrients, and per-serving
values are the total divided by the recipe's servings. For example, if a
chosen meat record contains 250 kcal per 100 g, 200 g contributes 500 kcal;
the exact result for onion comes from the selected onion record and its basis.
Those numbers must not be guessed from the ingredient name alone because meat
cut, raw/cooked state, fat percentage, drained weight, and preparation can
change the result materially.

The product label is the preferred source for packaged foods. Generic foods
can use a curated or FoodData Central-backed record, but the UI should call
those values estimates/averages rather than laboratory-exact measurements.

## Implementation Plan

### Phase A: Nutrition domain and data model

- Add validated nutrition contracts for calories, protein, and carbohydrates,
  including source type, basis, raw/cooked context, confidence, and estimate
  status.
- Add generic food records and private user products. A product stores label
  serving values and, when available, grams/ml per serving.
- Extend recipe ingredients with an optional food/product reference and a
  normalized calculation basis while preserving the existing display quantity
  and unit.
- Store the calculated nutrition snapshot with recipe versions so historical
  recipes remain reproducible when a product is later edited.

### Phase B: Deterministic calculation engine

- Implement the calculator as shared domain code, independent of the AI
  provider and UI.
- Convert supported grams/ml and label servings into the selected source basis,
  scale each ingredient, sum the recipe, and divide by servings.
- Return per-ingredient diagnostics for missing matches, ambiguous units, and
  estimates instead of silently inventing values.
- Add tests for scaling, servings, rounding, raw/cooked variants, missing data,
  and product-label overrides.

### Phase C: Product pantry and label capture

- Add a private product-label image flow with owner-scoped Storage policies.
- Send the label image to a vision-capable AI extraction path; treat the result
  as a draft only.
- Require confirmation of product name, serving size, grams/ml per serving,
  calories, protein, and carbohydrates before saving.
- Add product list, create, edit, archive, and detail views.

### Phase D: Recipe integration and UI

- Show nutrition in recipe detail, cards, editor preview, generated-recipe
  review, and saved serving adjustments.
- Add per-ingredient match controls for pantry product, generic food, or
  unresolved/estimated state.
- Recalculate locally on edits for responsiveness, then recalculate and save
  authoritatively through the shared recipe-save path.
- Make estimate status and unresolved ingredients visible wherever totals are
  shown.

### Phase E: Verification and rollout

- Test generic foods, packaged products, mixed sources, unsupported units, and
  recipe edits on mobile and desktop.
- Seed a small curated generic catalog and add a controlled import/cache job for
  FoodData Central records instead of exposing an API key in the browser.
- Release behind a feature flag or beta label, measure correction frequency, and
  expand the catalog only after real usage identifies the highest-value gaps.

## Initial Viability Assessment

- AI label extraction: viable, but requires image-capable input and mandatory
  user confirmation. Existing text-only AI plumbing is not sufficient by
  itself.
- Deterministic macro calculation: viable and preferable, but requires a
  canonical quantity model (especially grams/ml), nutrient basis per serving or
  100 g/ml, and rules for unknown units.
- Pantry: viable as a user-owned CRUD feature with a new migration, contracts,
  Storage policies, route, list, add/edit form, and ingredient matching UI.
- Full “precise macros everywhere” scope is larger than a UI enhancement. It
  should be treated as a focused product phase before deployment, with a small
  MVP that supports calories/protein/carbs and transparent estimates.

## Phase A Implementation Notes

- Added shared Zod contracts for nutrition values, source provenance, basis,
  preparation context, and confirmed/estimated/missing status.
- Added a deterministic calculator that supports grams, kilograms, millilitres,
  litres, and label servings; unsupported units remain unresolved.
- Added `nutrition_foods` and private `user_products` tables with RLS and
  ownership checks, plus nutrition references on recipe ingredients.
- Added recipe nutrition columns and included nutrition/source references in
  the versioned recipe snapshot path.
- Applied migrations `20260826204703_nutrition_foundation` and
  `20260826205108_nutrition_foreign_key_indexes` to the linked Supabase project.
- The UI/pantry workflow and label-image AI extraction remain intentionally
  outside Phase A and are next-phase work.

## Phase C Implementation Notes

- Added the authenticated `/products` route and navigation entry.
- Added mobile-friendly product list, create, edit, and delete flows for
  serving-label values, grams, millilitres, calories, protein, and carbs.
- Product queries derive ownership from the authenticated session and rely on
  Supabase RLS for the final authorization boundary.
- Added an explicit UI placeholder explaining that label-photo extraction is
  not active yet; AI extraction must be added with a mandatory confirmation
  step before it can create products.
- Product creation/editing now opens in a shadcn drawer; Settings remains
  reachable through the header avatar and is no longer duplicated in primary
  navigation.
- Added `ai-extract-product-label`, which accepts a validated base64 image,
  uses the authenticated user's BYOK configuration, and returns a structured
  draft with `requiresConfirmation: true`; it never writes a product itself.
- Connected the drawer's mobile camera/file input to that extraction flow and
  marks returned values as estimated until the user reviews and saves them.
- Deployed the Edge Function to the linked Supabase project and verified the
  authenticated path with `user1@test.com`; a deliberately text-free test
  image reached the provider and was rejected as invalid AI output, as
  expected.

## Phase D Implementation Notes

- Seeded a small generic-food catalog with transparent `estimated` status.
- Added per-ingredient source selectors for generic foods and private user
  products in the recipe editor.
- Recipe saves now calculate calories, protein, and carbohydrates locally and
  persist the result with an explicit confirmed/estimated/incomplete status.
- Added macro summaries to recipe cards and recipe detail; unresolved or
  incompatible ingredients are called out instead of guessed.
- Added a hybrid fallback: known sources are calculated locally, while
  unresolved ingredients can be estimated through the authenticated user's
  BYOK provider. Combined totals are marked estimated; failures remain
  incomplete without blocking recipe saves.

## Candidate Feature: AI assistant in draft review and recipe editor

### Status

In discovery; not approved for implementation yet.

### User Goal

Allow the user to ask the AI to adjust the recipe in two additional places:

1. After AI generation, while the recipe is still a draft and is being
   reviewed.
2. While editing a recipe that has already been saved.

The user should be able to review the proposed changes, see the resulting
macros update, and decide when the recipe is actually saved.

### Verified Current Architecture

- `apps/web/src/features/recipe-conversation/recipe-conversation.tsx` already
  provides a recipe-scoped assistant with answer and modification intents.
- `supabase/functions/ai-recipe-chat/handler.ts` and
  `supabase/functions/ai-propose-modification/handler.ts` require a persisted
  `recipeId` and use the authenticated user's BYOK configuration.
- `packages/contracts/src/modification.ts` defines structured operations and a
  complete resulting `RecipeDraft`.
- `supabase/functions/_shared/recipe-modification.ts` validates the operation
  list and deterministically rebuilds the resulting recipe; the model's copy
  of the resulting recipe is not trusted.
- `apps/web/src/features/modification-review/modification-review.tsx` already
  presents current versus suggested content and supports apply, variant,
  discard, and regeneration states.
- `apps/web/src/features/recipe-import/review-screen.tsx` receives an
  unsaved `RecipeDraft` and passes it to `RecipeEditorForm`; no recipe ID or
  persisted conversation exists at this point.
- `apps/web/src/features/recipe-editor/recipe-editor-page.tsx` owns the saved
  recipe edit form and only writes through the shared mutation when the user
  submits the form.

### Viability Assessment

#### Draft review after AI generation: viable, medium complexity

The current saved-recipe assistant cannot be reused unchanged because the
draft has no database identity. Saving a temporary recipe merely to enable the
assistant would create unwanted records and complicate history and cleanup.

Recommended approach: add an authenticated, stateless preview operation that
accepts the current validated `RecipeDraft` and the user's request, invokes the
existing provider proposal method, validates the operations, and returns a
proposal. The browser keeps the conversation/proposal in local state. Applying
the proposal updates the form locally; it does not write to the database.

#### Saved recipe editor: highly viable, medium complexity

The existing proposal engine and structured operations are a strong fit, but
the editor must not apply changes directly to the database before the user
clicks `Save changes`. The assistant should receive the current unsaved form
values, return a proposal, and on acceptance replace the form values locally.
The normal editor submit then performs the authoritative nutrition calculation,
versioned save, and history snapshot.

Using the detail-page assistant unchanged inside the editor is not recommended:
its current apply action persists immediately and could overwrite or diverge
from other unsaved changes in the form.

### Recommended UX

- Add an `Adjust with AI` action near the draft/editor heading. Open the
  assistant in a drawer so the form remains visible on mobile and desktop.
- Send the complete current draft, including ingredient source references and
  existing nutrition state, as context for each adjustment.
- Show the user's request, a concise summary, a list of operations, and a
  current-versus-suggested preview.
- Use `Apply changes` and `Discard`; applying changes updates only local form
  state until the user saves.
- Recalculate deterministic macros immediately after applying a proposal. If
  the change introduces an unresolved ingredient, retain the transparent
  estimated/incomplete state and offer the existing AI estimation action.
- Preserve pantry product selections unless the user explicitly asks to
  change a product or ingredient source.
- Keep the existing BYOK availability, loading, error, retry, and request
  length behavior.

### Recommended Technical Shape

Create a reusable “recipe draft modification preview” path rather than
duplicating prompt or validation logic:

- Shared input/output contract for `RecipeDraft` plus a bounded user request.
- Authenticated Edge Function with no recipe write and no requirement for a
  persisted `recipeId`.
- Reuse `proposeRecipeModification`, `modificationOpSchema`,
  `applyModificationOperations`, and `validateModificationProposal`.
- For the draft review and editor, calculate macros from the accepted local
  draft using the existing deterministic calculator. Do not ask the AI to be
  the nutrition source of truth.
- Keep the existing recipe-scoped conversation/proposal workflow for the
  detail page, where persistence and optimistic `headVersion` checks are
  appropriate.

### Risks and Required Safeguards

- Draft payloads and user instructions are untrusted input; validate size and
  schema at the Edge Function boundary and keep provider output structured.
- A proposal must be applied deterministically from operations, never by
  trusting free-form model output.
- Editor proposals must be based on the latest form state, including unsaved
  edits, or the UI could silently revert user changes.
- Nutrition must be recalculated after accepted operations, including serving
  changes, ingredient additions/removals, and pantry-source changes.
- Saved-recipe proposals still need the existing stale-version protection.

### Scope and Validation Needed Before Implementation

- Define whether the draft/editor assistant should show only a single pending
  proposal or retain a local multi-turn conversation.
- Add contract and Edge Function tests for valid/invalid drafts, provider
  failures, operation validation, and no-write behavior.
- Add web tests for opening the drawer, applying/discarding changes, preserving
  source selectors, syncing form state, and recalculating macros.
- Verify the full flow on mobile and desktop, including AI unavailable,
  loading, retry, and unsaved-change states.

### Open Decisions

1. Should draft/editor changes always use the same proposal review UI as saved
   recipes, or can the user opt into direct local application for simple
   requests?
2. Should the assistant keep a local conversation after each accepted change,
   or should each request start from the latest form state with only the
   visible current interaction retained?
3. Should an accepted AI change automatically run the existing AI nutrition
   fallback when local calculation has unresolved ingredients, or only offer
   the explicit `Calculate macros with AI` action?

### Confirmed Decisions

- Draft and editor changes always require review before applying.
- The assistant keeps a local multi-turn conversation; every request uses the
  latest local draft as context and no conversation is persisted before save.
- Accepted changes recalculate macros locally. AI macro estimation remains an
  explicit user action when ingredients are unresolved, avoiding unexpected
  API calls and latency.

### Phase D.5 Implementation Notes

- Added the authenticated `ai-preview-modification` Edge Function. It accepts
  a validated draft and request, returns a structured proposal, performs no
  recipe or conversation write, and reuses deterministic proposal validation.
- Added a local multi-turn `Adjust with AI` drawer to generated-recipe review
  and saved-recipe editing. Accepted proposals update only the form; the
  existing save action remains the persistence boundary.
- Named the recipe assistant mascot `Dishy` throughout the AI surfaces.
- Reused the existing modification review component while hiding the
  saved-recipe-only variant action in local draft flows.
- Verified with full typecheck, web tests (209 passed, 20 skipped), Edge
  Function tests (137 passed), lint, and production build.
