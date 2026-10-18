import { describe, expect, it } from 'vitest';
import { groupIngredientsBySubheader } from '@utils/recipeUtils';
import {
  as,
  createRecipe,
  createUser,
  recipeBody,
  saveRecipe,
} from './helpers';

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

const names = (ingredients: { name: string }[]) =>
  ingredients.map((i) => i.name);

describe('groupIngredientsBySubheader', () => {
  it('puts ungrouped ingredients first, then each subheader in order of first use', () => {
    expect(names(groupIngredientsBySubheader(mixedIngredients))).toEqual(
      groupedNames,
    );
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

    const created = await createRecipe(alice, {
      ingredients: mixedIngredients,
    });
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
    const suggestions = await as(alice).get(
      `/recipes/view-suggestions/${recipe.id}`,
    );
    const mine = await as(bobby).get('/recipes/my-suggestions');
    const reviewed = await as(alice).post('/recipes/review-suggestion', {
      id: suggestions.body.data.edits[0].id,
      bAccept: true,
    });

    expect(names(personal.body.data.recipe.ingredients)).toEqual(groupedNames);
    expect(names(suggestions.body.data.edits[0].ingredients)).toEqual(
      groupedNames,
    );
    expect(names(mine.body.data.suggestions[0].ingredients)).toEqual(
      groupedNames,
    );
    expect(names(reviewed.body.data.suggestion.ingredients)).toEqual(
      groupedNames,
    );
    expect(names(reviewed.body.data.recipe.ingredients)).toEqual(groupedNames);
  });
});

describe('ingredient quantities and units', () => {
  it('allows ingredients without a quantity or unit', async () => {
    const alice = await createUser('alice');

    const recipe = await createRecipe(alice, {
      ingredients: [
        { name: 'salt, to taste', quantity: null, unit: null },
        { name: 'pepper' },
        { name: 'eggs', quantity: 2, unit: null },
      ],
    });

    expect(recipe.ingredients).toMatchObject([
      { name: 'salt, to taste', quantity: null, unit: null },
      { name: 'pepper', quantity: null, unit: null },
      { name: 'eggs', quantity: 2, unit: null },
    ]);
  });

  it('accepts the imperial and count units', async () => {
    const alice = await createUser('alice');
    const units = [
      'cup',
      'fl oz',
      'oz',
      'lb',
      'pinch',
      'dash',
      'can',
      'bunch',
      'slice',
    ];

    const recipe = await createRecipe(alice, {
      ingredients: units.map((unit) => ({ name: unit, quantity: 1, unit })),
    });

    expect(recipe.ingredients.map((i: { unit: string }) => i.unit)).toEqual(
      units,
    );
  });

  it.each([
    ['a zero quantity', { name: 'flour', quantity: 0, unit: 'g' }],
    ['an unknown unit', { name: 'flour', quantity: 1, unit: 'handful' }],
    ['an empty name', { name: '', quantity: 1, unit: 'g' }],
  ])('rejects %s', async (_label, bad) => {
    const alice = await createUser('alice');

    const res = await as(alice).post('/recipes/create', {
      ...recipeBody(),
      ingredients: [bad],
    });

    expect(res.status).toBe(400);
  });

  it('allows them in personal edits too', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);

    const res = await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      ingredients: [{ name: 'salt, to taste', quantity: null, unit: null }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.ingredients).toMatchObject([
      { name: 'salt, to taste', quantity: null, unit: null },
    ]);
  });
});

describe('sourceUrl', () => {
  it('is saved and returned, and defaults to null', async () => {
    const alice = await createUser('alice');

    const imported = await createRecipe(alice, {
      sourceUrl: 'https://example.com/pancakes',
    });
    const typed = await createRecipe(alice);

    expect(imported.sourceUrl).toBe('https://example.com/pancakes');
    expect(typed.sourceUrl).toBeNull();
  });

  it('can be changed with update-own-recipe', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      sourceUrl: 'https://example.com/new',
    });

    expect(res.body.data.recipe.sourceUrl).toBe('https://example.com/new');
  });

  it.each(['not a url', 'javascript:alert(1)', 'ftp://example.com/x'])(
    'rejects %s',
    async (sourceUrl) => {
      const alice = await createUser('alice');

      const res = await as(alice).post(
        '/recipes/create',
        recipeBody({ sourceUrl }),
      );

      expect(res.status).toBe(400);
    },
  );
});
