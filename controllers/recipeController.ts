import { Types } from 'mongoose';
import Edit, { EditDocument, EditStatus } from '@models/editModel';
import Recipe, { RecipeDocument, Saver } from '@models/recipeModel';
import User from '@models/userModel';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import { normaliseTag } from '@utils/tagUtils';
import {
  applyEditToRecipe,
  constructEditRecipeFromBody,
  constructRecipePayloadFromBody,
  constructUpdateRecipePayloadFromBody,
  EditSchema,
  escapeRegex,
  groupIngredientsBySubheader,
  isSavedBy,
  RecipeSchema,
  releaseRecipeFromAuthor,
  removeRecipe,
  removeSaver,
} from '@utils/recipeUtils';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';

type FormattableRecipe = {
  authorId: Types.ObjectId | null;
  description?: string | null;
  savedBy?: Saver[];
  ingredients: { subheader?: string | null }[];
};

/**
 * Prepare plain recipe objects for a response: add the author's username and
 * whether the user has saved each one, and group ingredients by subheader.
 * savedBy is replaced with a count so other users' IDs aren't sent to the client
 */
const formatRecipesForUser = async <T extends FormattableRecipe>(
  recipes: T[],
  userId: string,
) => {
  // One query for all the authors on the page
  const authorIds = [
    ...new Set(
      recipes.flatMap((r) => (r.authorId ? [String(r.authorId)] : [])),
    ),
  ];
  const authors = await User.find({ _id: { $in: authorIds } }).lean();
  const authorNames = new Map(authors.map((a) => [String(a._id), a.username]));

  return recipes.map(({ savedBy = [], ...recipe }) => ({
    ...recipe,
    // Older recipes may have no description. Send null so the field is always there
    description: recipe.description || null,
    ingredients: groupIngredientsBySubheader(recipe.ingredients),
    // null when the author deleted the recipe or their account
    authorName: recipe.authorId
      ? (authorNames.get(String(recipe.authorId)) ?? null)
      : null,
    bSaved: isSavedBy(savedBy, userId),
    savedCount: savedBy.length,
  }));
};
const formatRecipeForUser = async <T extends FormattableRecipe>(
  recipe: T,
  userId: string,
) => (await formatRecipesForUser([recipe], userId))[0];

/**
 * Plain copies of edits for a response, with the username of who made each
 * one and ingredients grouped by subheader
 */
const formatEdits = async (edits: EditDocument[]) => {
  // One query for all the users on the page
  const userIds = [...new Set(edits.map((edit) => String(edit.userId)))];
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userNames = new Map(users.map((u) => [String(u._id), u.username]));

  return edits.map((edit) => {
    const plain = edit.toObject();
    return {
      ...plain,
      // null if their account has since been deleted
      userName: userNames.get(String(plain.userId)) ?? null,
      ingredients: groupIngredientsBySubheader(plain.ingredients),
    };
  });
};

/** Create a new recipe */
export const createRecipe = catchAsync(async (req, res, next) => {
  const payload = constructRecipePayloadFromBody(req.body, req.user!._id);

  // 1) Validate fields
  RecipeSchema.parse(payload);

  // 2) Create the new Recipe document
  const newRecipe: RecipeDocument = await Recipe.create(payload);
  const recipeCopy = await formatRecipeForUser(
    newRecipe.toObject({ versionKey: false }),
    req.user!.id,
  );
  delete recipeCopy.authorType;

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: recipeCopy,
    },
  });
});
/**
 * View a recipe that the user has access to, with their personal edit applied.
 * Pass ?original=true to see the recipe without it
 */
export const viweRecipe = catchAsync(async (req, res, next) => {
  const recipeId = req.params.id;
  const userId = req.user?.id;
  const bOriginal = req.query.original === 'true';

  const recipe = await Recipe.findOne({
    _id: recipeId,
    $or: [
      { authorId: userId },
      // Public recipes, including ones whose author deleted them, so they can still be shared
      { bPrivate: false },
      // Private recipes whose author deleted them stay visible to people who saved them
      { authorId: null, 'savedBy.userId': userId },
    ],
  });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  const userEdit = await Edit.findOne({
    recipeId,
    userId,
    isSuggestion: false,
  });
  // Convert Mongoose doc to plain object
  const modifiedRecipe = applyEditToRecipe(
    recipe.toObject(),
    bOriginal ? null : userEdit,
  );

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: await formatRecipeForUser(modifiedRecipe, userId),
      // Lets the UI offer "view original" and "reset" options
      bHasEdits: !!userEdit,
    },
  });
});
/**
 * View suggestions for a recipe the user wrote. Only pending ones by default,
 * pass ?bShowAll=true to include accepted and rejected ones
 */
export const viewRecipeSuggestions = catchAsync(async (req, res, next) => {
  const recipe = await Recipe.findOne({
    _id: req.params.id,
    authorId: req.user!.id,
  });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  // Only suggestions, not other users' personal edits
  const edits = await Edit.find({
    recipeId: recipe.id,
    isSuggestion: true,
    ...(req.query.bShowAll === 'true' ? {} : { status: EditStatus.PENDING }),
  }).sort({ _id: -1 });

  res.status(200).json({
    status: Status.Success,
    data: { edits: await formatEdits(edits) },
  });
});
/**
 * Save or unsave a recipe that the user has access to.
 * Unsaving deletes the user's personal edit, so if they have one the request
 * must include bConfirmLoseEdits: true
 */
export const toggleSaveRecipe = catchAsync(async (req, res, next) => {
  const userId = req.user?.id;
  const { id: recipeId, bSave, bConfirmLoseEdits } = req.body;

  if (typeof bSave !== 'boolean') {
    return next(new AppError(ErrorCode.MISSING_FIELDS, 400));
  }

  // 1) Check if recipe exists
  const recipe = await Recipe.findOne({ _id: recipeId });

  // Can only save private recipes you own. Unsaving is allowed for everyone
  // else, so a recipe that was made private can still be removed from your list
  if (
    !recipe ||
    (bSave && recipe.bPrivate && !recipe.authorId?.equals(userId))
  ) {
    return next(new AppError(ErrorCode.Invalid_Recipe, 404));
  }

  // Authors always have their own recipes saved. To get rid of one, they delete it
  if (!bSave && recipe.authorId?.equals(userId)) {
    return next(new AppError(ErrorCode.Author_Cant_Unsave, 400));
  }

  // 2) Unsaving loses the user's personal edit, so make sure they've agreed to that
  if (!bSave) {
    const userEdit = await Edit.findOne({
      recipeId: recipe.id,
      userId,
      isSuggestion: false,
    });

    if (userEdit) {
      if (bConfirmLoseEdits !== true) {
        return next(new AppError(ErrorCode.Confirm_Lose_Edits, 400));
      }
      await userEdit.deleteOne();
    }
  }

  // 3) Update the recipe's savers. Saving again keeps the original savedAt
  if (bSave) {
    if (!isSavedBy(recipe.savedBy, userId))
      recipe.savedBy.push({
        userId: new Types.ObjectId(String(userId)),
        savedAt: new Date(),
      });
  } else {
    removeSaver(recipe, userId);

    // A recipe with no author is only kept for the people who saved it
    if (!recipe.authorId && recipe.savedBy.length === 0) {
      await removeRecipe(recipe);
    }
  }
  await recipe.save();

  res.status(200).json({
    status: Status.Success,
    data: null,
  });
});
/** Update a recipe that the user has created */
export const updateOwnRecipe = catchAsync(async (req, res, next) => {
  // 1) Create payload
  const payload = constructUpdateRecipePayloadFromBody(req.body);

  // 2) Validate fields
  RecipeSchema.partial().parse(payload);

  const recipeId = req.body.id;
  const userId = req.user!.id;

  // 3) Find and update recipe
  const recipe = await Recipe.findOne({ _id: recipeId, bDeleted: false });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  if (!recipe.authorId?.equals(userId)) {
    return next(new AppError(ErrorCode.User_Doesnt_Own_Recipe, 400));
  }

  const updatedRecipe = await Recipe.findOneAndUpdate(
    {
      _id: recipeId,
      authorId: req.user?.id,
      bDeleted: false,
    },
    { $set: payload },
    { new: true, runValidators: true },
  );

  // The recipe could have been deleted between the lookup above and this update
  if (!updatedRecipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: await formatRecipeForUser(updatedRecipe.toObject(), userId),
    },
  });
});
/** Update a saved recipe that another user created */
export const updateSavedRecipe = catchAsync(async (req, res, next) => {
  // 1) Create payload
  const payload = constructEditRecipeFromBody(req.body);

  // 2) Validate fields
  EditSchema.parse(payload);

  const userId = req.user?.id;

  // 3) Check recipe exists
  const recipe = await Recipe.findOne({
    _id: req.body.id,
    'savedBy.userId': userId,
  });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Recipe, 400));
  }
  if (recipe.authorId?.equals(req.user!.id)) {
    return next(new AppError(ErrorCode.Use_Update_Own_Recipe_Endpoint, 400));
  }
  // Recipes without an author have suggestions turned off, so this also covers them
  if (!recipe.bAllowSuggestions && payload.isSuggestion) {
    return next(new AppError(ErrorCode.No_Suggestions, 400));
  }

  const recipeId = recipe.id;

  // 4) Check if the user already has an existing edit for this recipe
  let userEdit = await Edit.findOne({ recipeId, userId, isSuggestion: false });

  if (payload.isSuggestion) {
    // 5a) Suggestions are always a new Edit document
    await Edit.create({ recipeId, userId, ...payload });
  } else if (userEdit) {
    // 5b) If user has existing edit, update it
    userEdit.set(payload);
    await userEdit.save();
  } else {
    // 5c) Create the Edit document
    userEdit = await Edit.create({ recipeId, userId, ...payload });
  }

  // Return the recipe as the user sees it, with their personal edit applied.
  // A suggestion isn't applied until the author accepts it
  const modifiedRecipe = applyEditToRecipe(recipe.toObject(), userEdit);

  res.status(200).json({
    status: Status.Success,
    data: { recipe: await formatRecipeForUser(modifiedRecipe, userId) },
  });
});
/**
 * Delete a recipe that the user created. If other users have it saved it is
 * kept for them without an author, otherwise it is removed
 */
export const deleteRecipe = catchAsync(async (req, res, next) => {
  const { id } = req.body;
  const userId = req.user!.id;

  const recipe = await Recipe.findOne({ _id: id, authorId: userId });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  await releaseRecipeFromAuthor(recipe, userId);
  await recipe.save();

  res.status(200).json({
    status: Status.Success,
    data: null,
  });
});
/**
 * Accept or reject a pending suggestion on a recipe the user wrote.
 * Accepting applies the suggested ingredients, steps and tags to the recipe
 */
export const reviewSuggestion = catchAsync(async (req, res, next) => {
  const { id, bAccept } = req.body;

  if (typeof bAccept !== 'boolean') {
    return next(new AppError(ErrorCode.MISSING_FIELDS, 400));
  }

  // 1) Find the suggestion, and check the user wrote the recipe it's for
  const suggestion = await Edit.findOne({ _id: id, isSuggestion: true });
  const recipe =
    suggestion &&
    (await Recipe.findOne({
      _id: suggestion.recipeId,
      authorId: req.user!.id,
    }));

  if (!suggestion || !recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }
  if (suggestion.status !== EditStatus.PENDING) {
    return next(new AppError(ErrorCode.Suggestion_Already_Reviewed, 400));
  }

  // 2) Apply it to the recipe. Other pending suggestions are left for the
  // author to review one by one
  if (bAccept) {
    const updated = applyEditToRecipe(
      {
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        tags: recipe.tags,
      },
      suggestion,
    );
    recipe.set(updated);
    await recipe.save();
  }

  suggestion.status = bAccept ? EditStatus.ACCEPTED : EditStatus.REJECTED;
  await suggestion.save();

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: await formatRecipeForUser(recipe.toObject(), req.user!.id),
      suggestion: (await formatEdits([suggestion]))[0],
    },
  });
});
/** List the suggestions the user has made, newest first, with their status */
export const mySuggestions = catchAsync(async (req, res, next) => {
  const suggestions = await Edit.find({
    userId: req.user!.id,
    isSuggestion: true,
  })
    .sort({ _id: -1 })
    .populate('recipeId', 'title');

  res.status(200).json({
    status: Status.Success,
    results: suggestions.length,
    data: { suggestions: await formatEdits(suggestions) },
  });
});
/**
 * Suggest existing tags for autocomplete, most used first, so users reuse
 * tags rather than creating near-duplicates. ?search= filters them
 */
export const tagSuggestions = catchAsync(async (req, res, next) => {
  const { search, limit = 10 } = req.query;
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const userId = new Types.ObjectId(String(req.user!.id));

  const tags = await Recipe.aggregate([
    // Only recipes the user can see, so private recipes' tags aren't exposed.
    // Aggregates skip the model's soft delete hook, so filter deleted ones here
    {
      $match: {
        bDeleted: { $ne: true },
        $or: [{ authorId: userId }, { bPrivate: false }],
      },
    },
    { $unwind: '$tags' },
    ...(search
      ? [
          {
            $match: {
              tags: {
                $regex: escapeRegex(normaliseTag(String(search))),
              },
            },
          },
        ]
      : []),
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limitNum },
    // Named tag rather than _id, which would otherwise be renamed to id
    { $project: { _id: 0, tag: '$_id', count: 1 } },
  ]);

  res.status(200).json({
    status: Status.Success,
    data: { tags },
  });
});
/** Remove the user's personal edit so they see the original recipe again */
export const resetRecipeEdit = catchAsync(async (req, res, next) => {
  const { deletedCount } = await Edit.deleteOne({
    recipeId: req.body.id,
    userId: req.user!.id,
    isSuggestion: false,
  });

  if (deletedCount === 0) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  res.status(200).json({
    status: Status.Success,
    data: null,
  });
});
/** Search recipes */
export const searchRecipes = catchAsync(async (req, res, next) => {
  const {
    page = 1,
    limit = 10,
    sort,
    category,
    search,
    authorId,
    bOnlySaved,
    bHideSaved,
    tags,
  } = req.query;

  // Convert query params to appropriate types
  const pageNum = Math.max(Number(page), 1);
  const limitNum = Math.max(Number(limit), 1);
  const skip = (pageNum - 1) * limitNum;

  // IDs are cast to ObjectIds up front because the aggregate used for
  // 'popular' sorting doesn't cast them automatically like find() does
  if (authorId && !Types.ObjectId.isValid(String(authorId))) {
    return next(new AppError(ErrorCode.Invalid_Id, 400));
  }
  const userId = new Types.ObjectId(String(req.user!.id));
  const bSavedOnly = bOnlySaved === 'true';
  const bSavedHidden = bHideSaved === 'true';

  if (bSavedOnly && bSavedHidden) {
    return next(new AppError(ErrorCode.Invalid_Options, 400));
  }

  // Range filters. Missing ones are undefined, anything else must be a
  // number that isn't negative
  const ranges: Record<string, number | undefined> = {};
  for (const key of ['minTime', 'maxTime', 'minServes', 'maxServes']) {
    const value = req.query[key];
    if (value === undefined || value === '') continue;

    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return next(new AppError(ErrorCode.Invalid, 400));
    }
    ranges[key] = num;
  }

  // Base query: only recipes the user has access to (deleted recipes are
  // filtered out in the model). Every filter goes in $and so that filters
  // using $or don't overwrite each other
  const query: any = {
    $and: [
      bSavedOnly
        ? // Your saved list includes recipes whose author deleted them
          {
            'savedBy.userId': userId,
            $or: [
              { authorId: userId },
              { bPrivate: false },
              { authorId: null },
            ],
          }
        : // General search hides recipes whose author deleted them
          {
            $or: [
              { authorId: userId },
              { bPrivate: false, authorId: { $ne: null } },
            ],
          },
    ],
  };

  // Search filter (title or description match)
  if (search) {
    const pattern = escapeRegex(String(search));
    query.$and.push({
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { description: { $regex: pattern, $options: 'i' } },
      ],
    });
  }

  // Leave out everything in the user's saved list, including their own recipes
  if (bSavedHidden) query.$and.push({ 'savedBy.userId': { $ne: userId } });

  // Tags filter: recipes must have every tag asked for. A personal edit that
  // changes the tags replaces the recipe's own tags for this user, as in the
  // results below
  const tagList = [
    ...new Set(
      String(tags ?? '')
        .split(',')
        .map(normaliseTag)
        .filter(Boolean),
    ),
  ];
  if (tagList.length > 0) {
    const editsWithTags = await Edit.find({
      userId,
      isSuggestion: false,
      tags: { $ne: null },
    })
      .select('recipeId tags')
      .lean();
    const editedRecipeIds = editsWithTags.map((edit) => edit.recipeId);
    const matchingEditIds = editsWithTags
      .filter((edit) => tagList.every((tag) => edit.tags!.includes(tag)))
      .map((edit) => edit.recipeId);

    query.$and.push({
      $or: [
        { _id: { $in: matchingEditIds } },
        { _id: { $nin: editedRecipeIds }, tags: { $all: tagList } },
      ],
    });
  }

  // Total time (prep + cook) filter
  const totalTime = { $add: ['$prepTime', '$cookTime'] };
  if (ranges.minTime !== undefined)
    query.$and.push({ $expr: { $gte: [totalTime, ranges.minTime] } });
  if (ranges.maxTime !== undefined)
    query.$and.push({ $expr: { $lte: [totalTime, ranges.maxTime] } });

  // Serves filter
  if (ranges.minServes !== undefined)
    query.$and.push({ serves: { $gte: ranges.minServes } });
  if (ranges.maxServes !== undefined)
    query.$and.push({ serves: { $lte: ranges.maxServes } });

  // Category filter
  if (category) query.category = String(category);

  // Filter by author
  if (authorId) query.authorId = new Types.ObjectId(String(authorId));

  // Sorting logic. Recipes have no createdAt field, but an ObjectId
  // starts with its creation time so sorting by _id sorts by age
  let sortBy: any = { _id: -1 }; // Default: Newest first
  if (sort === 'oldest') sortBy = { _id: 1 };
  if (sort === 'title') sortBy = { title: 1 };

  // Popular sorts by how many users saved the recipe, which find() can't
  // sort by, so it needs an aggregate. Aggregates skip the model's query
  // hooks, so deleted recipes are filtered out here too
  const recipesQuery =
    sort === 'popular'
      ? Recipe.aggregate([
          { $match: { ...query, bDeleted: { $ne: true } } },
          {
            $addFields: {
              savedCount: { $size: { $ifNull: ['$savedBy', []] } },
            },
          },
          { $sort: { savedCount: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limitNum },
          { $project: { savedCount: 0, __v: 0 } },
        ])
      : Recipe.find(query)
          .select('-__v')
          .sort(sortBy)
          .skip(skip)
          .limit(limitNum)
          .lean();

  // Execute query
  const [recipes, total] = await Promise.all([
    recipesQuery,
    Recipe.countDocuments(query),
  ]);

  // Show the user's personal edits (e.g. their tags) in the results. One
  // query for the whole page, using the edits index
  const userEdits = await Edit.find({
    userId,
    isSuggestion: false,
    recipeId: { $in: recipes.map((recipe) => recipe._id) },
  }).lean();
  const editsByRecipe = new Map(
    userEdits.map((edit) => [String(edit.recipeId), edit]),
  );

  res.status(200).json({
    status: Status.Success,
    results: recipes.length,
    totalPages: Math.ceil(total / limitNum),
    currentPage: pageNum,
    data: await formatRecipesForUser(
      recipes.map((recipe) =>
        applyEditToRecipe(recipe, editsByRecipe.get(String(recipe._id))),
      ),
      req.user!.id,
    ),
  });
});
