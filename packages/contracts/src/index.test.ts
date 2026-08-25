import { describe, expect, it } from 'vitest';

import * as contracts from './index.ts';

describe('@opendish/contracts', () => {
  it('re-exports the schemas, helpers, and test utilities', () => {
    expect(contracts.recipeDraftSchema).toBeDefined();
    expect(contracts.recipeSnapshotSchema).toBeDefined();
    expect(contracts.recipeImportExtractionMethodSchema).toBeDefined();
    expect(contracts.modificationProposalSchema).toBeDefined();
    expect(contracts.chatOutcomeSchema).toBeDefined();
    expect(contracts.shoppingListItemSchema).toBeDefined();
    expect(contracts.makeQuantity).toBeTypeOf('function');
    expect(contracts.ok).toBeTypeOf('function');
    expect(contracts.err).toBeTypeOf('function');
    expect(contracts.FakeAiProvider).toBeTypeOf('function');
    expect(contracts.validRecipeDraft).toBeDefined();
    expect(contracts.validProposal).toBeDefined();
  });
});
