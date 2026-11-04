import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { formatZodIssues } from '@controllers/errorControllers';
import { createRecipeForUser } from '@controllers/recipeController';
import Recipe from '@models/recipeModel';
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
import {
  matchCategory,
  matchUnit,
  normaliseSourceUrl,
} from '@utils/recipeImport/normalise';
import { parsePage } from '@utils/recipeImport/parsePage';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';

// Claude's limit for a single image
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// High enough to move a whole collection over quickly. At about $0.001 an
// import (Haiku), it caps a user at roughly 10 cents an hour
export const IMPORTS_PER_HOUR = 100;

/**
 * Imports cost money (a Claude call each), so they have their own limit per
 * user on top of the app's general one. Must come after authController.protect
 */
export const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: IMPORTS_PER_HOUR,
  keyGenerator: (req) => String(req.user!.id),
  handler: (_req, _res, next) =>
    next(new AppError(ErrorCode.Too_Many_Imports, 429)),
});

// Up to 4 photos of one recipe, e.g. a cookbook recipe over two pages. Even
// at 5 MB each this stays under Claude's 32 MB request limit
export const MAX_IMAGES = 4;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
}).array('image', MAX_IMAGES);

/** Read the uploaded images into memory, turning multer's errors into ours */
export const uploadImage = (req: Request, res: Response, next: NextFunction) =>
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(ErrorCode.Image_Too_Large, 413));
      }
      // Too many files in the image field. A file in any other field is
      // just an invalid request
      if (
        err.code === 'LIMIT_FILE_COUNT' ||
        (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'image')
      ) {
        return next(new AppError(ErrorCode.Too_Many_Images, 400));
      }
    }
    if (err) return next(new AppError(ErrorCode.Invalid_Image, 400));
    next();
  });

/** Booleans from JSON bodies, or 'true' from multipart form fields */
const isTrue = (value: unknown) => value === true || value === 'true';

/** A hash of the images, in order, to recognise the same photos again */
const hashImages = (images: Buffer[]) => {
  const hash = crypto.createHash('sha256');
  for (const image of images) {
    hash.update(crypto.createHash('sha256').update(image).digest());
  }
  return hash.digest('hex');
};

/**
 * A recipe already in the user's book (one they wrote or saved) that came
 * from the same page or the same photos
 */
const findDuplicate = async (
  userId: string,
  source: { sourceUrl: string } | { sourceImageHash: string },
) => {
  const recipe = await Recipe.findOne({ 'savedBy.userId': userId, ...source })
    .select('title')
    .lean();
  return recipe && { id: recipe._id, title: recipe.title };
};

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
const toDraft = (recipe: ExtractedRecipe, source: ImportSource) => {
  const draft = {
    ...recipe,
    category: matchCategory(recipe.category),
    ingredients: recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      unit: matchUnit(ingredient.unit),
    })),
    tags: normaliseTags(recipe.tags),
    bPrivate: true,
    sourceUrl: 'sourceUrl' in source ? source.sourceUrl : null,
    sourceImageHash:
      'sourceImageHash' in source ? source.sourceImageHash : null,
  };
  const result = RecipeSchema.safeParse(draft);

  return {
    draft,
    issues: result.success ? [] : formatZodIssues(result.error.errors),
  };
};

type ImportSource = { sourceUrl: string } | { sourceImageHash: string };

/**
 * Finish an import once we know where it came from:
 * 1. If that page or those photos are already in the user's book, stop
 *    before calling Claude and return duplicateOf, unless bAllowDuplicate.
 *    That keeps bulk imports cheap when people re-run the same files.
 * 2. Otherwise extract the recipe and return the draft for review.
 * 3. With bSkipReview, a draft with no issues is created straight away. A
 *    draft with issues is never created, and comes back for review.
 * Booleans are true or 'true', since multipart form fields are strings
 */
const runImport = async (
  req: Request,
  res: Response,
  next: NextFunction,
  source: ImportSource,
  extract: () => Promise<ExtractedRecipe | null>,
) => {
  const userId = req.user!.id;

  if (!isTrue(req.body?.bAllowDuplicate)) {
    const duplicateOf = await findDuplicate(userId, source);
    if (duplicateOf) {
      return res.status(200).json({
        status: Status.Success,
        data: { draft: null, issues: [], recipe: null, duplicateOf },
      });
    }
  }

  const recipe = await extract();
  if (!recipe) {
    return next(new AppError(ErrorCode.No_Recipe_Found, 422));
  }

  const { draft, issues } = toDraft(recipe, source);
  const created =
    isTrue(req.body?.bSkipReview) && issues.length === 0
      ? await createRecipeForUser(draft, userId)
      : null;

  res.status(200).json({
    status: Status.Success,
    data: { draft, issues, recipe: created, duplicateOf: null },
  });
};

/**
 * Import a recipe from a web page. Returns a draft, or creates the recipe
 * with bSkipReview
 */
export const importFromUrl = catchAsync(async (req, res, next) => {
  const { url } = req.body;
  if (typeof url !== 'string' || url.trim() === '') {
    return next(new AppError(ErrorCode.Invalid_Url, 400));
  }

  const { html, finalUrl } = await fetchPage(url.trim());

  await runImport(
    req,
    res,
    next,
    { sourceUrl: normaliseSourceUrl(finalUrl) },
    async () => {
      const page = parsePage(html);
      return page.content ? extractRecipe({ text: page.content }) : null;
    },
  );
});

/**
 * Import a recipe from up to 4 uploaded images of it, in order. Returns a
 * draft, or creates the recipe with bSkipReview
 */
export const importFromImage = catchAsync(async (req, res, next) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const images = files.map((file) => ({
    data: file.buffer,
    mediaType: imageType(file.buffer),
  }));

  if (images.length === 0 || images.some((image) => !image.mediaType)) {
    return next(new AppError(ErrorCode.Invalid_Image, 400));
  }

  await runImport(
    req,
    res,
    next,
    { sourceImageHash: hashImages(files.map((file) => file.buffer)) },
    () =>
      extractRecipe({
        images: images.map((image) => ({
          data: image.data,
          mediaType: image.mediaType!,
        })),
      }),
  );
});
