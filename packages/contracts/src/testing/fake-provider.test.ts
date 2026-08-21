import { describe, expect, it } from 'vitest';
import type { AiCredentials } from '../ai-provider.ts';
import { modificationProposalSchema } from '../modification.ts';
import { recipeDraftSchema } from '../recipe.ts';
import { FakeAiProvider } from './fake-provider.ts';
import {
  validProposal,
  validRecipeDraft,
  validRecipeSnapshot,
} from './fixtures.ts';

const credentials: AiCredentials = { apiKey: 'sk-test', model: 'test-model' };

describe('fixtures', () => {
  it('validRecipeDraft passes recipeDraftSchema', () => {
    expect(recipeDraftSchema.safeParse(validRecipeDraft).success).toBe(true);
  });

  it('validProposal passes modificationProposalSchema', () => {
    expect(modificationProposalSchema.safeParse(validProposal).success).toBe(
      true,
    );
  });
});

describe('FakeAiProvider', () => {
  it('returns valid default fixtures that pass their schemas', async () => {
    const provider = new FakeAiProvider();

    const generated = await provider.generateRecipe(
      [{ role: 'user', content: 'Something with tomatoes' }],
      credentials,
    );
    expect(generated.ok).toBe(true);
    if (!generated.ok || generated.value.kind !== 'draft') {
      throw new Error('expected a draft outcome');
    }
    expect(recipeDraftSchema.safeParse(generated.value.draft).success).toBe(
      true,
    );

    const proposal = await provider.proposeRecipeModification(
      validRecipeSnapshot,
      'Double it',
      credentials,
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) throw new Error('expected a proposal');
    expect(modificationProposalSchema.safeParse(proposal.value).success).toBe(
      true,
    );

    const extracted = await provider.extractRecipe(
      'raw page text',
      credentials,
    );
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) throw new Error('expected a draft');
    expect(recipeDraftSchema.safeParse(extracted.value).success).toBe(true);

    const answer = await provider.answerRecipeQuestion(
      validRecipeSnapshot,
      [],
      'Can I freeze it?',
      credentials,
    );
    expect(answer.ok).toBe(true);

    const validated = await provider.validateCredentials(credentials);
    expect(validated).toEqual({ ok: true, value: null });
  });

  it('records every call with its arguments', async () => {
    const provider = new FakeAiProvider();
    const conversation = [{ role: 'user' as const, content: 'Hi' }];

    await provider.generateRecipe(conversation, credentials);
    await provider.proposeRecipeModification(
      validRecipeSnapshot,
      'Make it vegan',
      credentials,
    );

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toEqual({
      method: 'generateRecipe',
      conversation,
      credentials,
    });
    expect(provider.calls[1]).toEqual({
      method: 'proposeRecipeModification',
      recipe: validRecipeSnapshot,
      request: 'Make it vegan',
      credentials,
    });
  });

  it('supports canned responses, including errors', async () => {
    const provider = new FakeAiProvider({
      generateRecipe: {
        ok: true,
        value: { kind: 'clarify', question: 'For how many people?' },
      },
      answerRecipeQuestion: {
        ok: false,
        error: { code: 'timeout', message: 'provider timed out' },
      },
    });

    const generated = await provider.generateRecipe([], credentials);
    expect(generated).toEqual({
      ok: true,
      value: { kind: 'clarify', question: 'For how many people?' },
    });

    const answer = await provider.answerRecipeQuestion(
      validRecipeSnapshot,
      [],
      'q',
      credentials,
    );
    expect(answer).toEqual({
      ok: false,
      error: { code: 'timeout', message: 'provider timed out' },
    });
  });
});
