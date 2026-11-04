import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  RecipeCategory,
  Unit,
} from 'constants/recipeConstants';
import { map, z } from 'zod';
import AppError from './appError';
import { ErrorCode } from 'translations/errorCodes';
import Edit from '@models/editModel';
import { RecipeDocument, Saver } from '@models/recipeModel';
import { normaliseTags } from './tagUtils';

/** Whether the user is one of the recipe's savers */
export const isSavedBy = (savedBy: Saver[], userId: string) =>
  savedBy.some((saver) => saver.userId.equals(userId));

/** Take the user off the recipe's savers. The caller saves the recipe */
export const removeSaver = (recipe: RecipeDocument, userId: string) => {
  recipe.savedBy = recipe.savedBy.filter(
    (saver) => !saver.userId.equals(userId),
  );
};

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
  removeSaver(recipe, authorId);

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

/**
 * Order ingredients so ones sharing a subheader are together. Ingredients
 * without a subheader come first, then each subheader in the order it first
 * appears. The order within each group is kept
 */
export const groupIngredientsBySubheader = <
  T extends { subheader?: string | null },
>(
  ingredients: T[],
): T[] => {
  const groups = new Map<string | null, T[]>([[null, []]]);

  for (const ingredient of ingredients) {
    // '' and ' sauce ' count the same as no subheader and 'sauce'
    const key = ingredient.subheader?.trim() || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ingredient);
  }

  return [...groups.values()].flat();
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
  description?: string | null;
  category: string;
  serves: number;
  prepTime?: number | null;
  cookTime: number;
  ingredients: {
    subheader?: string | null;
    quantity?: number | null;
    name: string;
    unit?: string | null;
  }[];
  steps: string[];
  tags?: string[];
  sourceUrl?: string | null;
  sourceImageHash?: string | null;
}

/** An empty or blank string as null. Anything else is returned unchanged */
const blankToNull = <T>(value: T) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

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
    sourceUrl,
    sourceImageHash,
  } = body as RecipeRequestBody;

  return {
    authorId: userId,
    // authorType, // default used
    bPrivate,
    bAllowSuggestions,
    title,
    description: blankToNull(description) ?? null,
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags: normaliseTags(tags),
    sourceUrl,
    // Set from an image import's draft. Not changeable afterwards
    sourceImageHash,
    // Authors have their own recipes saved
    savedBy: [{ userId, savedAt: new Date() }],
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
    sourceUrl,
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
    // undefined (not sent) is kept, so an update doesn't clear it
    description: blankToNull(description),
    category,
    serves,
    prepTime,
    cookTime,
    ingredients,
    steps,
    tags: normaliseTags(tags),
    sourceUrl,
  };
};
export interface EditSugestionBody {
  id: string;
  isSuggestion: boolean;
  ingredients: {
    subheader?: string | null;
    quantity?: number | null;
    name: string;
    unit?: string | null;
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
    tags: normaliseTags(tags),
    comments,
  };

  // Drop fields that weren't sent, so updating one part of an existing edit
  // (e.g. just the tags) doesn't clear the other parts
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<typeof payload>;
};

// Checked after normaliseTags, so duplicates and spacing don't count towards the limits
const TagsSchema = z
  .array(z.string().max(MAX_TAG_LENGTH))
  .max(MAX_TAGS)
  .optional();

// quantity and unit can be null for things like "salt, to taste". A quantity
// given must be positive, and one without a unit is a count (e.g. 2 eggs)
const IngredientSchema = z.object({
  subheader: z.string().nullable().optional(),
  quantity: z.coerce.number().positive().nullable().optional(),
  name: z.string().min(1),
  unit: z
    .enum(Object.values(Unit) as [string, ...string[]])
    .nullable()
    .optional(),
});

export const RecipeSchema = z.object({
  title: z.string().min(1),
  // Optional, since many imported recipes don't have one. Stored as null
  description: z.string().nullable().optional(),
  bPrivate: z.boolean().optional(),
  bAllowSuggestions: z.boolean().optional(),
  category: z.enum(Object.values(RecipeCategory) as [string, ...string[]]),
  serves: z.coerce.number().positive(),
  // Optional: 0 or null for recipes with no prep. Cook time is still required
  prepTime: z.coerce.number().min(0).nullable().optional(),
  cookTime: z.coerce.number().positive(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string().min(1)),
  tags: TagsSchema,
  sourceUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//i)
    .nullable()
    .optional(),
  sourceImageHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
});
export const EditSchema = z.object({
  ingredients: z.array(IngredientSchema).optional(),
  steps: z.array(z.string().min(1)).optional(),
  tags: TagsSchema,
  comments: z.string().optional(),
});
