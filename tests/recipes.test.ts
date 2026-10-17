import { describe, expect, it } from 'vitest';
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
