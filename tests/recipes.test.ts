import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import Recipe from '@models/recipeModel';
import { ErrorCode } from 'translations/errorCodes';
import {
  as,
  createRecipe,
  createUser,
  recipeBody,
  saveRecipe,
} from './helpers';

describe('POST /recipes/create', () => {
  it('creates a recipe, saved by its author', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).post('/recipes/create', recipeBody());

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({
      title: 'Pancakes',
      authorId: alice.id,
      authorName: 'alice',
      bSaved: true,
      savedCount: 1,
    });
    expect(res.body.data.recipe.authorType).toBeUndefined();
  });

  it('rejects an invalid recipe', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).post(
      '/recipes/create',
      recipeBody({ category: 'Not a category' }),
    );

    expect(res.status).toBe(400);
  });

  it.each([
    ['0', 0, 0],
    ['null', null, null],
  ])('allows a prep time of %s', async (_label, prepTime, saved) => {
    const alice = await createUser('alice');

    const res = await as(alice).post(
      '/recipes/create',
      recipeBody({ prepTime }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.prepTime).toBe(saved);
  });

  it.each([
    ['left out', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
  ])(
    'allows a description that is %s, storing null',
    async (_label, description) => {
      const alice = await createUser('alice');

      const res = await as(alice).post(
        '/recipes/create',
        recipeBody({ description }),
      );

      expect(res.status).toBe(200);
      expect(res.body.data.recipe.description).toBeNull();
    },
  );

  it('can clear the description with update-own-recipe, and keeps it when not sent', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const kept = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      title: 'New title',
    });
    const cleared = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      description: '',
    });

    expect(kept.body.data.recipe.description).toBe('Fluffy pancakes');
    expect(cleared.body.data.recipe.description).toBeNull();
  });

  it('allows leaving out the prep time, storing null', async () => {
    const alice = await createUser('alice');
    const { prepTime: _prepTime, ...body } = recipeBody();

    const res = await as(alice).post('/recipes/create', body);

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.prepTime).toBeNull();
  });

  it.each([
    ['a negative prep time', { prepTime: -5 }],
    ['a cook time of 0', { cookTime: 0 }],
    ['a missing cook time', { cookTime: null }],
  ])('rejects %s', async (_label, overrides) => {
    const alice = await createUser('alice');

    const res = await as(alice).post('/recipes/create', recipeBody(overrides));

    expect(res.status).toBe(400);
  });
});

describe('GET /recipes/:id', () => {
  it('includes the author name and save info, but not who saved it', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);

    const res = await as(bobby).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({
      authorName: 'alice',
      bSaved: false,
      savedCount: 1,
    });
    expect(res.body.data.recipe.savedBy).toBeUndefined();
  });

  it('sends a null description for recipes saved without one', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);
    // Older recipes were added straight to the database without a description
    await Recipe.collection.updateOne(
      { _id: new Types.ObjectId(String(recipe.id)) },
      { $unset: { description: '' } },
    );

    const view = await as(alice).get(`/recipes/${recipe.id}`);
    const search = await as(alice).get('/recipes/search');
    const popular = await as(alice).get('/recipes/search?sort=popular');

    expect(view.body.data.recipe.description).toBeNull();
    expect(search.body.data[0].description).toBeNull();
    expect(popular.body.data[0].description).toBeNull();
  });

  it('hides private recipes from other users', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice, { bPrivate: true });

    const asAuthor = await as(alice).get(`/recipes/${recipe.id}`);
    const asOther = await as(bobby).get(`/recipes/${recipe.id}`);

    expect(asAuthor.status).toBe(200);
    expect(asOther.status).toBe(404);
  });
});

describe('POST /recipes/toggle-save', () => {
  it('saves and unsaves a recipe', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);

    await saveRecipe(bobby, recipe.id);
    const saved = await as(bobby).get(`/recipes/${recipe.id}`);
    await saveRecipe(bobby, recipe.id, false);
    const unsaved = await as(bobby).get(`/recipes/${recipe.id}`);

    expect(saved.body.data.recipe).toMatchObject({
      bSaved: true,
      savedCount: 2,
    });
    expect(unsaved.body.data.recipe).toMatchObject({
      bSaved: false,
      savedCount: 1,
    });
  });

  it("can't save someone else's private recipe", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice, { bPrivate: true });

    const res = await saveRecipe(bobby, recipe.id);

    expect(res.status).toBe(404);
  });

  it("doesn't let the author unsave their own recipe", async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await saveRecipe(alice, recipe.id, false);
    const view = await as(alice).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Author_Cant_Unsave);
    expect(view.body.data.recipe).toMatchObject({
      bSaved: true,
      savedCount: 1,
    });
  });
});

describe('PATCH /recipes/update-own-recipe', () => {
  it('lets the author update their recipe', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      title: 'Better Pancakes',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({
      title: 'Better Pancakes',
      authorName: 'alice',
    });
  });

  it("doesn't let other users update it", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);

    const res = await as(bobby).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      title: 'Hijacked',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.User_Doesnt_Own_Recipe);
  });
});
