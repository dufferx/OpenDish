import type { ModificationProposal, RecipeDraft } from '@opendish/contracts';
import { supabase } from '@/lib/supabase';

export async function previewRecipeModification(
  draft: RecipeDraft,
  request: string,
  signal?: AbortSignal,
): Promise<ModificationProposal> {
  const { data, error } = await supabase.functions.invoke(
    'ai-preview-modification',
    { body: { draft, request }, signal },
  );
  if (error) throw error;
  const proposal = (data as { outcome?: { proposal?: unknown } })?.outcome
    ?.proposal;
  if (!proposal || typeof proposal !== 'object') {
    throw new Error('The AI returned an invalid recipe change.');
  }
  return proposal as ModificationProposal;
}
