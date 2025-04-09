import catchAsync from '@utils/catchAsync';
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
