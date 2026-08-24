import {
  applyModificationOperations,
  modificationProposalSchema,
  type ModificationProposal,
  type RecipeSnapshot,
} from '../../../packages/contracts/src/index.ts';

export type ProposalValidationResult =
  { ok: true; proposal: ModificationProposal } | { ok: false };

/**
 * Runtime schema validation plus deterministic re-application (FR-016/FR-019).
 *
 * The proposal's `resultingRecipe` is always replaced with the recipe
 * produced by applying `operations` to the base snapshot — the AI's own
 * `resultingRecipe` is never trusted for correctness. Requiring the model to
 * independently reconstruct a byte-identical copy of its own edit was
 * unreliable in practice (e.g. a single "add bacon" `addIngredient`
 * operation, otherwise perfectly valid, could still fail here whenever the
 * model's freestanding `resultingRecipe` text diverged from its own
 * operations in some cosmetic way) and rejected otherwise-correct proposals
 * with an opaque "invalid recipe change" error. Only whether the operations
 * themselves are well-formed and applicable to the current recipe (valid
 * positions, a complete `reorderSteps` permutation, a schema-valid final
 * recipe) is a real safety concern; that is what `applyModificationOperations`
 * enforces, by throwing.
 */
export function validateModificationProposal(
  snapshot: RecipeSnapshot,
  value: unknown,
): ProposalValidationResult {
  const parsed = modificationProposalSchema.safeParse(value);
  if (!parsed.success) return { ok: false };
  try {
    const { imagePath: _imagePath, ...baseRecipe } = snapshot;
    const resultingRecipe = applyModificationOperations(
      baseRecipe,
      parsed.data.operations,
    );
    return { ok: true, proposal: { ...parsed.data, resultingRecipe } };
  } catch {
    return { ok: false };
  }
}
