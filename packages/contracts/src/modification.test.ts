import { describe, expect, it } from 'vitest';
import {
  modificationOpSchema,
  modificationProposalSchema,
} from './modification.ts';
import { validProposal, validRecipeDraft } from './testing/fixtures.ts';

describe('modificationOpSchema', () => {
  const validOps: [string, unknown][] = [
    [
      'addIngredient',
      {
        kind: 'addIngredient',
        ingredient: { name: 'Basil', quantity: null, unit: null },
      },
    ],
    [
      'addIngredient with afterPosition',
      {
        kind: 'addIngredient',
        ingredient: { name: 'Basil', quantity: null, unit: null },
        afterPosition: 2,
      },
    ],
    ['removeIngredient', { kind: 'removeIngredient', position: 0 }],
    [
      'updateIngredient',
      {
        kind: 'updateIngredient',
        position: 1,
        patch: { quantity: { num: 1, den: 2 } },
      },
    ],
    ['addStep', { kind: 'addStep', step: { text: 'Rest for 10 minutes.' } }],
    ['removeStep', { kind: 'removeStep', position: 0 }],
    [
      'updateStep',
      { kind: 'updateStep', position: 1, text: 'Bake until golden.' },
    ],
    ['reorderSteps', { kind: 'reorderSteps', order: [2, 0, 1] }],
    ['setServings', { kind: 'setServings', servings: 4 }],
    ['setTitle', { kind: 'setTitle', title: 'New title' }],
    [
      'setDescription',
      { kind: 'setDescription', description: 'Updated description.' },
    ],
    ['setTimes', { kind: 'setTimes', prepTimeMinutes: 15 }],
    ['setTimes clearing a value', { kind: 'setTimes', cookTimeMinutes: null }],
  ];

  for (const [name, op] of validOps) {
    it(`accepts ${name}`, () => {
      expect(modificationOpSchema.safeParse(op).success).toBe(true);
    });
  }

  it('rejects an unknown kind', () => {
    expect(
      modificationOpSchema.safeParse({ kind: 'deleteRecipe' }).success,
    ).toBe(false);
  });

  it('rejects setServings below 1 and negative positions', () => {
    expect(
      modificationOpSchema.safeParse({ kind: 'setServings', servings: 0 })
        .success,
    ).toBe(false);
    expect(
      modificationOpSchema.safeParse({ kind: 'removeStep', position: -1 })
        .success,
    ).toBe(false);
  });
});

describe('modificationProposalSchema', () => {
  it('accepts the valid fixture', () => {
    expect(modificationProposalSchema.safeParse(validProposal).success).toBe(
      true,
    );
  });

  it('rejects an empty operations array', () => {
    expect(
      modificationProposalSchema.safeParse({
        ...validProposal,
        operations: [],
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid resultingRecipe', () => {
    expect(
      modificationProposalSchema.safeParse({
        ...validProposal,
        resultingRecipe: { ...validRecipeDraft, ingredients: [] },
      }).success,
    ).toBe(false);
  });
});
