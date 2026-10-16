import { Types } from 'mongoose';
import Edit, { EditDocument, EditStatus } from '@models/editModel';
import Recipe, { RecipeDocument } from '@models/recipeModel';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import {
  applyEditToRecipe,
  constructEditRecipeFromBody,
  constructRecipePayloadFromBody,
  constructUpdateRecipePayloadFromBody,
  EditSchema,
  escapeRegex,
  RecipeSchema,
} from '@utils/recipeUtils';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';

/** Create a new recipe */
export const createRecipe = catchAsync(async (req, res, next) => {
  const payload = constructRecipePayloadFromBody(req.body, req.user!._id);

  // 1) Validate fields
  RecipeSchema.parse(payload);

  // 2) Create the new Recipe document
  const newRecipe: RecipeDocument = await Recipe.create(payload);
  const recipeCopy: Partial<RecipeDocument> = newRecipe.toObject({
    versionKey: false,
  });
  delete recipeCopy.authorType;

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: recipeCopy,
    },
  });
});
/** View a recipe that the user has access to */
export const viweRecipe = catchAsync(async (req, res, next) => {
  const recipeId = req.params.id;
  const userId = req.user?.id;

  // const recipe = await Recipe.findById(req.params.id);
  const recipe = await Recipe.findOne({
    _id: recipeId,
    $or: [{ authorId: userId }, { bPrivate: false }],
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
  const modifiedRecipe = applyEditToRecipe(recipe.toObject(), userEdit);

  res.status(200).json({
    status: Status.Success,
    data: {
      recipe: modifiedRecipe,
    },
  });
});
/** View Recipe suggestions */
export const viewRecipeSuggestions = catchAsync(async (req, res, next) => {
  const recipe = await Recipe.findOne({
    _id: req.params.id,
    authorId: req.user!.id,
  });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  // Only suggestions, not other users' personal edits
  const edits = await Edit.find({ recipeId: recipe.id, isSuggestion: true });

  res.status(200).json({
    status: Status.Success,
    data: { edits },
  });
});
/** Save a recipe that the user has access to */
export const toggleSaveRecipe = catchAsync(async (req, res, next) => {
  const userId = req.user?.id;
  const { id: recipeId, bSave } = req.body;

  if (typeof bSave !== 'boolean') {
    return next(new AppError(ErrorCode.MISSING_FIELDS, 400));
  }

  // 1) Check if recipe exists
  const recipe = await Recipe.findOne({ _id: recipeId });

  // Can only save private recipes you own. Unsaving is always allowed, so a
  // recipe that was made private can still be removed from your list
  if (!recipe || (bSave && recipe.bPrivate && !recipe.authorId.equals(userId))) {
    return next(new AppError(ErrorCode.Invalid_Recipe, 404));
  }

  // 2) Add recipe to user's saved list
  if (bSave) {
    // Update user saved list
    if (
      !req.user?.savedRecipes.some((saved) => saved.recipeId.equals(recipeId))
    )
      req.user!.savedRecipes.push({ recipeId });

    // Update recipe saved list
    if (!recipe.savedBy.some((id) => id.equals(userId)))
      recipe.savedBy.push(userId);
  } else {
    // Update user saved list
    req.user!.savedRecipes = req.user!.savedRecipes.filter(
      (saved) => !saved.recipeId.equals(recipeId),
    );
    // Update recipe saved list
    recipe.savedBy = recipe.savedBy.filter((user) => !user.equals(userId));
  }
  await req.user?.save();
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

  if (!recipe.authorId.equals(userId)) {
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
    data: { recipe: updatedRecipe },
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
    savedBy: { $elemMatch: { $eq: userId } },
  });

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Recipe, 400));
  }
  if (recipe.authorId.equals(req.user!.id)) {
    return next(new AppError(ErrorCode.Use_Update_Own_Recipe_Endpoint, 400));
  }
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
    data: { recipe: modifiedRecipe },
  });
});
/** Delete a recipe that the user created */
export const deleteRecipe = catchAsync(async (req, res, next) => {
  const { id } = req.body;

  const recipe = await Recipe.findOneAndUpdate(
    {
      _id: id,
      authorId: req.user?.id,
    },
    { bDeleted: true },
  );

  if (!recipe) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  // Hard delete all associated edits
  await Edit.deleteMany({ recipeId: id });

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

  // Base query: only recipes the user has access to (deleted recipes are
  // filtered out in the model). Every filter goes in $and so that filters
  // using $or don't overwrite each other
  const query: any = {
    $and: [{ $or: [{ authorId: userId }, { bPrivate: false }] }],
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

  // Category filter
  if (category) query.category = String(category);

  // Filter by author
  if (authorId) query.authorId = new Types.ObjectId(String(authorId));

  // Only saved recipes. Query params are strings, so ?bOnlySaved=false is truthy
  if (bOnlySaved === 'true') query.savedBy = userId;

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
      : Recipe.find(query).sort(sortBy).skip(skip).limit(limitNum);

  // Execute query
  const [recipes, total] = await Promise.all([
    recipesQuery,
    Recipe.countDocuments(query),
  ]);

  res.status(200).json({
    status: Status.Success,
    results: recipes.length,
    totalPages: Math.ceil(total / limitNum),
    currentPage: pageNum,
    data: recipes,
  });
});
