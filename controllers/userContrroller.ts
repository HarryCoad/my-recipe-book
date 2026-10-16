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
export const savedRecipes = catchAsync(async (req, res, next) => {
  const { savedRecipes } = req.user!;

  res.status(200).json({
    status: Status.Success,
    data: savedRecipes || [],
  });
});
/**
 * Update the user's username. Passwords use /update-password. Email can't be
 * changed for now, so it's rejected along with any other field
 */
export const updateMe = catchAsync(async (req, res, next) => {
  const { username, ...rest } = req.body;

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

  const user = req.user!;
  if (username !== undefined) user.username = username;

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
      },
    },
  });
});
