import Edit, { EditDocument, EditStatus } from '@models/editModel';
import Recipe, { RecipeDocument } from '@models/recipeModel';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import {
  constructEditRecipeFromBody,
  constructRecipePayloadFromBody,
  constructUpdateRecipePayloadFromBody,
  EditSchema,
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

  let modifiedRecipe = recipe.toObject(); // Convert Mongoose doc to plain object
  const userEdit = await Edit.findOne({
    recipeId,
    userId,
    isSuggestion: false,
  });
  if (userEdit) {
    modifiedRecipe.ingredients =
      userEdit.ingredients.length > 0
        ? userEdit.ingredients
        : modifiedRecipe.ingredients;
    modifiedRecipe.steps =
      userEdit.steps.length > 0 ? userEdit.steps : modifiedRecipe.steps;
  }

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

  const edits = await Edit.find({ recipeId: recipe.id });

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

  if (!recipe) {
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
    recipe.savedBy = recipe.savedBy.filter((user) => user !== userId);
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

  if (!recipe) {
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

  // 5a) If user has existing edit, update it
  if (userEdit && !payload.isSuggestion) {
    userEdit.set(payload);
    await userEdit.save();
  } else {
    // 5b) Create the Edit document
    userEdit = await Edit.create({
      recipeId,
      userId,
      ...payload,
    });
  }

  let modifiedRecipe = recipe.toObject(); // Convert Mongoose doc to plain object

  modifiedRecipe.ingredients =
    userEdit.ingredients ?? modifiedRecipe.ingredients;
  modifiedRecipe.steps = userEdit.steps ?? modifiedRecipe.steps;

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

  // Base query (exclude deleted recipes)
  // const query: any = { bDeleted: false };
  const query: any = {};

  // Search filter (title or description match)
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // Category filter
  if (category) query.category = category;

  // Filter by author
  if (authorId) query.authorId = authorId;

  // Only saved recipes (if user is logged in)
  if (bOnlySaved && req.user) {
    query.savedBy = { $in: [req.user.id] };
  }

  // Sorting logic
  let sortBy: any = { createdAt: -1 }; // Default: Newest first
  if (sort === 'oldest') sortBy = { createdAt: 1 };
  if (sort === 'title') sortBy = { title: 1 };
  if (sort === 'popular') sortBy = { savedBy: -1 }; // Assuming savedBy count represents popularity

  // Execute query
  const [recipes, total] = await Promise.all([
    Recipe.find(query).sort(sortBy).skip(skip).limit(limitNum),
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
