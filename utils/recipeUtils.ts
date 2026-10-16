import { RecipeCategory, Unit } from 'constants/recipeConstants';
import { map, z } from 'zod';
import AppError from './appError';
import { ErrorCode } from 'translations/errorCodes';
import Edit from '@models/editModel';
import { RecipeDocument } from '@models/recipeModel';

/**
 * Permanently remove a recipe nobody needs any more, along with all its edits.
 * The caller saves the recipe
 */
export const removeRecipe = async (recipe: RecipeDocument) => {
  recipe.bDeleted = true;
  await Edit.deleteMany({ recipeId: recipe.id });
};

/**
 * Remove a recipe's author (when they delete it or their account). If other
 * users have it saved it is kept for them without an author, otherwise it is
 * removed. The caller saves the recipe
 */
export const releaseRecipeFromAuthor = async (
  recipe: RecipeDocument,
  authorId: string,
) => {
  // The author no longer has it saved
  recipe.savedBy = recipe.savedBy.filter((user) => !user.equals(authorId));

  if (recipe.savedBy.length === 0) {
    await removeRecipe(recipe);
  } else {
    // Keep it, frozen, for the users who saved it. Nobody is left to review
    // suggestions, so turn them off and remove any pending ones
    recipe.authorId = null;
    recipe.bAllowSuggestions = false;
    await Edit.deleteMany({ recipeId: recipe.id, isSuggestion: true });
  }
};

/** Escape user input so it is matched literally inside a RegExp */
export const escapeRegex = (str: string) =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Overlay a user's personal edit onto a recipe, keeping the original fields the edit leaves empty */
export const applyEditToRecipe = <
  T extends { ingredients: unknown[]; steps: string[]; tags: string[] },
>(
  recipe: T,
  edit?: {
    ingredients?: T['ingredients'];
    steps?: string[];
    tags?: string[] | null;
  } | null,
): T => {
  if (!edit) return recipe;
  return {
    ...recipe,
    ingredients:
      edit.ingredients && edit.ingredients.length > 0
        ? edit.ingredients
        : recipe.ingredients,
    steps: edit.steps && edit.steps.length > 0 ? edit.steps : recipe.steps,
    // Unlike ingredients and steps, an empty tags list is a valid edit
    // (the user removed them all), so only a missing tags field falls back
    tags: edit.tags ?? recipe.tags,
  };
};

export interface RecipeRequestBody {
  authorType?: string;
  bPrivate?: boolean;
  bAllowSuggestions?: boolean;
  title: string;
  description?: string;
  category: string;
  serves: number;
  prepTime: number;
  cookTime: number;
  ingredients: {
    subheader?: string | null;
    quantity: number;
    name: string;
    unit: string;
  }[];
  steps: string[];
  tags?: string[];
}

export const constructRecipePayloadFromBody = (
  body: RecipeRequestBody,
  userId: string,
) => {
  const {
    bPrivate,
    bAllowSuggestions,
    title,
    description,
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags,
  } = body as RecipeRequestBody;

  return {
    authorId: userId,
    // authorType, // default used
    bPrivate,
    bAllowSuggestions,
    title,
    description,
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags,
    savedBy: [userId],
  };
};
export const constructUpdateRecipePayloadFromBody = (
  body: RecipeRequestBody & { id: string },
) => {
  const {
    id,
    authorType,
    bPrivate,
    bAllowSuggestions,
    title,
    description,
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags,
    ...rest
  } = body;

  if (Object.keys(rest).length > 0) {
    throw new AppError(
      ErrorCode.Invalid_Fieldname,
      401,
      Object.keys(rest).map((key) => ({
        fieldname: key,
        code: ErrorCode.Invalid_Fieldname,
      })),
    );
  }

  return {
    bPrivate,
    bAllowSuggestions,
    title,
    description,
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags,
  };
};
export interface EditSugestionBody {
  id: string;
  isSuggestion: boolean;
  ingredients: {
    subheader?: string | null;
    quantity: number;
    name: string;
    unit: string;
  }[];
  steps: string[];
  tags?: string[];
  comments: string;
}
export const constructEditRecipeFromBody = (body: EditSugestionBody) => {
  const { id, isSuggestion, ingredients, steps, tags, comments, ...rest } =
    body;

  if (Object.keys(rest).length > 0) {
    throw new AppError(
      ErrorCode.Invalid_Fieldname,
      401,
      Object.keys(rest).map((key) => ({
        fieldname: key,
        code: ErrorCode.Invalid_Fieldname,
      })),
    );
  }

  const payload = {
    isSuggestion,
    ingredients,
    steps,
    tags,
    comments,
  };

  // Drop fields that weren't sent, so updating one part of an existing edit
  // (e.g. just the tags) doesn't clear the other parts
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<typeof payload>;
};

export const RecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  bPrivate: z.boolean().optional(),
  bAllowSuggestions: z.boolean().optional(),
  category: z.enum(Object.values(RecipeCategory) as [string, ...string[]]),
  serves: z.coerce.number().positive(),
  prepTime: z.coerce.number().positive(),
  cookTime: z.coerce.number().positive(),
  ingredients: z.array(
    z.object({
      subheader: z.string().nullable().optional(),
      quantity: z.coerce.number().positive(),
      name: z.string(),
      unit: z.enum(Object.values(Unit) as [string, ...string[]]),
    }),
  ),
  steps: z.array(z.string().min(1)),
  tags: z.array(z.string()).optional(),
});
export const EditSchema = z.object({
  ingredients: z
    .array(
      z.object({
        subheader: z.string().nullable().optional(),
        quantity: z.coerce.number().positive(),
        name: z.string(),
        unit: z.enum(Object.values(Unit) as [string, ...string[]]),
      }),
    )
    .optional(),
  steps: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string()).optional(),
  comments: z.string().optional(),
});
