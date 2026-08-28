# Feature Specification: AI-First Personal Recipe Manager

**Feature Branch**: `001-ai-recipe-manager`

**Created**: 2026-08-19

**Status**: Approved

**Input**: User description: "Build the initial version of an open-source, AI-first personal recipe manager: a modern digital recipe book with an integrated conversational cooking assistant, where each recipe is a structured, editable, versioned entity the user can interact with through a dedicated conversation. Core flow: create or import a recipe, save it, open it, ask the AI to modify it, review the proposed changes, save the result, and use the ingredients in a shopping list. BYOK AI configuration; core recipe management must work without AI."

## Clarifications

### Session 2026-08-19

- Q: How should the single-user v1 handle authentication and ownership? → A: **Superseded on 2026-08-21** — the original decision was one owner-configured login; the later portability decision below removes the mandatory owner allowlist and makes RLS-isolated accounts the active requirement.
- Q: How many AI providers must work in v1? → A: **One provider** — exactly one functional provider integration, with provider-specific code isolated so others can be added later.
- Q: Which organization mechanism should v1 use? → A: **Tags only** — free-form tags per recipe, plus favorites and search; no categories or collections in v1.
- Q: How should per-recipe conversations work in v1? → A: **One thread per recipe** — each recipe has exactly one persistent conversation that grows over time.
- Q: Which changes must create a recoverable history entry? → A: **Every saved change** — manual edits, AI-applied modifications, and explicitly saved serving adjustments all create history entries; temporary serving display changes never do.
- Q: What happens to variants when their source recipe is deleted? → A: **Variants become independent** — they convert to standalone recipes (losing only the source link), with the user warned in the deletion confirmation.
- Q: What are the language expectations for v1? → A: **English UI, any content** — the UI ships English-only; recipe content, tags, and AI conversations may be in any language.
- Q: One shopping list or multiple named lists? → A: **One list** — a single global shopping list per installation.

### Session 2026-08-21

- Q: Should an installation be restricted to one configured owner email? → A: **No mandatory allowlist** — any account accepted by an enabled Auth provider may sign in, and RLS isolates every account's data. An operator may place separate access controls around a private deployment, but the OpenDish schema and Auth flow do not require a single owner email.
- Q: Must operators use Supabase Cloud? → A: **No** — the same repository supports a managed Supabase project or a localhost-only Supabase CLI stack. A permanent Internet/LAN deployment on operator-owned infrastructure is a separate advanced self-hosted profile.
- Q: Is Google required? → A: **No** — email/password is the provider-independent baseline so a local installation works without Google Cloud; Google OAuth remains an optional installation-level provider.
- Q: How are distribution paths prioritized? → A: **Portable core first, managed production next, self-hosted production last** — local and managed parity is a blocking foundation before Phase 9; managed deployment and advanced self-hosting are release phases after feature completion.

## Product Overview

A personal, open-source, AI-first recipe manager for individual users. Recipes are structured, editable, versioned domain entities — not static pages or blobs of generated text. A user can create recipes manually, import them from text or standard web recipe content (always with review before saving), generate them through an AI conversation, discuss and modify them through a per-recipe conversation, review AI-proposed changes before they are applied, keep variants/history, adjust servings, and build a shopping list from recipe ingredients. AI is provided via each user's own credentials (BYOK), the product degrades gracefully when AI is unavailable, and every account in a shared installation remains isolated by RLS.

**Target user**: an individual managing their own personal recipe collection, on desktop and mobile, with particular attention to mobile use. An installation may contain multiple independent users, but collaboration, sharing, and cross-user visibility remain out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Manage Recipes Manually (Priority: P1)

The user creates a recipe by hand — title, optional description, structured ingredients (name, quantity, unit), preparation instructions as individually identifiable steps, servings, optional prep/cook time, optional image, optional source — reviews everything before saving, and later browses, searches, organizes, edits, duplicates, marks favorites, and deletes recipes in their collection.

**Why this priority**: This is the foundational value proposition — a reliable personal recipe manager. Per the product philosophy, everything else (import, AI, shopping list) builds on structured, user-owned recipe data. Without this, nothing else delivers value.

**Independent Test**: With AI entirely unconfigured, create a recipe manually, save it, find it via search, open it, edit it, duplicate it, and delete the duplicate — all persisted across sessions.

**Acceptance Scenarios**:

1. **Given** an empty recipe collection, **When** the user fills in the manual creation form with title, servings, at least one ingredient and one instruction, and saves, **Then** the recipe appears in the collection and can be reopened with all entered data intact.
2. **Given** the manual creation form, **When** the user attempts to save without a title or without any ingredient, **Then** validation feedback identifies the missing fields and nothing is saved.
3. **Given** a collection with several recipes, **When** the user types a search term matching a recipe title, **Then** matching recipes are shown and non-matching ones are filtered out.
4. **Given** a saved recipe, **When** the user edits its ingredients and saves, **Then** reopening the recipe shows the edited ingredients.
5. **Given** a saved recipe, **When** the user duplicates it, **Then** an independent copy appears in the collection; editing the copy does not affect the original.
6. **Given** a saved recipe, **When** the user deletes it, **Then** a confirmation is requested first and, once confirmed, the recipe no longer appears in the collection.
7. **Given** a collection of recipes, **When** the user assigns tags or marks recipes as favorites, **Then** the collection can be filtered or browsed by that metadata.
8. **Given** an empty collection, **When** the user opens the recipe list, **Then** an intentional empty state is shown with a clear path to create or import a first recipe.

---

### User Story 2 - Import a Recipe With Mandatory Review (Priority: P1)

The user provides supported recipe content — pasted text or a web recipe URL — and the application extracts structured recipe data. The result is never saved automatically: the user reviews and corrects every part (title, ingredients, quantities, units, instructions, servings), removes wrong information, and completes missing information before saving. If extraction fails, the user gets a clear error and a manual fallback path. Source information is preserved when available.

**Why this priority**: Import with review is the second half of "reliable personal recipe manager" — most real-world recipes come from elsewhere. The mandatory review step is a constitutional requirement (AI/extracted content is untrusted), so it is part of the core MVP, not an enhancement.

**Independent Test**: Paste a recipe text (or point at a standard web recipe page), receive a structured draft, deliberately correct one ingredient and one instruction, save, and verify the saved recipe reflects the corrections and retains the source reference.

**Acceptance Scenarios**:

1. **Given** a block of plain-text recipe content, **When** the user submits it for import, **Then** a structured draft (title, ingredients with quantities/units, instruction steps, servings) is presented in an editable review screen and nothing is yet persisted.
2. **Given** an extraction result with an incorrect ingredient quantity, **When** the user corrects it during review and saves, **Then** the saved recipe contains the corrected value.
3. **Given** an extraction result, **When** the user removes a spurious ingredient and adds a missing instruction step during review, **Then** the saved recipe reflects both changes.
4. **Given** content from which no recipe can be extracted, **When** import is attempted, **Then** the user sees a clear, non-technical failure message and is offered manual entry as a fallback; no partial or corrupt recipe is saved.
5. **Given** a web recipe source, **When** import succeeds, **Then** the saved recipe retains source information (e.g., origin URL) visible on the recipe.
6. **Given** the import review screen, **When** the user abandons the review without saving, **Then** no recipe is added to the collection.

---

### User Story 3 - View a Recipe and Adjust Servings (Priority: P1)

The user opens a recipe and sees a clean cooking-focused view: title, servings, ingredients with quantities and units, instruction steps, optional timing, optional image, optional source, and available variants/history. The user can change the displayed serving count; ingredient quantities scale proportionally with sensible, human-readable values (fractions where appropriate). A temporary serving change never silently modifies the saved recipe; the user may explicitly save an adjustment if desired.

**Why this priority**: Viewing and cooking from a recipe is the highest-frequency interaction, and serving adjustment is deterministic core functionality that must work without AI. It depends only on US1's data.

**Independent Test**: Create a 4-serving recipe manually, open it, switch to 2 servings, verify halved quantities render sensibly, leave the page, and confirm the saved recipe still says 4 servings; then explicitly save a 6-serving adjustment and confirm persistence.

**Acceptance Scenarios**:

1. **Given** a saved recipe, **When** the user opens it, **Then** all stored fields (title, servings, ingredients with quantity/unit, steps, timing, source, image when present) are clearly presented, with AI features available but not dominant.
2. **Given** a 4-serving recipe listing "2 cups flour", **When** the user views it at 2 servings, **Then** the display shows "1 cup flour" without altering the stored recipe.
3. **Given** a recipe scaled to a fractional quantity, **When** quantities are displayed, **Then** they render in a human-friendly form (e.g., "½", "1 ½") rather than long decimals.
4. **Given** an ingredient without a quantity or unit (e.g., "salt to taste"), **When** servings change, **Then** the ingredient is preserved as-is and never corrupted by scaling.
5. **Given** a temporarily scaled view, **When** the user chooses to save the adjustment, **Then** the recipe's stored servings and quantities are updated intentionally, and this change is recoverable via history.
6. **Given** a recipe with optional fields absent (no image, no timing, no source), **When** the recipe is viewed, **Then** the layout remains clean with no broken placeholders.

---

### User Story 4 - Per-Recipe Conversation With Reviewed AI Modifications (Priority: P2)

From any saved recipe, the user opens a conversation bound to that recipe. The AI receives the recipe as context and answers informational questions ("Can I replace this ingredient?", "Explain step three", "Can I cook this in an air fryer?") without changing anything. When the user asks for a change ("Make this vegetarian", "Higher protein", "I only have two eggs"), the AI proposes structured modifications; the user reviews a meaningful comparison of current vs. proposed, then applies the changes to the current recipe, saves them as a new variant, or discards them. The AI never silently overwrites the saved recipe, and proposed changes keep the recipe coherent (e.g., replacing an ingredient also updates affected steps).

**Why this priority**: This is the product's defining differentiator — conversational transformation of recipes with user control. It ranks below core CRUD/import because those must work even without AI, but it is the main reason the product exists.

**Independent Test**: With AI configured, open a recipe, ask an informational question (verify the recipe is unchanged), then ask for a modification, review the diff, discard one proposal, apply another, and confirm the recipe reflects only the applied change.

**Acceptance Scenarios**:

1. **Given** a saved recipe and configured AI, **When** the user asks "Explain step three", **Then** the AI answers in the conversation and the saved recipe is untouched.
2. **Given** a saved recipe, **When** the user asks "Make this vegetarian", **Then** the AI returns structured proposed modifications (e.g., ingredient replacements, adjusted steps) presented as a reviewable comparison against the current recipe — the saved recipe is not yet changed.
3. **Given** a modification proposal under review, **When** the user applies it, **Then** the current recipe is updated to the proposed state and the change is recoverable via modification history.
4. **Given** a modification proposal under review, **When** the user saves it as a variant, **Then** a new variant is created with a clear relationship to the source recipe, and the source recipe is unchanged.
5. **Given** a modification proposal under review, **When** the user discards it, **Then** nothing changes and the conversation continues.
6. **Given** a proposal replacing an ingredient used in instruction steps, **When** the proposal is generated, **Then** affected steps are updated so the recipe remains coherent.
7. **Given** a malformed or incomplete AI response, **When** it is received, **Then** the user sees a graceful error in the conversation, may retry, and the saved recipe is never corrupted.
8. **Given** AI is not configured or the provider fails, **When** the user opens the recipe conversation, **Then** the state is clearly communicated and all non-AI recipe functionality remains available.
9. **Given** multiple conversations on different recipes, **When** the user returns to a recipe, **Then** the conversation shown is the one associated with that recipe.

---

### User Story 5 - Generate a Recipe Through Conversation (Priority: P2)

Starting without any existing recipe, the user describes what they want ("Create a high-protein chicken dinner", "I have eggs, potatoes and cheese — what can I cook?", "A quick meal for two"). The AI may ask clarifying questions when genuinely needed, then produces a structured recipe in the same format as manually created recipes. The user reviews and edits the result before saving; once saved, it behaves exactly like any other recipe.

**Why this priority**: Conversational creation is the second critical success flow, but the product remains viable without it (manual + import cover acquisition). It reuses US1's structured recipe format and review UX.

**Independent Test**: With AI configured, request a recipe conversationally, receive a structured draft, edit one field during review, save, and verify it behaves like any other recipe (view, scale servings, chat, shopping list).

**Acceptance Scenarios**:

1. **Given** configured AI, **When** the user describes a desired recipe, **Then** the AI produces a structured recipe draft (title, servings, ingredients with quantities/units, steps) in an editable review screen, and nothing is persisted yet.
2. **Given** an ambiguous request, **When** clarification is genuinely necessary, **Then** the AI asks a focused clarifying question before generating.
3. **Given** a generated draft, **When** the user edits an ingredient and an instruction before saving, **Then** the saved recipe contains the user's edited values.
4. **Given** a generated draft, **When** the user discards it, **Then** no recipe is saved.
5. **Given** a saved AI-generated recipe, **When** the user uses it later, **Then** all functionality (edit, servings, chat, variants, shopping list) works identically to a manual recipe.
6. **Given** a malformed AI generation result, **When** it fails validation, **Then** the user sees a graceful error and retry path, and no partial recipe is persisted.
7. **Given** a generated recipe including estimated information (e.g., timing or nutrition-like estimates), **When** it is displayed, **Then** such estimates are not presented as guaranteed facts.

---

### User Story 6 - Shopping List From Recipes (Priority: P2)

The user adds ingredients from one or more recipes to a shopping list, choosing the serving count per recipe at the moment of adding. The list supports manual entries, editing, deletion, and marking items purchased. Where practical and unambiguous, equivalent ingredients from multiple recipes are grouped; the user can always correct the result manually.

**Why this priority**: The shopping list closes the core end-to-end flow (recipe → shopping). It depends only on structured recipe data and scaling logic from US1/US3, not on AI.

**Independent Test**: Without AI, add two recipes at chosen serving counts to the list, verify quantities reflect the servings, edit one item, add a manual item, mark items purchased, and delete an item — all persisted across sessions.

**Acceptance Scenarios**:

1. **Given** a saved recipe, **When** the user adds it to the shopping list and selects 2 servings for a 4-serving recipe, **Then** list entries reflect halved quantities.
2. **Given** ingredients already on the list, **When** a second recipe with an identical ingredient and compatible unit is added, **Then** the entries are grouped/summed where unambiguous; ambiguous cases (different units, quantity-less items) remain separate rather than being merged incorrectly.
3. **Given** the shopping list, **When** the user adds a manual entry, edits a quantity, deletes an item, and marks items purchased, **Then** all changes persist and purchased items are visually distinct.
4. **Given** a quantity-less ingredient (e.g., "salt to taste"), **When** its recipe is added to the list, **Then** it appears as a list entry without a corrupted quantity.
5. **Given** an empty shopping list, **When** the user opens it, **Then** an intentional empty state explains how to add items.

---

### User Story 7 - Recipe Variants and Modification History (Priority: P2)

Meaningful modifications are recoverable. The user can create variants of a recipe (high-protein, vegetarian, air-fryer, family-size) that retain a clear relationship to the source recipe, and when modifications replace the current recipe, enough history is retained to recover from an unwanted change. The interface stays simple in the initial release.

**Why this priority**: Recoverability is what makes AI modification safe to use, but a minimal history mechanism suffices for v1 — it trails the modification flow it protects (US4).

**Independent Test**: Apply an AI modification to a recipe, then recover the prior state from history; separately create a variant, verify it links back to the source, and verify editing the variant does not affect the source.

**Acceptance Scenarios**:

1. **Given** a recipe modified via an applied AI proposal, **When** the user views its history, **Then** the previous state is visible and can be restored.
2. **Given** a saved recipe, **When** the user creates a variant, **Then** the variant shows its relationship to the source recipe and the source links to its variants.
3. **Given** a variant, **When** the user edits it, **Then** the source recipe and other variants are unaffected.
4. **Given** a recipe with variants, **When** the source recipe is deleted, **Then** the confirmation warns that variants exist, and on confirmation each variant becomes an independent standalone recipe (losing only the source link); no variant content is deleted or silently lost.

---

### User Story 8 - AI Configuration (BYOK) and Graceful Degradation (Priority: P2)

The user configures AI functionality with their own credentials in a settings area. The app clearly communicates whether AI is configured, whether it is currently available, when a failure is caused by AI configuration, and which actions require AI. When AI is unavailable, the entire non-AI product (browse, view, create, edit, servings, shopping list) keeps working, and credentials are never exposed to unauthorized parties, logs, or error messages.

**Why this priority**: BYOK unlocks every AI feature and is a constitutional/privacy requirement, but the product is deliberately usable with zero AI configuration — so it is not P1.

**Independent Test**: With no credentials configured, verify all non-AI flows work and AI actions clearly explain what is missing; then configure credentials, verify AI actions become available; then revoke/invalidate them and verify graceful failure with a clear message and no credential leakage.

**Acceptance Scenarios**:

1. **Given** no AI credentials configured, **When** the user opens settings, **Then** the AI status is clearly shown as not configured, with guidance on what is needed.
2. **Given** no AI credentials, **When** the user attempts an AI action, **Then** the UI explains that AI is not configured and which capability requires it, without breaking the surrounding flow.
3. **Given** configured credentials, **When** the provider rejects them or is unreachable, **Then** the user sees a clear failure message that does not expose the credentials or internal details, and non-AI features remain usable.
4. **Given** configured credentials, **When** they are stored, **Then** they are never logged, committed, or rendered to unauthorized clients, and the user can update or remove them.
5. **Given** AI becomes unavailable mid-session, **When** the user navigates to recipes or the shopping list, **Then** those areas work normally.

---

### User Story 9 - Import a Recipe From a Social Media Video Link (Priority: P3, Approved for Phase 11.75)

The user pastes a link to an Instagram Reel, TikTok video, or YouTube Short whose recipe lives in the caption/description or the spoken narration rather than in fetchable page markup. The application retrieves that caption/description (and, when necessary, a transcript of the narration) and runs it through the same reviewed-import pipeline as any other import (User Story 2): a structured draft is presented for mandatory review, and nothing is saved without explicit confirmation.

**Why this priority**: Genuinely useful — a large share of recipe sharing happens on these platforms — but it is the first feature requiring infrastructure beyond this project's current "Supabase + static frontend only" architecture. It is deliberately P3. The approved implementation uses a separately hosted `yt-dlp` metadata service for all three platforms, without requiring Instagram session cookies. Audio transcription remains a future enhancement.

**Independent Test**: Once implemented — submit public Instagram Reel, TikTok, and YouTube Shorts URLs whose captions contain full recipes; receive the same editable review screen as any other import; correct one field; save; verify the saved recipes behave identically to any other recipe (US1–US8 apply unchanged).

**Acceptance Scenarios**:

1. **Given** a public Instagram Reel, TikTok video, or YouTube Shorts URL whose caption/description contains a complete recipe, **When** the user submits it for import, **Then** a structured draft is presented in the same mandatory review screen used by User Story 2, and nothing is persisted before explicit save.
2. **Given** a video whose caption/description has no usable recipe text, **When** import is attempted in Phase 11.75, **Then** the system MUST show a clear recoverable failure and offer the existing paste-text fallback. Audio transcription is deferred to a future phase.
3. **Given** an Instagram URL without any configured Instagram session credentials, **When** the user submits it for import, **Then** the system MUST attempt the approved metadata-first path and MUST NOT require, collect, or store Instagram cookies.
4. **Given** metadata extraction fails for any reason (platform blocks the request or no usable recipe is found), **When** import is attempted, **Then** the user sees a clear, non-technical failure message and is offered the existing "Paste text" fallback, consistent with FR-009.
5. **Given** the upstream platform blocks or fails metadata extraction, **When** a user submits an Instagram/TikTok/YouTube Shorts URL, **Then** the system MUST show a clear platform-import failure and offer the existing paste-text fallback rather than returning an opaque AI/schema error.

**Note**: Until Phase 11.75 is implemented, the Phase 11.5 hotfix may still return the existing unsupported message. Once implemented, scenarios 1–5 describe the approved metadata-first behavior.

---

### Edge Cases

- **Scaling to zero or extreme servings**: serving adjustment rejects non-positive or absurd values with validation feedback instead of producing nonsense quantities.
- **Non-scalable ingredients**: quantity-less or "to taste" ingredients pass through scaling unchanged and never produce NaN/empty quantities.
- **Unit heterogeneity in shopping list**: same ingredient with incompatible units (grams vs. cups) stays as separate entries; merging is conservative, never lossy.
- **Extraction of non-recipe content**: import of text without a recipe yields a clear failure plus manual-entry fallback; no empty or junk recipe is created.
- **AI proposes invalid structure**: AI output failing schema validation (missing title, negative quantities, empty steps) is rejected before reaching review or persistence; the user can retry.
- **Concurrent-ish edits**: user edits a recipe while a proposal for it is under review — applying the proposal targets the state it was based on, or the user is warned that the recipe changed since the proposal was generated.
- **Deleting a recipe with variants/history/shopping-list traces**: deletion requires confirmation and warns about existing variants; on confirmation variants become independent standalone recipes; shopping-list entries already added remain usable; the recipe's history is deleted with it.
- **Unauthenticated and cross-user access**: unauthenticated requests are redirected to sign-in; an authenticated account cannot read or modify another account's recipes, conversations, shopping list, AI configuration metadata, or Storage objects.
- **Duplicate detection**: duplicating a recipe yields a clearly distinguishable copy (e.g., suffixed title) rather than an indistinguishable twin.
- **Very long recipes / imports**: long ingredient lists and step counts render and edit without data loss.
- **Provider latency**: AI actions show intentional loading states and remain cancellable or safely abandonable; no double-submission creates duplicate proposals or recipes.
- **Image handling**: unsupported or oversized recipe images are rejected with clear feedback rather than failing the whole save.
- **Credentials in error paths**: no error message, log line, or UI state ever echoes the user's AI credentials.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication and ownership**

- **FR-000**: The application MUST require a valid Supabase Auth session for protected routes and data. Any account accepted by an installation's enabled Auth providers may sign in; every user-owned database row and Storage object MUST be isolated by `auth.uid()`-scoped RLS, and no application data or configuration is accessible without authentication.

**Recipe data model and management**

- **FR-001**: The system MUST store recipes as structured entities with: title (required), optional description, an ordered list of ingredients each distinguishing name/quantity/unit (quantity and unit optional per ingredient), an ordered list of individually identifiable instruction steps, explicit servings, optional preparation and cooking time, optional image, and optional source information.
- **FR-002**: Users MUST be able to create a recipe manually with review of all fields before saving.
- **FR-003**: Users MUST be able to edit every field of a saved recipe, duplicate a recipe, and delete a recipe; deletion MUST require explicit confirmation.
- **FR-004**: Users MUST be able to browse the collection, search recipes by at least title/content, mark favorites, and organize recipes with free-form tags (tags are the only organization mechanism in v1 — no categories or collections).
- **FR-005**: The system MUST validate recipes on save (e.g., non-empty title, at least one ingredient and one instruction, positive servings) and surface actionable validation feedback.

**Import**

- **FR-006**: Users MUST be able to import recipes from pasted text and from standard web-based recipe content (e.g., pages exposing standard recipe markup).
- **FR-007**: Imported content MUST be extracted into the structured recipe format and presented in an editable review screen; NOTHING from an import may be persisted before explicit user confirmation.
- **FR-008**: During import review, users MUST be able to correct, remove, and complete any field, including ingredients, quantities, units, instructions, servings, and title.
- **FR-009**: When extraction fails, the system MUST show a clear failure message, offer a manual-entry fallback, and leave no partial or corrupt data behind.
- **FR-010**: The system MUST preserve source information (at minimum the origin URL or note) on imported recipes when available.

**Viewing and servings**

- **FR-011**: Recipe view MUST present title, servings, ingredients with quantities/units, instruction steps, and optional timing, image, source, and variant/history information, remaining fully usable without AI.
- **FR-012**: Users MUST be able to change the displayed serving count; quantities MUST scale proportionally and render in human-friendly form (fractions where appropriate), while quantity-less ingredients pass through unchanged.
- **FR-013**: A temporary serving change MUST NOT modify the persisted recipe; saving a serving adjustment MUST be an explicit user action and MUST be recoverable via history.

**Recipe conversation and AI modification**

- **FR-014**: Every saved recipe MUST provide access to exactly one persistent conversation bound to that recipe, which grows over time; v1 has no multi-thread support and no conversation management UI beyond the single thread.
- **FR-015**: The AI MUST receive the current recipe as context and MUST be able to answer informational questions without modifying the recipe.
- **FR-016**: When the user requests a change, the AI MUST return structured proposed modifications (add/remove/replace ingredients, change quantities/units/servings, change/add/remove steps) rather than directly rewriting the saved recipe.
- **FR-017**: Before any significant modification is applied, the system MUST present the proposed result or a meaningful comparison against the current recipe, and the user MUST be able to apply it to the current recipe, save it as a new variant, or discard it.
- **FR-018**: AI output MUST be validated against the recipe schema before review or persistence; malformed or incomplete AI results MUST produce a graceful error and MUST never corrupt saved data.
- **FR-019**: Proposed modifications MUST keep the recipe coherent (e.g., replacing an ingredient updates affected instruction steps).
- **FR-020**: The AI MUST NOT overwrite or mutate a saved recipe without an explicit apply action by the user.

**AI recipe generation**

- **FR-021**: Users MUST be able to start a conversation describing a desired recipe and receive a structured recipe draft in the same format as manual recipes; the AI MAY ask clarifying questions when genuinely necessary.
- **FR-022**: Generated drafts MUST be reviewed and editable before saving; once saved, an AI-generated recipe MUST behave identically to any other recipe.

**Variants and history**

- **FR-023**: Users MUST be able to create a variant from an existing recipe; a variant MUST retain a visible relationship to its source recipe and MUST be independently editable. When a source recipe is deleted, its variants MUST become independent standalone recipes (losing only the source link), and the deletion confirmation MUST warn the user about existing variants.
- **FR-024**: Every saved change to a recipe — manual edits, AI-applied modifications, and explicitly saved serving adjustments — MUST create a recoverable history entry capturing the previous state, and users MUST be able to view and restore prior states. Temporary serving display changes MUST NOT create history entries.

**Shopping list**

- **FR-025**: Users MUST be able to add ingredients from one or more recipes to a single global shopping list (one list per installation in v1), choosing the serving count per recipe at add time.
- **FR-026**: The shopping list MUST support entries with ingredient name, optional quantity, optional unit, plus manual entries, editing, deletion, and marking items as purchased.
- **FR-027**: Equivalent ingredients from multiple recipes MUST be grouped/summed only when unambiguous (same ingredient, compatible units); ambiguous entries MUST remain separate, and users MUST always be able to correct entries manually.

**AI configuration and degradation**

- **FR-028**: Users MUST be able to configure their own AI provider credentials (BYOK), and update or remove them; the product MUST NOT require the project owner to fund users' AI usage. V1 requires exactly one functional AI provider; provider-specific behavior MUST be isolated so additional providers can be added later without rewriting application features.
- **FR-029**: The system MUST clearly communicate AI status: configured or not, currently available or not, when a failure is caused by configuration, and which actions require AI.
- **FR-030**: Credentials MUST be stored and handled so they are never exposed to unauthorized clients, logs, repositories, telemetry, or error messages.
- **FR-031**: All core recipe-management functionality (browse, view, create, edit, delete, search, servings adjustment, shopping list) MUST remain fully available when AI is unconfigured or failing.

**Experience and quality**

- **FR-032**: The application MUST be responsive and comfortable on desktop and mobile, with mobile use given particular consideration.
- **FR-033**: The application MUST provide intentional loading, empty, validation, and error states, and confirmation for destructive actions.
- **FR-034**: Primary navigation MUST provide easy access to: recipes, recipe creation/import, AI-assisted recipe creation, shopping list, and settings.
- **FR-035**: AI-generated estimates (e.g., timing, nutrition-like values) MUST NOT be presented as guaranteed facts, and AI-generated content MUST be visually distinguishable from saved user data where both appear.

**Social media video import (approved metadata-first scope — see research.md R14 and tasks.md Phase 11.75)**

- **FR-040**: Users MUST be able to submit a link to Instagram Reels, TikTok videos, or YouTube Shorts and receive a structured recipe draft through the same mandatory review pipeline as FR-006–FR-010 when metadata/description extraction succeeds; the extraction source MUST be visible to the user. Phase 11.75 does not require Instagram cookies or audio transcription.
- **FR-041**: Until FR-040 is implemented, submitting a URL from a video platform MUST produce a clear, specific message directing the user to the existing paste-text import path, rather than a generic extraction-failure error.
- **FR-042**: If audio transcription is used as a fallback, it MUST use the user's own configured AI provider credentials (BYOK) and MUST NOT be attempted without the user understanding it will consume additional AI provider usage.
- **FR-043**: Instagram session cookies are not collected or required by Phase 11.75. Any future cookie-based enhancement requires a separate security decision and must meet the same handling standard as FR-030.

**Installation and portability**

- **FR-036**: The same frontend, migrations, and Edge Function sources MUST support both a Supabase CLI local stack and an installation-owned managed Supabase project; switching profiles MUST require configuration only, never application forks or hard-coded project identifiers.
- **FR-037**: A fresh local installation MUST be usable without a Supabase Cloud account, Google OAuth credentials, or live AI provider calls. Email/password Auth MUST provide the baseline local sign-in path; Google OAuth MAY be enabled by an operator.
- **FR-038**: The Supabase CLI local stack MUST be documented as localhost-only and MUST NOT be presented as production self-hosting. Permanent Internet/LAN operation on owned infrastructure MUST use the separately versioned advanced self-hosted deployment profile with explicit TLS, secrets, persistence, backup, and upgrade responsibilities.
- **FR-039**: Installation-specific URLs, publishable keys, OAuth credentials, database credentials, service-role/secret keys, and AI credentials MUST remain outside version control. Public frontend code MAY receive only the configured Supabase URL and publishable key.

### Key Entities *(include if feature involves data)*

- **Recipe**: The central structured entity. Title, optional description, ordered ingredients, ordered instruction steps, servings, optional prep/cook time, optional image, optional source, free-form tags, favorite flag, timestamps. Related to variants and to its modification history.
- **Ingredient**: A line item of a recipe distinguishing name, optional quantity, optional unit; quantity-less entries ("salt to taste") are valid.
- **Instruction Step**: An individually identifiable, ordered preparation step, editable and comparable independently of other steps.
- **Recipe Variant**: A recipe derived from a source recipe, retaining a visible relationship to the source; independently editable and deletable.
- **Recipe History Entry**: A recoverable prior state of a recipe, created when modifications replace the current recipe (including explicitly saved serving adjustments).
- **Conversation**: Exactly one persistent message thread per recipe (plus the recipe-generation flow before a recipe exists), containing user messages, AI informational answers, and AI modification proposals with their outcomes (applied / saved-as-variant / discarded).
- **Modification Proposal**: A structured, schema-validated set of proposed recipe changes produced by AI, presented for review; never applied without explicit user action.
- **Shopping List Item**: Ingredient name, optional quantity, optional unit, purchased flag; may originate from a recipe (at a chosen serving count) or be manual; grouping of equivalent items is conservative and user-correctable.
- **AI Configuration**: The user's own provider credentials and settings, with explicit configured/available status; private, never logged or exposed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete the primary end-to-end flow — create or import a recipe, review and save it, open it, converse about it, apply or variant-save an AI modification, adjust servings, and add ingredients to the shopping list — in under 10 minutes without external help.
- **SC-002**: 100% of AI-proposed modifications and imported recipes reach persistence only after explicit user review and confirmation; zero silent overwrites of saved recipes in testing.
- **SC-003**: With AI unconfigured or the provider disabled, 100% of non-AI core flows (browse, view, create, edit, search, servings, shopping list) remain functional.
- **SC-004**: Serving scaling produces correct proportional quantities for all quantity-bearing ingredients, and human-friendly rendering (e.g., fractions) for common fractional results.
- **SC-005**: 100% of malformed/invalid AI outputs in testing are rejected gracefully with no corrupted or partially persisted recipes.
- **SC-006**: Core flows are completable on a mobile-width viewport without loss of functionality (create, review import, view, chat, shopping list).
- **SC-007**: Shopping-list grouping never merges ingredients with incompatible units; manual correction of any list entry is always possible.
- **SC-008**: A user can recover the previous state of a recipe after an applied modification 100% of the time via history.
- **SC-009**: Zero occurrences of AI credentials appearing in logs, error messages, client-visible responses, or the repository in security review.
- **SC-010**: From a fresh clone, a user can start a complete localhost OpenDish installation, create an account, and exercise Auth, database, Storage, Vault, and Edge Functions without creating a Supabase Cloud project or Google OAuth client.
- **SC-011**: The same committed migration and Edge Function sources pass smoke tests against both the supported local stack and a fresh managed Supabase project, with environment switching performed only through documented configuration.
- **SC-012**: Two authenticated test users have zero cross-user reads or writes across all user-owned database tables and Storage objects in the RLS integration suite.

## Assumptions

- Each account manages a private personal collection. An installation may accept multiple authenticated accounts, but collaboration, sharing, public profiles, administration UI, roles, and cross-user access are not part of v1.
- Supabase Cloud is the recommended production path, not a requirement. The CLI local stack supports localhost use and development; permanent self-hosted production is an advanced distribution profile delivered after feature completion.
- Email/password is the provider-independent Auth baseline. Google OAuth is optional and configured per installation.
- Users bring their own AI provider credentials and accept that AI features are inert until configured; v1 ships with one functional provider.
- Import v1 targets pasted text and web pages exposing standard recipe structure; social-media/video import is User Story 9 and is approved as the Phase 11.75 follow-up using a metadata-first `yt-dlp` service for Instagram, TikTok, and YouTube Shorts.
- Each recipe has exactly one persistent conversation; advanced conversation management (multiple threads, search, export, branching) is out of scope for v1.
- The versioning/history interface can be minimal (list prior states, restore) as long as every saved change is recoverable.
- Nutritional or similar estimates, when produced by AI, are labeled as estimates; no clinical or medical claims are made.
- The v1 UI ships in English only; recipe content, tags, and AI conversations may be in any language. Localization infrastructure is a later consideration.
- Users have internet access for AI and web-import features; offline-first synchronization is explicitly out of scope.
- Technology stack, database, and hosting choices are deliberately deferred to the implementation plan; this specification constrains behavior and data, not tools.

## Out of Scope (Initial Version)

Social features (followers, comments, public feeds, discovery marketplace), paid subscriptions or monetization, automated grocery purchasing, native mobile apps, household integrations, autonomous AI agents, generated recipe images, medical/clinical nutrition advice or claims of exact nutrition values, pantry/inventory management, meal planning, family or collaborative accounts, complex permissions, plugin marketplaces, public API, offline-first synchronization, and advanced video processing.

Direct import from Instagram Reels, TikTok videos, and YouTube Shorts (User Story 9) is approved for tasks.md Phase 11.75 using metadata-first `yt-dlp` extraction. Audio transcription and cookie-based Instagram access remain future enhancements; upstream platform failures must still degrade to a clear paste-text fallback.
