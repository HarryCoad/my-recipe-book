import express from 'express';

import * as authController from '@controllers/authController';
import * as userController from '@controllers/userContrroller';

export enum UserRoutes {
  SignUp = '/signup',
  Login = '/login',
  Update_Password = '/update-password',
  Forgotten_Password = '/forgotten-password',
  Reset_Password = '/reset-password/:token',
  Delete_Accouunt = '/delete-account',
  User_Details = '/user-details',
  Saved_Recipes = '/saved-recipes',
}

const router = express.Router();

router.post(UserRoutes.SignUp, authController.signup);
router.post(UserRoutes.Login, authController.login);
router.post(UserRoutes.Forgotten_Password, authController.forgotPassword);
router.patch(UserRoutes.Reset_Password, authController.resetPassword);

router.use(authController.protect);

// TODO: Add Update User route - photo etc
router.get(UserRoutes.Saved_Recipes, userController.savedRecipes);
router.get(UserRoutes.User_Details, userController.userDetails);
router.patch(UserRoutes.Update_Password, authController.updatePassword);
router.delete(UserRoutes.Delete_Accouunt, authController.deleteMe);

export default router;
