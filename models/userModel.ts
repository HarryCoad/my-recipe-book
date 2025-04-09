import mongoose, { Document, Query, Schema } from 'mongoose';
import validator from 'validator';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { ErrorCode } from 'translations/errorCodes';
import AppError from '@utils/appError';
import { SavedRecipe } from './recipeModel';

// Define User interface
export interface UserDocument extends Document<string> {
  username: string;
  email: string;
  password: string;
  passwordConfirm?: string;
  passwordChangedAt?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: string;
  photo?: string;
  savedRecipes: SavedRecipe[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;

  correctPassword: (
    candidatePassword: string,
    userHashedPassword: string,
  ) => boolean;

  changedPasswordAfter: (JWTTimestamp: number) => boolean;
  generatePasswordResetToken: () => string;
}

// Define Schema
const UserSchema = new Schema<UserDocument>(
  {
    username: {
      type: String,
      required: [true, ErrorCode.Required],
      unique: true,
      trim: true,
      minLength: [4, 'Minimum 4 characters'],
      maxLength: [40, 'Maximum 40 characters'],
    },
    email: {
      type: String,
      required: [true, ErrorCode.Required],
      unique: true,
      lowercase: true,
      validate: [validator.isEmail, ErrorCode.Invalid],
    },
    password: {
      type: String,
      required: [true, ErrorCode.Required],
      minLength: [8, 'Minimum length 8 characters'],
      select: false, // Exclude from queries by default
    },
    passwordConfirm: {
      type: String,
      select: false,
      required: [true, ErrorCode.Confirm],
      validate: {
        message: 'Passwords do not match',
        // THIS ONLY WORKS ON .create() AND .save()
        validator: function (val) {
          return val === this.password;
        },
      },
    },
    passwordChangedAt: { type: Date },
    passwordResetToken: String,
    passwordResetExpires: Date,
    photo: {
      type: String,
      default: 'default.jpg',
    },
    savedRecipes: [
      {
        recipeId: {
          type: Schema.Types.ObjectId,
          ref: 'Recipe',
          required: true,
        },
      },
    ],
    active: {
      type: Boolean,
      default: true,
      select: false,
    },
  },
  { timestamps: true }, // Adds createdAt and updatedAt fields
);

UserSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = new Date(Date.now() - 1000);
  next();
});
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 12);

  this.passwordConfirm = undefined;
  next();
});
UserSchema.pre(
  /^find/,
  function (this: Query<UserDocument, UserDocument>, next) {
    this.find({ active: { $ne: false } });

    next();
  },
);
UserSchema.pre(
  /^find/,
  function (this: Query<UserDocument, UserDocument>, next) {
    this.select('-__v -passwordChangedAt -active');

    next();
  },
);

/**
 * Post middleware to catch duplicate key errors (MongoServerError with code 11000)
 * and customize the error message per field.
 */
UserSchema.post(
  'save',
  function (error: any, _doc: UserDocument, next: (err?: any) => void) {
    // Check if error is a duplicate key error
    if (error.name === 'MongoServerError' && error.code === 11000) {
      // error.keyValue is an object with the duplicate field
      const duplicateField = Object.keys(error.keyValue)[0];

      let customMessage = 'Duplicate field value entered';
      if (duplicateField === 'username') {
        customMessage = ErrorCode.Username_Taken;
      } else if (duplicateField === 'email') {
        customMessage = ErrorCode.Unique_Email;
      }
      next(new AppError(customMessage, 400));
    } else {
      next(error);
    }
  },
);

UserSchema.methods.correctPassword = async function (
  candidatePassword: string,
  userHashedPassword: string,
) {
  return await bcrypt.compare(candidatePassword, userHashedPassword);
};
UserSchema.methods.changedPasswordAfter = function (JWTTimestamp: number) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      (this.passwordChangedAt.getTime() / 1000).toString(),
      10,
    );

    return JWTTimestamp < changedTimestamp;
  }

  // NOT CHANGED
  return false;
};
UserSchema.methods.generatePasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Create Mongoose model
const User = mongoose.model<UserDocument>('User', UserSchema);

export default User;
