# Implementation Plan: Cooking Mode

## Source Requirements

- `cooking-mode-requirements.md`

## Repo Rules Applied

- Follow the repository guidance in `AGENTS.md` supplied for this workspace.
- Preserve the existing authenticated Supabase/RLS recipe boundary.
- Reuse existing React Router, React Query, shared contracts, form, and Vitest
  patterns.
- Keep timer correctness in pure local domain code and avoid an external timer
  service or database session table.
- Use `apply_patch` for source edits and run the repository validation commands
  before handoff.

## Scope

Included:

- `Cook` entry point from saved recipe detail.
- Dedicated `/recipes/:id/cook` route with a viewport-height cooking shell.
- One-step-at-a-time navigation, progress, exit, completion, and resume.
- Optional persisted step duration metadata populated manually or suggested by
  AI and confirmed by the user.
- Local timestamp-based timers that continue across step changes and refreshes.
- Visual timer completion with best-effort sound/vibration, without requiring
  system notification permissions.
- Contract, migration, save/query, editor, domain, route, and UI tests.

Excluded:

- Cross-device cooking-session synchronization.
- Voice control, wake word, smart-home integration, and required native
  notifications.
- Automatic recipe mutation from cooking mode.
- Native browser Fullscreen API as a requirement.

## Requirement Traceability

| Requirement | Implementation Step(s)                                                                                       | Validation                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| R1          | Add `Cook` action and `/recipes/:id/cook` route using the existing recipe query.                             | Route/detail Vitest test and mobile browser test             |
| R2          | Add cooking-mode layout detection in `AppLayout` and full-viewport shell styles.                             | Responsive browser test and layout test                      |
| R3          | Add cooking page state for current step, progress, previous/next, and finished state.                        | Component interaction tests                                  |
| R4          | Add optional duration display, explicit start/pause/resume/reset controls, and active timer indicator.       | Timer/domain and component tests                             |
| R4a         | Extend step contract, AI JSON schema, editor form, save/query mappings, and database with nullable duration. | Contract, migration/integration, AI schema, and editor tests |
| R5          | Implement absolute-end-time timer calculations and visibility refresh handling.                              | Fake-clock tests including background-delay simulation       |
| R6          | Persist only local session state keyed by recipe ID; never write recipe/history from cooking mode.           | Storage/session tests and browser verification               |

## Patch-Oriented Plan

1. Update `packages/contracts/src/recipe.ts` and related contract tests.
   - Requirements: R4a.
   - Change: add nullable positive `durationSeconds` to `Step` and preserve it
     through `RecipeDraft` and `RecipeSnapshot`.
   - Update `packages/contracts/src/modification.ts` so an AI step update can
     change or clear the optional duration while retaining text updates.
   - Update `packages/contracts/src/apply-modification.ts` to preserve and
     deterministically apply step duration changes.
   - Do not change the minimum step count or make duration required.
   - Validation: contract schema, modification application, and backward
     compatibility tests for steps without duration.

2. Add `supabase/migrations/20260828141334_cooking_step_durations.sql`.
   - Requirements: R4a.
   - Change: add nullable `recipe_steps.duration_seconds` with a positive-value
     check; leave existing rows as `NULL`.
   - Do not add cooking-session rows, notification permissions, or new RLS
     surfaces.
   - Validation: migration apply/test and existing RLS checks.

3. Update `apps/web/src/domain/recipe-save.ts` and its tests.
   - Requirements: R4a, R6.
   - Change: include `durationSeconds` in stored step row types, snapshot
     construction, reads, and replace-step inserts.
   - Keep recipe history snapshots compatible so duration changes are restored
     with the recipe version.
   - Validation: recipe-save unit/integration tests and typecheck.

4. Update AI structured output in `supabase/functions/_shared/openai-provider.ts`
   and function/contract fixtures.
   - Requirements: R4, R4a.
   - Change: permit optional nullable `durationSeconds` in the step JSON schema
     and instruct generation/extraction/modification prompts to suggest a
     duration only when the text clearly expresses a waiting/cooking time.
   - The provider output remains a suggestion; the editor must expose the value
     for confirmation before save.
   - Validation: provider schema tests, generation/extraction fixtures, and
     modification validation tests.

5. Update editor conversion and controls:
   - `apps/web/src/features/recipe-editor/form-schema.ts`
   - `apps/web/src/features/recipe-editor/recipe-editor-form.tsx`
   - `apps/web/src/features/recipe-editor/recipe-editor-page.tsx`
   - `apps/web/src/features/recipe-import/draft-to-form-values.ts`
   - `apps/web/src/features/recipe-import/review-screen.tsx`
   - Requirements: R4, R4a.
   - Change: add an optional duration input per step with clear units and
     validation; show AI-suggested values as editable reviewable fields; pass
     accepted duration metadata through generated/imported and edited saves.
   - Preserve current drag/reorder, add/remove, validation, and nutrition
     behavior.
   - Validation: editor form tests for blank, valid, invalid, clear, reorder,
     generated draft, and persisted edit values.

6. Update `apps/web/src/features/recipes/recipe-queries.ts` and
   `apps/web/src/features/recipes/recipe-detail-page.tsx`.
   - Requirements: R1, R4a.
   - Change: expose step durations in `RecipeDetail`, display a compact duration
     hint beside applicable steps, and add the `Cook` action beside existing
     recipe actions.
   - Do not start timers from the detail page or mutate recipe data from the
     action.
   - Validation: detail-page rendering and navigation tests.

7. Add pure timer/session modules:
   - `apps/web/src/domain/cooking-timer.ts`
   - `apps/web/src/domain/cooking-timer.test.ts`
   - `apps/web/src/features/cooking-mode/cooking-session.ts`
   - `apps/web/src/features/cooking-mode/cooking-session.test.ts`
   - Requirements: R4, R5, R6.
   - Change: implement a timestamp-based timer state machine for idle,
     running, paused, and complete; derive remaining seconds from `endsAt`;
     preserve paused remaining seconds; serialize/parse a versioned local
     session keyed by recipe ID.
   - Define safe behavior for corrupt storage, recipe step-count changes, and
     expired sessions.
   - Do not use an interval decrement as the source of truth.
   - Validation: deterministic fake-clock tests, pause/resume/reset tests,
     step-change tests, storage round-trip and corrupt-data tests.

8. Add the cooking feature UI:
   - `apps/web/src/features/cooking-mode/cooking-mode-page.tsx`
   - `apps/web/src/features/cooking-mode/cooking-mode-shell.tsx`
   - `apps/web/src/features/cooking-mode/cooking-mode.test.tsx`
   - `apps/web/src/features/cooking-mode/index.ts`
   - Requirements: R2, R3, R4, R5, R6.
   - Change: load the recipe, restore local session, render one step, progress,
     large touch controls, active timer indicator, timer controls, exit, and
     completion state.
   - Keep timer active when navigating to another step; do not auto-advance at
     zero. Trigger best-effort sound/vibration only when supported and without
     blocking completion.
   - Include loading, not-found/error, one-step, long-text, refresh, and active
     timer states.
   - Validation: component tests with fake timers and mobile/desktop browser
     flows.

9. Update `apps/web/src/app/router.tsx` and `apps/web/src/app/app-layout.tsx`.
   - Requirements: R1, R2.
   - Change: register `/recipes/:id/cook`, render `CookingModePage`, and hide
     normal header/mobile navigation for the cooking route while preserving
     authenticated routing and browser back behavior.
   - Do not create a second authentication or recipe-fetching boundary.
   - Validation: route tests, layout tests, refresh/deep-link test.

10. Update documentation and test fixtures.
    - Requirements: all.
    - Change: update `cooking-mode-requirements.md` implementation notes and
      any recipe fixtures to cover optional durations without making existing
      fixtures verbose.
    - Validation: `prettier --check`, full typecheck, lint, all package tests,
      migration verification, and manual browser testing on mobile-sized and
      desktop-sized viewports.

## Files and Modules

### New

- `supabase/migrations/20260828141334_cooking_step_durations.sql`
- `apps/web/src/domain/cooking-timer.ts`
- `apps/web/src/domain/cooking-timer.test.ts`
- `apps/web/src/features/cooking-mode/cooking-session.ts`
- `apps/web/src/features/cooking-mode/cooking-session.test.ts`
- `apps/web/src/features/cooking-mode/cooking-mode-page.tsx`
- `apps/web/src/features/cooking-mode/cooking-mode-shell.tsx`
- `apps/web/src/features/cooking-mode/cooking-mode.test.tsx`
- `apps/web/src/features/cooking-mode/index.ts`

### Modified

- `packages/contracts/src/recipe.ts`
- `packages/contracts/src/modification.ts`
- `packages/contracts/src/apply-modification.ts`
- `packages/contracts/src/recipe.test.ts`
- `packages/contracts/src/apply-modification.test.ts`
- `supabase/functions/_shared/openai-provider.ts`
- `apps/web/src/domain/recipe-save.ts`
- `apps/web/src/features/recipe-editor/form-schema.ts`
- `apps/web/src/features/recipe-editor/recipe-editor-form.tsx`
- `apps/web/src/features/recipe-editor/recipe-editor-page.tsx`
- `apps/web/src/features/recipe-import/draft-to-form-values.ts`
- `apps/web/src/features/recipe-import/review-screen.tsx`
- `apps/web/src/features/recipes/recipe-queries.ts`
- `apps/web/src/features/recipes/recipe-detail-page.tsx`
- `apps/web/src/app/router.tsx`
- `apps/web/src/app/app-layout.tsx`
- related existing tests and fixtures

## Testing and Validation

Run from the repository root:

```bash
pnpm -s typecheck
pnpm -s lint
pnpm test
pnpm exec prettier --check .
pnpm --filter @opendish/web build
```

Additional validation:

- Apply and verify the new Supabase migration in the linked/local project.
- Test an old recipe with no duration metadata.
- Test AI-suggested duration confirmation, manual entry, edit, clear, and
  save.
- Test timer pause/resume/reset, step changes, refresh, tab backgrounding, and
  expiration.
- Test mobile viewport safe areas and desktop layout.

## Plan Critique

- Requirements without implementation steps: none identified.
- Implementation steps without requirements: none; sound/vibration is tied to
  the confirmed completion behavior and remains best-effort.
- Risks not covered: browser-specific audio/vibration restrictions and schema
  migration compatibility; both have explicit fallback/legacy tests.
- Scope creep risk: AI duration detection and browser notifications could grow
  significantly; the plan limits AI to optional suggestions and excludes
  required system notifications.
- Test gaps: real device audio/vibration behavior cannot be fully guaranteed by
  Vitest and requires manual mobile verification.

## Risks and Mitigations

- AI confuses quantities or temperatures with durations: require structured
  optional output plus user confirmation and manual correction.
- Background JavaScript throttling causes countdown drift: derive from absolute
  timestamps and recompute on visibility changes.
- Existing recipes lack duration data: nullable migration and no-duration UI
  path keep them fully usable.
- Fullscreen behavior differs by browser: use a route-level viewport shell and
  do not require the Fullscreen API.
- A timer is lost on refresh: versioned recipe-keyed local storage with safe
  parsing and resume UI.
- Sound/vibration is blocked: visible completion state remains authoritative.

## Rollback

- Revert the application patch and route while retaining the nullable migration
  if already deployed; the column is additive and harmless to old code.
- If the feature is disabled, remove the `Cook` entry point and route exposure;
  normal recipe detail/editor flows continue unchanged.
- Do not delete local session data automatically; stale cooking-session keys can
  be ignored by the versioned parser and cleaned up in a later maintenance
  change.
