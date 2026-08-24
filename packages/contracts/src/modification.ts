import { z } from 'zod';
import { ingredientSchema, recipeDraftSchema, stepSchema } from './recipe.ts';

const positionSchema = z.number().int().min(0);

/**
 * Structured edit operation on a recipe. `position` / `afterPosition`
 * are 0-based indexes into the ingredient / step arrays.
 */
export const modificationOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('addIngredient'),
    ingredient: ingredientSchema,
    afterPosition: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal('removeIngredient'),
    position: positionSchema,
  }),
  z.object({
    kind: z.literal('updateIngredient'),
    position: positionSchema,
    patch: ingredientSchema.partial(),
  }),
  z.object({
    kind: z.literal('addStep'),
    step: stepSchema,
    afterPosition: positionSchema.optional(),
  }),
  z.object({
    kind: z.literal('removeStep'),
    position: positionSchema,
  }),
  z.object({
    kind: z.literal('updateStep'),
    position: positionSchema,
    text: stepSchema.shape.text,
  }),
  z.object({
    kind: z.literal('reorderSteps'),
    order: z.array(positionSchema),
  }),
  z.object({
    kind: z.literal('setServings'),
    servings: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('setTitle'),
    title: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal('setDescription'),
    description: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('setTimes'),
    prepTimeMinutes: z.number().int().min(0).nullable().optional(),
    cookTimeMinutes: z.number().int().min(0).nullable().optional(),
  }),
]);
export type ModificationOp = z.infer<typeof modificationOpSchema>;

/**
 * AI-proposed modification: the operation list for summarizing the change
 * plus a full resulting recipe for review/diff. This schema only checks
 * shape — the Edge Function always replaces `resultingRecipe` with the
 * deterministic re-application of `operations` before returning or
 * persisting the proposal, so the AI's own `resultingRecipe` value is never
 * trusted for correctness (see `_shared/recipe-modification.ts`).
 */
export const modificationProposalSchema = z.object({
  summary: z.string().min(1),
  operations: z.array(modificationOpSchema).min(1),
  resultingRecipe: recipeDraftSchema,
});
export type ModificationProposal = z.infer<typeof modificationProposalSchema>;
