import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { formatZodIssues } from '@controllers/errorControllers';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import { RecipeSchema } from '@utils/recipeUtils';
import { normaliseTags } from '@utils/tagUtils';
import {
  ExtractedRecipe,
  extractRecipe,
  ImageMediaType,
} from '@utils/recipeImport/extract';
import { fetchPage } from '@utils/recipeImport/fetchPage';
import { matchCategory, matchUnit } from '@utils/recipeImport/normalise';
import { parsePage } from '@utils/recipeImport/parsePage';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';

// Claude's limit for a single image
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Imports cost money (a Claude call each), so they have their own limit per
 * user on top of the app's general one. Must come after authController.protect
 */
export const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => String(req.user!.id),
  handler: (_req, _res, next) =>
    next(new AppError(ErrorCode.Too_Many_Imports, 429)),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
}).single('image');

/** Read the uploaded image into memory, turning multer's errors into ours */
export const uploadImage = (req: Request, res: Response, next: NextFunction) =>
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(ErrorCode.Image_Too_Large, 413));
    }
    if (err) return next(new AppError(ErrorCode.Invalid_Image, 400));
    next();
  });

/**
 * Work out an image's type from its first bytes rather than trusting the
 * type the client sent. Only the formats Claude accepts are recognised
 */
const imageType = (data: Buffer): ImageMediaType | null => {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
};

/**
 * Turn an extracted recipe into a create body for the user to check. It's
 * returned even if it isn't valid yet, with issues listing the fields to fix.
 * Imports are private by default, since they're usually someone else's recipe
 */
const toDraft = (recipe: ExtractedRecipe, sourceUrl: string | null) => {
  const draft = {
    ...recipe,
    category: matchCategory(recipe.category),
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      unit: matchUnit(ingredient.unit),
    })),
    tags: normaliseTags(recipe.tags),
    bPrivate: true,
    sourceUrl,
  };
  const result = RecipeSchema.safeParse(draft);

  return {
    draft,
    issues: result.success ? [] : formatZodIssues(result.error.errors),
  };
};

/** Import a recipe from a web page. Returns a draft, nothing is saved */
export const importFromUrl = catchAsync(async (req, res, next) => {
  const { url } = req.body;
  if (typeof url !== 'string' || url.trim() === '') {
    return next(new AppError(ErrorCode.Invalid_Url, 400));
  }

  const { html, finalUrl } = await fetchPage(url.trim());
  const page = parsePage(html);
  const recipe = page.content
    ? await extractRecipe({ text: page.content })
    : null;

  if (!recipe) {
    return next(new AppError(ErrorCode.No_Recipe_Found, 422));
  }

  res.status(200).json({
    status: Status.Success,
    data: toDraft(recipe, finalUrl),
  });
});

/** Import a recipe from an uploaded image. Returns a draft, nothing is saved */
export const importFromImage = catchAsync(async (req, res, next) => {
  const mediaType = req.file && imageType(req.file.buffer);
  if (!req.file || !mediaType) {
    return next(new AppError(ErrorCode.Invalid_Image, 400));
  }

  const recipe = await extractRecipe({ image: req.file.buffer, mediaType });
  if (!recipe) {
    return next(new AppError(ErrorCode.No_Recipe_Found, 422));
  }

  res.status(200).json({
    status: Status.Success,
    data: toDraft(recipe, null),
  });
});
