# Feature Requirements: Cooking Mode

## Status

Requirements Closed

## Summary

Add a focused cooking mode for a saved recipe. The user starts it from the
recipe detail view, the app occupies the available screen, and the user moves
through the recipe one preparation step at a time. Steps that involve waiting
can expose a timer so the user can cook without repeatedly returning to the
normal recipe page.

## Goals

- Make recipes practical to follow while cooking, especially on a phone.
- Show one step at a time with clear progress and large, touch-friendly
  controls.
- Let users start, pause, resume, reset, and complete timers without losing
  their current step.
- Keep the cooking session lightweight and local; the user should not need to
  save changes to the recipe to use this mode.
- Preserve the existing recipe data and provide a reliable way to exit and
  resume the session.

## Non-Goals

- No changes to the saved recipe content or recipe history from cooking mode.
- No requirement to keep a cooking session synchronized across devices.
- No background notification system in the first version unless browser and
  platform support is explicitly chosen as part of scope.
- No automatic claim that every step with a number is a cooking duration; step
  text can contain quantities that are not timers.
- No voice control, hands-free wake word, or smart-home integration in the
  first version.

## Users and Entry Points

- Primary user: an authenticated OpenDish user cooking from a saved recipe.
- Primary entry point: a `Cook` button on the recipe detail page.
- Resume entry point: the same recipe detail page when a local cooking session
  exists for that recipe.
- The mode must work at mobile widths and remain usable on desktop.

## Confirmed Facts

- User wants a button that starts a cooking mode.
- User wants the mode to occupy the full screen and show steps sequentially.
- User wants timers for steps that require time.
- The feature is being evaluated before implementation; no implementation has
  started for this feature.

## Current Code Findings

- `apps/web/src/features/recipes/recipe-detail-page.tsx` already renders the
  saved recipe title, servings, ingredients, ordered steps, and actions. It is
  the natural location for the `Cook` entry point.
- The detail page renders steps from `recipe.steps` in their stored order, so
  cooking mode can reuse the existing ordered step data without a migration.
- `apps/web/src/features/recipes/recipe-queries.ts` provides the authenticated
  `RecipeDetail` query and cache. A cooking route can use the same query and
  owner/RLS boundary.
- `apps/web/src/app/router.tsx` uses React Router and already has nested
  recipe routes. A dedicated `/recipes/:id/cook` route can provide a full-page
  mode while preserving browser back behavior.
- `apps/web/src/app/app-layout.tsx` always renders the header and mobile bottom
  navigation around the outlet. A visually full-screen cooking mode therefore
  needs an explicit layout variant or a route-level full-bleed container that
  hides those navigation elements.
- `apps/web/src/domain/scaling.ts` contains pure, local recipe scaling logic;
  no timer or cooking-session domain module currently exists.
- A source search found no existing timer, countdown, Fullscreen API, wake-lock,
  or notification implementation in the web app. The only timer-like code is
  request/debounce timeout handling and is not reusable as a cooking timer.
- `apps/web/src/features/recipe-editor/form-schema.ts` and the recipe
  contracts represent preparation steps as free-text `{ text }` values. There
  is currently no structured duration attached to a step.
- `supabase/migrations/20260819000001_recipes_core.sql` stores each step with
  `position` and `text`; an optional `duration_seconds` column can be added
  compatibly without changing the step ordering model.
- `apps/web/src/components/ui/drawer.tsx` and `dialog.tsx` establish the
  existing overlay conventions, but a route-level screen is better suited to
  a sustained cooking session than a drawer.
- `apps/web/package.json` already provides Vitest and the existing web test
  setup; no new dependency is required for a basic local timer.

## Existing Patterns To Reuse

- `RecipeDetailPage` and `useRecipeDetail`: load the same authenticated recipe
  and preserve existing error/loading behavior.
- `router.tsx` and `AppLayout`: add a dedicated cooking route and a layout
  treatment that removes normal navigation while cooking mode is active.
- `recipe.steps` ordering and `formatQuantity`: reuse stored content and
  display conventions instead of creating a second recipe representation.
- Existing `Loading`, `ErrorState`, `Button`, `Card`, and icon components for
  consistent states and accessible controls.
- Existing Vitest patterns in recipe feature tests for route rendering,
  keyboard interaction, and fake timers.

## Requirements

### R1: Start cooking mode from recipe detail

Evidence:

- User decision: the mode starts from a cooking button.
- Code evidence: `recipe-detail-page.tsx` owns saved-recipe actions and steps.
- Inference: the button should navigate to a dedicated cooking route so the
  browser back button and refresh behavior have predictable semantics.

### R2: Cooking mode is visually focused and full-screen

Evidence:

- User decision: cooking mode should occupy the complete screen.
- Code evidence: `AppLayout` currently wraps every route with header and
  mobile navigation.
- Inference: “full-screen” should initially mean an app-level full-viewport
  route with hidden OpenDish navigation, not depend on the browser Fullscreen
  API, which is inconsistent across mobile browsers and requires a user
  gesture.

### R3: Show one step at a time with progress

Evidence:

- User decision: steps should be shown sequentially.
- Code evidence: recipe steps are already stored as an ordered array.
- Inference: the screen should show the current step number, total progress,
  step text, and previous/next controls. Completing the final step should
  provide a clear finished state rather than silently leaving the mode.

### R4: Provide optional timers for time-based steps

Evidence:

- User decision: steps that need time should support a timer.
- Code evidence: steps are free text and no structured duration field exists.
- Inference: v1 should support a user-started timer attached to the current
  step, with a duration stored on the step when available and entered/edited by
  the user when needed. The timer must not start solely because a number appears
  in the step.

### R4a: Store optional step durations

Evidence:

- User decision: automatic AI suggestions and manual entry should both be able
  to save a time on each instruction, while the field remains optional.
- Code evidence: `stepSchema` currently validates only `text`, and
  `recipe_steps` currently persists only `position` and `text`.
- Inference: add nullable `durationSeconds` to the shared step contract and a
  nullable database column. AI generation/extraction may populate it, while
  manual editing can override, clear, or add it.

### R5: Timer state is accurate while the page is backgrounded

Evidence:

- Code evidence: no current timer implementation exists.
- Inference: calculate remaining time from an absolute end timestamp rather
  than decrementing a counter once per interval. This remains accurate when a
  browser throttles background JavaScript; the UI can refresh on a short local
  interval when visible.

### R6: Cooking sessions are local and non-destructive

Evidence:

- User goal: cooking mode is a way to follow a recipe, not edit it.
- Code evidence: recipe detail already loads immutable recipe data through the
  existing query and save actions are explicit.
- Inference: keep current step, timer state, and completion state in local
  browser state/storage keyed by recipe ID. Do not create database rows or
  modify recipe history in v1.

## Recommended UX Direction

1. Add a prominent `Cook` button beside the existing recipe actions.
2. Navigate to `/recipes/:id/cook` and render a viewport-height cooking shell
   without the normal header or bottom navigation.
3. Show a compact top bar with recipe title, `Step X of Y`, and `Exit`.
4. Show the current step in a large readable card with `Previous` and `Next`
   controls fixed near the bottom for thumb reach.
5. If a duration is stored or manually configured, show `Start timer` as an
   optional action. When running, show remaining time, pause/resume, reset, and
   a completion state.
6. Ask for or allow confirmation of an AI-suggested duration before saving or
   starting it. Manual durations can be saved directly but remain optional.
7. Preserve the session on accidental refresh or navigation using local
   storage, but make `Exit` return to the recipe detail page.
8. Keep screen orientation, wake lock, and notifications out of the first
   implementation unless testing shows they are necessary for the user's
   device.

## Timer Model Recommendation

Use a local state model with:

- `recipeId`
- `currentStepIndex`
- optional `timer.durationSeconds`
- optional `timer.endsAtEpochMs`
- `timer.status`: idle, running, paused, or complete
- optional `timer.remainingSeconds` when paused

When running, remaining time is derived from `endsAtEpochMs - Date.now()`.
When paused, store the calculated remaining duration. This avoids drift from
interval throttling and makes resume behavior deterministic. A timer reaching
zero should remain visible as complete and should not automatically advance to
the next step.

## Data, State, API, and Permissions

- If stored step durations are included in v1, one backward-compatible database
  migration is required, plus contract/save/query/editor updates. No new API or
  external service is required.
- Recipe content is read through the existing authenticated recipe query and
  remains subject to the existing RLS boundary.
- Cooking progress and timer state are client-local. If persisted, use a
  namespaced local-storage key containing only recipe ID and session state.
- No API key, AI call, or external service is required for the basic mode.
- AI-assisted duration detection must be treated as a suggestion requiring user
  confirmation before it is saved or used to start a timer.

## UX States and Edge Cases

- Loading: show a focused loading state while the recipe is fetched.
- Error/not found: reuse the existing recipe error and retry/back navigation.
- Empty steps: this should be impossible under the current recipe contract;
  fail safely with a message and exit action if encountered.
- One-step recipe: hide or disable `Previous` and keep completion clear.
- Long step text: preserve readability and allow scrolling without losing
  fixed navigation controls.
- Timer paused: preserve the remaining time when the user changes steps; the
  active timer remains globally visible and can be resumed from its indicator.
- Timer reaches zero: show an unmistakable completed state, with sound or
  vibration when supported; do not auto-advance.
- Refresh or accidental route change: restore the local session when present.
- Multiple recipes/tabs: key local state by recipe ID and never mix sessions.
- Browser backgrounding: derive time from timestamps; do not rely on an active
  interval for correctness.
- Device sleep or browser suspension: on visibility return, recompute the
  timer and show whether it elapsed; platform notifications are not guaranteed
  in v1.
- Exit with an active timer: do not silently discard it; preserve it locally
  and explain that it can be resumed from the recipe's `Cook` entry point.

## Acceptance Matrix

| Requirement | Acceptance Criteria                                                                                                                                                  | Test/Validation                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| R1          | Given a saved recipe, when the user taps `Cook`, then the cooking route opens with the same recipe steps.                                                            | Web route test and mobile browser test |
| R2          | Given cooking mode is open, then header/bottom recipe navigation is hidden and the content uses the viewport safely on mobile and desktop.                           | Responsive browser test                |
| R3          | Given step N is visible, then progress and step text are shown and Previous/Next move exactly one step without changing the recipe.                                  | Vitest interaction test                |
| R4          | Given a step with a suggested duration, then the user can review/edit it and explicitly start a timer; a numeric ingredient quantity does not auto-start a timer.    | Vitest timer/interaction tests         |
| R5          | Given a running timer and a delayed UI tick/background transition, then the displayed remaining time is based on the timestamp and does not drift by interval count. | Fake-timer/unit test                   |
| R6          | Given the user exits or refreshes, then no recipe content/history is modified and the local session is restored according to the selected resume behavior.           | Browser test plus storage-state test   |

## Assumptions

- The first version is for the existing authenticated web app and does not
  need cross-device synchronization.
- A visible in-app full-viewport route is sufficient; native browser fullscreen
  is not required for the first release.
- The user prefers explicit timer confirmation over automatic countdowns.

## Open Questions

1. Resolved: support both AI-suggested durations and manual entry, storing a
   nullable duration on each step. AI values require confirmation; manual
   values are optional.
2. Resolved: an active timer continues globally when the user changes steps and
   remains visible through an active-timer indicator.
3. Resolved: timer completion shows a visible signal and may use sound or
   vibration where supported, without depending on system notifications.

## Decisions

- Iteration 1: use a dedicated full-viewport application route rather than
  relying on the browser Fullscreen API.
- Iteration 1: keep cooking progress and timers local; do not add database
  persistence or an API.
- Iteration 1: timers are explicit and must not start automatically.
- Iteration 1: support both AI-suggested and manually entered optional step
  durations, persisted as nullable step metadata. AI suggestions require user
  confirmation before saving or starting.
- Iteration 1: an active timer continues when the user changes steps and is
  represented by a persistent active-timer indicator.
- Iteration 1: timer completion uses a visible signal and may use sound or
  vibration when supported, but does not depend on system notifications.

## Initial Viability Assessment

- Core cooking mode: highly viable, medium complexity. It can reuse existing
  recipe queries and ordered steps; stored durations add one backward-compatible
  database migration and save/query updates.
- Full-viewport presentation: viable. A route/layout variant is more reliable
  than the browser Fullscreen API across mobile browsers.
- Local timers: highly viable and dependency-free. Timestamp-based calculation
  handles background throttling better than a decrementing interval.
- Stored optional step durations: viable and recommended, medium complexity.
  It requires a nullable field in the contracts/database and propagation
  through AI schemas, editor forms, save snapshots, and recipe display, but it
  avoids repeated unreliable text parsing and makes cooking mode predictable.
- Automatic duration detection: viable as a suggestion, but AI output must be
  confirmed because numbers can represent quantities, temperatures, or
  durations. It can be implemented in the same feature without blocking a
  recipe that has no duration metadata.
- Background alerts: possible but not uniformly reliable on mobile web. Sound,
  vibration, and notifications should remain optional until the target devices
  are tested.

## Definition of Ready Check

- [x] Scope and non-goals are explicit.
- [x] Material product decisions are resolved for the current scope.
- [x] Assumptions are limited to three and none block the core behavior.
- [x] Current architecture and reusable patterns are documented.
- [x] Timer and duration behavior is defined.
- [x] Initial acceptance criteria and validation approach are testable.
- [x] Requirements are ready to be marked closed after user confirmation.
