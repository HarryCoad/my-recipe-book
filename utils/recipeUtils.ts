import { RecipeCategory, Unit } from 'constants/recipeConstants';
import { map, z } from 'zod';
import AppError from './appError';
import { ErrorCode } from 'translations/errorCodes';

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
  comments: string;
}
export const constructEditRecipeFromBody = (body: EditSugestionBody) => {
  const { id, isSuggestion, ingredients, steps, comments, ...rest } = body;

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
    isSuggestion,
    ingredients,
    steps,
    comments,
  };
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
  comments: z.string().optional(),
});
