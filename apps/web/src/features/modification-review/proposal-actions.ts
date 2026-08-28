import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyModificationOperations,
  makeQuantity,
  modificationOpSchema,
  recipeDraftSchema,
  type ModificationOp,
  type RecipeDraft,
} from '@opendish/contracts';

import {
  createSupabaseRecipeStore,
  saveRecipe,
  type SaveRecipeResult,
  type StoredRecipeState,
} from '@/domain/recipe-save.ts';

type ProposalStatus = 'pending' | 'applied' | 'variant_created' | 'discarded';

interface StoredProposal {
  id: string;
  recipeId: string;
  baseVersion: number;
  status: ProposalStatus;
  operations: unknown;
}

export class ProposalNotFoundError extends Error {
  readonly proposalId: string;

  constructor(proposalId: string) {
    super(`proposal not found: ${proposalId}`);
    this.name = 'ProposalNotFoundError';
    this.proposalId = proposalId;
  }
}

export class ProposalNotPendingError extends Error {
  readonly proposalId: string;
  readonly status: ProposalStatus;

  constructor(proposalId: string, status: ProposalStatus) {
    super(`proposal ${proposalId} must be pending (current status: ${status})`);
    this.name = 'ProposalNotPendingError';
    this.proposalId = proposalId;
    this.status = status;
  }
}

export class StaleProposalError extends Error {
  readonly proposalId: string;
  readonly baseVersion: number;
  readonly currentVersion: number;

  constructor(proposalId: string, baseVersion: number, currentVersion: number) {
    super(
      `proposal ${proposalId} is stale: recipe version ${currentVersion} no longer matches base version ${baseVersion}`,
    );
    this.name = 'StaleProposalError';
    this.proposalId = proposalId;
    this.baseVersion = baseVersion;
    this.currentVersion = currentVersion;
  }
}

export class InvalidProposalOperationsError extends Error {
  constructor(readonlyMessage: string) {
    super(`proposal operations are invalid: ${readonlyMessage}`);
    this.name = 'InvalidProposalOperationsError';
  }
}

export class ProposalResultMismatchError extends Error {
  readonly proposalId: string;

  constructor(proposalId: string) {
    super(
      `resulting recipe does not match persisted operations for proposal ${proposalId}`,
    );
    this.name = 'ProposalResultMismatchError';
    this.proposalId = proposalId;
  }
}

function checkError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function loadPendingProposal(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<StoredProposal> {
  const { data, error } = await supabase
    .from('modification_proposals')
    .select('id, recipe_id, base_version, status, operations')
    .eq('id', proposalId)
    .maybeSingle();
  checkError(error, 'could not load proposal');
  if (!data) throw new ProposalNotFoundError(proposalId);

  const row = data as {
    id: string;
    recipe_id: string;
    base_version: number | string;
    status: ProposalStatus;
    operations: unknown;
  };
  const proposal: StoredProposal = {
    id: row.id,
    recipeId: row.recipe_id,
    baseVersion: Number(row.base_version),
    status: row.status,
    operations: row.operations,
  };
  if (proposal.status !== 'pending') {
    throw new ProposalNotPendingError(proposal.id, proposal.status);
  }
  return proposal;
}

async function transitionPendingProposal(
  supabase: SupabaseClient,
  proposalId: string,
  status: Exclude<ProposalStatus, 'pending'>,
): Promise<void> {
  const { data, error } = await supabase
    .from('modification_proposals')
    .update({ status })
    .eq('id', proposalId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  checkError(error, 'could not update proposal status');
  if (!data) throw new ProposalNotPendingError(proposalId, status);
}

async function loadCurrentRecipe(
  supabase: SupabaseClient,
  proposal: StoredProposal,
): Promise<StoredRecipeState> {
  const state = await createSupabaseRecipeStore(supabase).getRecipeState(
    proposal.recipeId,
  );
  if (!state) {
    throw new Error(`recipe not found for proposal ${proposal.id}`);
  }
  if (state.recipe.headVersion !== proposal.baseVersion) {
    throw new StaleProposalError(
      proposal.id,
      proposal.baseVersion,
      state.recipe.headVersion,
    );
  }
  return state;
}

function recipeOrigin(origin: string): 'manual' | 'imported' | 'ai_generated' {
  if (
    origin !== 'manual' &&
    origin !== 'imported' &&
    origin !== 'ai_generated'
  ) {
    throw new Error(`recipe has invalid origin: ${origin}`);
  }
  return origin;
}

function toRecipeDraft(state: StoredRecipeState): RecipeDraft {
  const { recipe } = state;
  return recipeDraftSchema.parse({
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    ingredients: [...state.ingredients]
      .sort((left, right) => left.position - right.position)
      .map((ingredient) => ({
        name: ingredient.name,
        quantity:
          ingredient.quantityNum === null
            ? null
            : makeQuantity(ingredient.quantityNum, ingredient.quantityDen ?? 1),
        unit: ingredient.unit,
      })),
    steps: [...state.steps]
      .sort((left, right) => left.position - right.position)
      .map((step) => ({
        text: step.text,
        durationSeconds: step.durationSeconds ?? null,
      })),
    tags: state.tags,
  });
}

function parseOperations(proposal: StoredProposal): ModificationOp[] {
  const parsed = modificationOpSchema
    .array()
    .min(1)
    .safeParse(proposal.operations);
  if (!parsed.success) {
    throw new InvalidProposalOperationsError(
      parsed.error.issues[0]?.message ?? 'unknown validation error',
    );
  }
  return parsed.data;
}

function authoritativeResult(
  proposal: StoredProposal,
  current: StoredRecipeState,
  callerResult: RecipeDraft,
): RecipeDraft {
  const result = applyModificationOperations(
    toRecipeDraft(current),
    parseOperations(proposal),
  );
  const parsedCallerResult = recipeDraftSchema.safeParse(callerResult);
  if (
    !parsedCallerResult.success ||
    JSON.stringify(parsedCallerResult.data) !== JSON.stringify(result)
  ) {
    throw new ProposalResultMismatchError(proposal.id);
  }
  return result;
}

export async function discardProposal(
  supabase: SupabaseClient,
  { proposalId }: { proposalId: string },
): Promise<{ proposalId: string; status: 'discarded' }> {
  const proposal = await loadPendingProposal(supabase, proposalId);
  await transitionPendingProposal(supabase, proposal.id, 'discarded');
  return { proposalId: proposal.id, status: 'discarded' };
}

export async function applyProposal(
  supabase: SupabaseClient,
  {
    proposalId,
    resultingRecipe,
  }: { proposalId: string; resultingRecipe: RecipeDraft },
): Promise<SaveRecipeResult> {
  const proposal = await loadPendingProposal(supabase, proposalId);
  const current = await loadCurrentRecipe(supabase, proposal);
  const authoritativeRecipe = authoritativeResult(
    proposal,
    current,
    resultingRecipe,
  );

  const result = await saveRecipe(supabase, {
    ...authoritativeRecipe,
    recipeId: proposal.recipeId,
    changeKind: 'ai_applied',
    userId: null,
    imagePath: current.recipe.imagePath,
  });
  await transitionPendingProposal(supabase, proposal.id, 'applied');
  return result;
}

export async function saveProposalAsVariant(
  supabase: SupabaseClient,
  {
    proposalId,
    resultingRecipe,
  }: { proposalId: string; resultingRecipe: RecipeDraft },
): Promise<SaveRecipeResult> {
  const proposal = await loadPendingProposal(supabase, proposalId);
  const source = await loadCurrentRecipe(supabase, proposal);
  const authoritativeRecipe = authoritativeResult(
    proposal,
    source,
    resultingRecipe,
  );

  const result = await saveRecipe(supabase, {
    ...authoritativeRecipe,
    recipeId: null,
    changeKind: 'variant_created',
    userId: source.recipe.userId,
    imagePath: source.recipe.imagePath,
    sourceRecipeId: source.recipe.id,
    origin: recipeOrigin(source.recipe.origin),
  });
  await transitionPendingProposal(supabase, proposal.id, 'variant_created');
  return result;
}
