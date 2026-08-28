import type {
  AiCredentials,
  AiProvider,
  GenerateRecipeOutcome,
  Result,
} from '../ai-provider.ts';
import type {
  NutritionEstimateIngredient,
  NutritionEstimateItem,
  ProductLabelDraft,
} from '../nutrition.ts';
import { ok } from '../ai-provider.ts';
import type { ConversationMessage } from '../conversation.ts';
import type { ModificationProposal } from '../modification.ts';
import type { RecipeDraft, RecipeSnapshot } from '../recipe.ts';
import { validProposal, validRecipeDraft } from './fixtures.ts';

/**
 * Canned responses for the fake provider. Any method left unset falls back
 * to a valid default fixture, so tests only configure what they assert on.
 */
export interface FakeAiProviderResponses {
  validateCredentials?: Result<null>;
  generateRecipe?: Result<GenerateRecipeOutcome>;
  answerRecipeQuestion?: Result<string>;
  proposeRecipeModification?: Result<ModificationProposal>;
  extractRecipe?: Result<RecipeDraft>;
  extractProductLabel?: Result<ProductLabelDraft>;
  estimateNutrition?: Result<NutritionEstimateItem[]>;
}

export type FakeAiProviderCall =
  | { method: 'validateCredentials'; credentials: AiCredentials }
  | {
      method: 'generateRecipe';
      conversation: ConversationMessage[];
      credentials: AiCredentials;
    }
  | {
      method: 'answerRecipeQuestion';
      recipe: RecipeSnapshot;
      recentMessages: ConversationMessage[];
      question: string;
      credentials: AiCredentials;
    }
  | {
      method: 'proposeRecipeModification';
      recipe: RecipeSnapshot;
      request: string;
      credentials: AiCredentials;
    }
  | {
      method: 'extractRecipe';
      rawContent: string;
      credentials: AiCredentials;
    }
  | {
      method: 'extractProductLabel';
      imageDataUrl: string;
      credentials: AiCredentials;
    }
  | {
      method: 'estimateNutrition';
      ingredients: NutritionEstimateIngredient[];
      credentials: AiCredentials;
    };

/**
 * Deterministic `AiProvider` test double (T027): records every call and
 * returns canned or default responses. Zero live AI calls.
 */
export class FakeAiProvider implements AiProvider {
  readonly calls: FakeAiProviderCall[] = [];

  private readonly responses: FakeAiProviderResponses;

  constructor(responses: FakeAiProviderResponses = {}) {
    this.responses = responses;
  }

  validateCredentials(credentials: AiCredentials): Promise<Result<null>> {
    this.calls.push({ method: 'validateCredentials', credentials });
    return Promise.resolve(this.responses.validateCredentials ?? ok(null));
  }

  generateRecipe(
    conversation: ConversationMessage[],
    credentials: AiCredentials,
  ): Promise<Result<GenerateRecipeOutcome>> {
    this.calls.push({ method: 'generateRecipe', conversation, credentials });
    return Promise.resolve(
      this.responses.generateRecipe ??
        ok({ kind: 'draft', draft: validRecipeDraft }),
    );
  }

  answerRecipeQuestion(
    recipe: RecipeSnapshot,
    recentMessages: ConversationMessage[],
    question: string,
    credentials: AiCredentials,
  ): Promise<Result<string>> {
    this.calls.push({
      method: 'answerRecipeQuestion',
      recipe,
      recentMessages,
      question,
      credentials,
    });
    return Promise.resolve(
      this.responses.answerRecipeQuestion ?? ok('Fake provider answer.'),
    );
  }

  proposeRecipeModification(
    recipe: RecipeSnapshot,
    request: string,
    credentials: AiCredentials,
  ): Promise<Result<ModificationProposal>> {
    this.calls.push({
      method: 'proposeRecipeModification',
      recipe,
      request,
      credentials,
    });
    return Promise.resolve(
      this.responses.proposeRecipeModification ?? ok(validProposal),
    );
  }

  extractRecipe(
    rawContent: string,
    credentials: AiCredentials,
  ): Promise<Result<RecipeDraft>> {
    this.calls.push({ method: 'extractRecipe', rawContent, credentials });
    return Promise.resolve(
      this.responses.extractRecipe ?? ok(validRecipeDraft),
    );
  }

  extractProductLabel(
    imageDataUrl: string,
    credentials: AiCredentials,
  ): Promise<Result<ProductLabelDraft>> {
    this.calls.push({
      method: 'extractProductLabel',
      imageDataUrl,
      credentials,
    });
    return Promise.resolve(
      this.responses.extractProductLabel ??
        ok({
          name: 'Fake product',
          brand: null,
          servingSizeText: '1 serving',
          servingMassG: 100,
          servingVolumeMl: null,
          calories: 100,
          proteinGrams: 10,
          carbohydratesGrams: 5,
        }),
    );
  }

  estimateNutrition(
    ingredients: NutritionEstimateIngredient[],
    credentials: AiCredentials,
  ): Promise<Result<NutritionEstimateItem[]>> {
    this.calls.push({ method: 'estimateNutrition', ingredients, credentials });
    return Promise.resolve(
      this.responses.estimateNutrition ??
        ok(
          ingredients.map((ingredient) => ({
            name: ingredient.name,
            calories: 0,
            proteinGrams: 0,
            carbohydratesGrams: 0,
          })),
        ),
    );
  }
}
