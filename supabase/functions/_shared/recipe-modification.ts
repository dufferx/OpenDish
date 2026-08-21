import {
  applyModificationOperations,
  modificationProposalSchema,
  type ModificationProposal,
  type RecipeDraft,
  type RecipeSnapshot,
} from '../../../packages/contracts/src/index.ts';

export type ProposalValidationResult =
  { ok: true; proposal: ModificationProposal } | { ok: false };

function sameRecipe(left: RecipeDraft, right: RecipeDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Runtime schema validation plus the independent coherence check required by FR-016. */
export function validateModificationProposal(
  snapshot: RecipeSnapshot,
  value: unknown,
): ProposalValidationResult {
  const parsed = modificationProposalSchema.safeParse(value);
  if (!parsed.success) return { ok: false };
  try {
    const { imagePath: _imagePath, ...baseRecipe } = snapshot;
    const reapplied = applyModificationOperations(
      baseRecipe,
      parsed.data.operations,
    );
    if (!sameRecipe(reapplied, parsed.data.resultingRecipe))
      return { ok: false };
    return { ok: true, proposal: parsed.data };
  } catch {
    return { ok: false };
  }
}
