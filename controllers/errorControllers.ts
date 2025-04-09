import AppError from '@utils/appError';
import { Request, Response, NextFunction } from 'express';
import { Status } from 'types/generalTypes';
import { ZodError } from 'zod';

const handleCastErrorDB = (err: any): AppError => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldDB = (err: any): AppError => {
  const message = `Duplicate field value: "${Object.values(err.keyValue)[0]}". Please use another value`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err: any): AppError => {
  const errors = Object.values(err.errors)
    .map((el: any) => el.message)
    .join('. ');
  const message = `Invalid input data. ${errors}`;
  return new AppError(message, 400);
};

const handleJWTError = (): AppError => new AppError('Invalid token', 401);

const handleJWTExpired = (): AppError => new AppError('Token expired', 401);

const sendError = (err: any, res: Response, isDev: boolean): void => {
  const isValidationError = err.message === VALIDATION_ERROR_STRING;

  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      ...(isValidationError && { errors: err.validationErrors }),
      ...(isDev && {
        devOnly: {
          error: err,
          stack: err.stack,
        },
      }),
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong!',
      ...(isDev && {
        error: err,
        stack: err.stack,
      }),
    });
  }
};

export const VALIDATION_ERROR_STRING = 'Validation_Error';
const handleZodError = (err: ZodError) => {
  const errors = (err.errors ?? []).map((issue) => ({
    fieldname: issue.path.reduce((prev, cur) =>
      typeof cur === 'string'
        ? `${prev}.${cur}`
        : `${prev}.[${cur.toString()}]`,
    ) as string,
    code: issue.code,
  }));

  return new AppError(VALIDATION_ERROR_STRING, 400, errors);
};

const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || Status.Failure;

  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'production'
  ) {
    // For whatever reason err.message wasn't being spread
    let error = { ...err, message: err.message };

    if (err.name === 'CastError') error = handleCastErrorDB(error);
    if (err.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (err.code === 11000) error = handleDuplicateFieldDB(error);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpired();
    if (err.name === 'ZodError') error = handleZodError(err);

    sendError(error, res, process.env.NODE_ENV === 'development');
  } else
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
};

export default globalErrorHandler;
