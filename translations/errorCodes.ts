import { ZodError } from 'zod';

export enum ErrorCode {
  Required = 'REQUIRED',
  Confirm = 'CONFIRM',
  Invalid = 'INVALID',
  Invalid_User = 'INVALID_USER',
  Invalid_Id = 'INVALID_ID',
  Invalid_Fieldname = 'INVALID_FIELDNAME',
  Invalid_Recipe = 'INVALID_RECIPE',
  No_Suggestions = 'NO_SUGGESTIONS',
  Use_Update_Own_Recipe_Endpoint = 'USE_UPDATE_OWN_RECIPE_ENDPOINT',
  User_Doesnt_Own_Recipe = 'USER_DOESNT_OWN_RECIPE',
  Invalid_Options = 'INVALID_OPTIONS',
  Username_Taken = 'USERNAME_TAKEN',
  Unique_Email = 'UNIQUE_EMAIL',
  Missing_Email_Password = 'MISSING_EMAIL_PASSWORD',
  Invalid_Credentails = 'INVALID_CREDENTIALS',
  MISSING_FIELDS = 'MISSING_FIELDS',
  Current_Password_Invalid = 'INVALID_CURRENT_PASSWORD',
}
