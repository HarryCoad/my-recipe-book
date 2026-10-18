import { Types } from 'mongoose';
import Recipe from '@models/recipeModel';
import User from '@models/userModel';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';

export const userDetails = catchAsync(async (req, res, next) => {
  const { password, createdAt, updatedAt, suggestedEdits, ...user } =
    req.user!.toObject();

  res.status(200).json({
    status: Status.Success,
    data: user,
  });
});
/** The IDs of the recipes the user has saved, in the order they saved them */
export const savedRecipes = catchAsync(async (req, res, next) => {
  // Projections aren't cast, so convert the ID first
  const userId = new Types.ObjectId(String(req.user!.id));

  // The projection keeps only the user's own entry, so other savers aren't loaded
  const recipes = await Recipe.find(
    { 'savedBy.userId': userId },
    { savedBy: { $elemMatch: { userId } } },
  ).lean();

  const saved = recipes
    .map((recipe) => ({
      recipeId: recipe._id,
      savedAt: recipe.savedBy[0].savedAt,
    }))
    .sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime());

  res.status(200).json({
    status: Status.Success,
    data: saved,
  });
});
/**
 * Another user's public profile. Only fields that are safe to show anyone,
 * never their email. Deactivated accounts are filtered out by the model
 */
export const userProfile = catchAsync(async (req, res, next) => {
  const user = Types.ObjectId.isValid(req.params.id)
    ? await User.findById(req.params.id).lean()
    : null;

  if (!user) {
    return next(new AppError(ErrorCode.Invalid_Id, 404));
  }

  res.status(200).json({
    status: Status.Success,
    data: {
      user: {
        id: user._id,
        username: user.username,
        photo: user.photo,
        bPrivateSaves: user.bPrivateSaves ?? false,
      },
    },
  });
});
/**
 * Update the user's username and whether their saves are private. Passwords
 * use /update-password. Email can't be changed for now, so it's rejected
 * along with any other field
 */
export const updateMe = catchAsync(async (req, res, next) => {
  const { username, bPrivateSaves, ...rest } = req.body;

  if (Object.keys(rest).length > 0) {
    return next(
      new AppError(
        ErrorCode.Invalid_Fieldname,
        400,
        Object.keys(rest).map((key) => ({
          fieldname: key,
          code: ErrorCode.Invalid_Fieldname,
        })),
      ),
    );
  }

  if (bPrivateSaves !== undefined && typeof bPrivateSaves !== 'boolean') {
    return next(new AppError(ErrorCode.Invalid, 400));
  }

  const user = req.user!;
  if (username !== undefined) user.username = username;
  if (bPrivateSaves !== undefined) user.bPrivateSaves = bPrivateSaves;

  // save() rather than findByIdAndUpdate() so the model's duplicate username
  // handling runs. Only validate the changed fields, otherwise the
  // passwordConfirm check would fail
  await user.save({ validateModifiedOnly: true });

  res.status(200).json({
    status: Status.Success,
    data: {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        photo: user.photo,
        bPrivateSaves: user.bPrivateSaves,
      },
    },
  });
});
