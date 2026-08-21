import { describe, expect, it } from 'vitest';
import {
  chatOutcomeSchema,
  conversationMessageSchema,
} from './conversation.ts';
import { shoppingListItemSchema } from './shopping-list.ts';
import { validProposal } from './testing/fixtures.ts';

describe('conversationMessageSchema', () => {
  it('accepts user and assistant roles', () => {
    expect(
      conversationMessageSchema.safeParse({ role: 'user', content: 'Hi' })
        .success,
    ).toBe(true);
    expect(
      conversationMessageSchema.safeParse({
        role: 'assistant',
        content: 'Hello',
      }).success,
    ).toBe(true);
  });

  it('rejects other roles and empty content', () => {
    expect(
      conversationMessageSchema.safeParse({ role: 'system', content: 'x' })
        .success,
    ).toBe(false);
    expect(
      conversationMessageSchema.safeParse({ role: 'user', content: '' })
        .success,
    ).toBe(false);
  });
});

describe('chatOutcomeSchema', () => {
  it('accepts an answer outcome', () => {
    expect(
      chatOutcomeSchema.safeParse({ kind: 'answer', content: 'Use 350°F.' })
        .success,
    ).toBe(true);
  });

  it('accepts a proposal outcome', () => {
    expect(
      chatOutcomeSchema.safeParse({ kind: 'proposal', proposal: validProposal })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(
      chatOutcomeSchema.safeParse({ kind: 'draft', content: 'x' }).success,
    ).toBe(false);
  });
});

describe('shoppingListItemSchema', () => {
  it('accepts a quantity-less item', () => {
    expect(
      shoppingListItemSchema.safeParse({
        name: 'Bread',
        quantity: null,
        unit: null,
        isPurchased: false,
      }).success,
    ).toBe(true);
  });

  it('rejects a missing isPurchased flag and an empty name', () => {
    expect(
      shoppingListItemSchema.safeParse({
        name: 'Bread',
        quantity: null,
        unit: null,
      }).success,
    ).toBe(false);
    expect(
      shoppingListItemSchema.safeParse({
        name: '',
        quantity: null,
        unit: null,
        isPurchased: false,
      }).success,
    ).toBe(false);
  });
});
