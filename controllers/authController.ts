import crypto from 'crypto';
import { Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

import User, { UserDocument } from '@models/userModel';
import AppError from '@utils/appError';
import catchAsync from '@utils/catchAsync';
import { sendEmail } from '@utils/email';
import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';
import { promisify } from 'util';

const signToken = (id: string) => {
  if (!process.env.JWT_SECRET || !process.env.JWT_EXPIRES_IN) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }
  // @ts-ignore
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createAndSendToken = (
  user: UserDocument,
  statusCode: number,
  res: Response,
) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() +
        +(process.env.JWT_COOKIE_EXPIRES_IN || 90) * 24 * 60 * 60 * 1000,
    ),
    httpOnly: true,
    secure: false,
  };
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

  res.cookie('at', token, cookieOptions);

  res.status(statusCode).json({
    status: Status.Success,
    token,
    data: {
      user: {
        username: user.username,
        email: user.email,
        photo: user.photo,
      },
    },
  });
};

export const signup = catchAsync(async (req, res, next) => {
  // Create new user
  const newUser = await User.create({
    username: req.body.username,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
  });

  createAndSendToken(newUser, 201, res);
});

export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check email and password exist
  if (!email || !password) {
    return next(new AppError(ErrorCode.Missing_Email_Password, 400));
  }
  // 2) Check user exists && password is correct
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError(ErrorCode.Invalid_Credentails, 401));
  }

  // 3) If everything ok, send token to client
  createAndSendToken(user, 200, res);
});

export const protect = catchAsync(async (req, res, next) => {
  // 1) Get token and check it exists
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer')) {
    token = authHeader.split(' ')[1];
  }
  if (!token) {
    return next(new AppError('Invalid token', 401));
  }
  // 2) Validate token
  // Create a typed version of the verify function
  const verifyJwt = promisify(jwt.verify.bind(jwt)) as (
    token: string,
    secret: string,
  ) => Promise<JwtPayload>;

  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }

  const decodedData = await verifyJwt(token, process.env.JWT_SECRET);

  // 3) Check user still exists
  const currentUser = await User.findById(decodedData.id).select('+password');
  if (!currentUser) {
    return next(new AppError('User no longer exists', 400));
  }

  // 4) Check if user changed password after token was issued
  const passwordChanged = currentUser.changedPasswordAfter(
    decodedData.iat || Date.now(),
  );
  if (passwordChanged) {
    return next(new AppError('Password recently changed!', 401));
  }

  req.user = currentUser;
  next();
});

export const forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get uer based on email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('There is no user with email address', 404));
  }
  // 2) Generate random reset
  const resetToken = user.generatePasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) Send it to users email
  const resetUrl = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetUrl}.\nIf you didn't forget your password, please ignore this email`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (Only valid for 10 min)',
      message,
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        'There was an error sending the email. Try again later',
        500,
      ),
    );
  }

  res.status(200).json({
    status: Status.Success,
    message: 'Token sent to email - TODO: Implement email sending',
    token: resetToken,
  });
});

export const resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) If token has not expired and there is user -> set new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  // 3) Update changedPasswordAt property for the user (done in middleware in userModel)
  await user.save();

  // 4) Log the user in,(send jwt)
  createAndSendToken(user, 200, res);
});

export const updatePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, password, passwordConfirm } = req.body;
  // 1) Get user
  const user = (await User.findById(req.user!._id).select(
    '+password',
  )) as UserDocument;

  // 2) Check password fields exist
  if (!currentPassword || !password || !passwordConfirm) {
    return next(new AppError(ErrorCode.MISSING_FIELDS, 400));
  }
  // 3) Check correct password
  if (
    !(await req.user?.correctPassword(currentPassword, user?.password ?? ''))
  ) {
    return next(new AppError(ErrorCode.Current_Password_Invalid, 401));
  }

  // 4) If password is correct update password
  user.password = password;
  user.passwordConfirm = passwordConfirm;
  await user.save();

  // 5) Log user in and send new jwt
  createAndSendToken(user, 200, res);
});

export const deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(
    req.user!.id,
    { active: false },
    {
      runValidators: false,
    },
  );

  res.status(204).json({
    status: '1',
    data: null,
  });
});
