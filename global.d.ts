import { UserDocument } from './models/userModel.ts'; // Adjust the path accordingly

// Update the request object to include the user details. This is added by the protect middleware
declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
    }
  }
}
