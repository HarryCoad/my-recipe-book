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
  Reset_Edit = '/reset-edit',
  View_Suggestions = '/view-suggestions/:id',
  Review_Suggestion = '/review-suggestion',
  My_Suggestions = '/my-suggestions',
  Search = '/search',
  Tags = '/tags',
}

const router = express.Router();

router.use(authController.protect);

router.post(RecipeRoutes.Create, recipeController.createRecipe);
router.get(RecipeRoutes.Search, recipeController.searchRecipes);
router.post(RecipeRoutes.Delete, recipeController.deleteRecipe);
router.post(RecipeRoutes.ToggleSave, recipeController.toggleSaveRecipe);
router.patch(RecipeRoutes.Update_Own_Recipe, recipeController.updateOwnRecipe);
router.post(RecipeRoutes.Edit_Recipe, recipeController.updateSavedRecipe);
router.post(RecipeRoutes.Reset_Edit, recipeController.resetRecipeEdit);
router.get(
  RecipeRoutes.View_Suggestions,
  recipeController.viewRecipeSuggestions,
);
router.post(RecipeRoutes.Review_Suggestion, recipeController.reviewSuggestion);
router.get(RecipeRoutes.My_Suggestions, recipeController.mySuggestions);
router.get(RecipeRoutes.Tags, recipeController.tagSuggestions);
// Must stay last, otherwise '/:id' would match the GET routes above
router.get(RecipeRoutes.View, recipeController.viweRecipe);

export default router;
