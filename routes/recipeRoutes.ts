import express from 'express';

import * as authController from '@controllers/authController';
import * as recipeController from '@controllers/recipeController';

export enum RecipeRoutes {
  Create = '/create',
  View = '/:id',
  Delete = '/delete',
  ToggleSave = '/toggle-save',
  Update_Own_Recipe = '/update-own-recipe',
  Edit_Recipe = '/edit-recipe',
  View_Suggestions = '/view-suggestions/:id',
  Search = '/search',
}

const router = express.Router();

router.use(authController.protect);

router.post(RecipeRoutes.Create, recipeController.createRecipe);
router.get(RecipeRoutes.Search, recipeController.searchRecipes);
router.post(RecipeRoutes.Delete, recipeController.deleteRecipe);
router.post(RecipeRoutes.ToggleSave, recipeController.toggleSaveRecipe);
router.patch(RecipeRoutes.Update_Own_Recipe, recipeController.updateOwnRecipe);
router.post(RecipeRoutes.Edit_Recipe, recipeController.updateSavedRecipe);
router.get(
  RecipeRoutes.View_Suggestions,
  recipeController.viewRecipeSuggestions,
);
router.get(RecipeRoutes.View, recipeController.viweRecipe);

export default router;
