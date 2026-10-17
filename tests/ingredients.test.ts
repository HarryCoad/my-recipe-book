import { describe, expect, it } from 'vitest';
import { groupIngredientsBySubheader } from '@utils/recipeUtils';
import { as, createRecipe, createUser, saveRecipe } from './helpers';

const ingredient = (name: string, subheader: string | null = null) => ({
  name,
  subheader,
  quantity: 1,
  unit: 'g',
});

// Mixed up: 'sauce' and 'topping' ingredients are split up, and an
// ingredient without a subheader comes last
const mixedIngredients = [
  ingredient('flour'),
  ingredient('tomatoes', 'For the sauce'),
  ingredient('cheese', 'For the topping'),
  ingredient('garlic', 'For the sauce'),
  ingredient('basil', 'For the topping'),
  ingredient('salt'),
];
const groupedNames = ['flour', 'salt', 'tomatoes', 'garlic', 'cheese', 'basil'];

const names = (ingredients: { name: string }[]) => ingredients.map((i) => i.name);

describe('groupIngredientsBySubheader', () => {
  it('puts ungrouped ingredients first, then each subheader in order of first use', () => {
    expect(names(groupIngredientsBySubheader(mixedIngredients))).toEqual(groupedNames);
  });

  it('treats an empty subheader as none, and ignores surrounding spaces', () => {
    const grouped = groupIngredientsBySubheader([
      ingredient('tomatoes', 'Sauce'),
      ingredient('flour', ''),
      ingredient('garlic', ' Sauce '),
    ]);

    expect(names(grouped)).toEqual(['flour', 'tomatoes', 'garlic']);
  });

  it('leaves already grouped ingredients alone', () => {
    const grouped = groupIngredientsBySubheader(mixedIngredients);

    expect(groupIngredientsBySubheader(grouped)).toEqual(grouped);
  });
});

describe('ingredients in responses', () => {
  it('are grouped when creating and viewing a recipe', async () => {
    const alice = await createUser('alice');

    const created = await createRecipe(alice, { ingredients: mixedIngredients });
    const viewed = await as(alice).get(`/recipes/${created.id}`);

    expect(names(created.ingredients)).toEqual(groupedNames);
    expect(names(viewed.body.data.recipe.ingredients)).toEqual(groupedNames);
  });

  it('are grouped in search results', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { ingredients: mixedIngredients });

    const newest = await as(alice).get('/recipes/search');
    const popular = await as(alice).get('/recipes/search?sort=popular');

    expect(names(newest.body.data[0].ingredients)).toEqual(groupedNames);
    expect(names(popular.body.data[0].ingredients)).toEqual(groupedNames);
  });

  it('are grouped in personal edits and suggestions', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);

    const personal = await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      ingredients: mixedIngredients,
    });
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      isSuggestion: true,
      ingredients: mixedIngredients,
    });
    const suggestions = await as(alice).get(`/recipes/view-suggestions/${recipe.id}`);
    const mine = await as(bobby).get('/recipes/my-suggestions');
    const reviewed = await as(alice).post('/recipes/review-suggestion', {
      id: suggestions.body.data.edits[0].id,
      bAccept: true,
    });

    expect(names(personal.body.data.recipe.ingredients)).toEqual(groupedNames);
    expect(names(suggestions.body.data.edits[0].ingredients)).toEqual(groupedNames);
    expect(names(mine.body.data.suggestions[0].ingredients)).toEqual(groupedNames);
    expect(names(reviewed.body.data.suggestion.ingredients)).toEqual(groupedNames);
    expect(names(reviewed.body.data.recipe.ingredients)).toEqual(groupedNames);
  });
});
