import { ErrorCode } from 'translations/errorCodes';
import { Status } from 'types/generalTypes';
import { ZodIssueCode } from 'zod';

export type ValidationError = {
  fieldname: string;
  code: ErrorCode | ZodIssueCode;
};

class AppError extends Error {
  public statusCode: number;
  public status: number;
  public isOperational: boolean;
  public validationErrors?: ValidationError[];

  constructor(
    message: string,
    statusCode: number,
    validationErrors?: ValidationError[],
  ) {
    super(message);

    this.validationErrors = validationErrors;
    this.statusCode = statusCode;
    // this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.status = Status.Failure;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
