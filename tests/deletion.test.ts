import { describe, expect, it } from 'vitest';
import Edit from '@models/editModel';
import { ErrorCode } from 'translations/errorCodes';
import { as, createRecipe, createUser, saveRecipe } from './helpers';

describe('POST /recipes/delete', () => {
  it('removes a recipe nobody else has saved', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await as(alice).post('/recipes/delete', { id: recipe.id });
    const view = await as(alice).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
    expect(view.status).toBe(404);
  });

  it('keeps it without an author for users who saved it', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['mine'],
    });

    await as(alice).post('/recipes/delete', { id: recipe.id });
    const res = await as(bobby).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({
      authorId: null,
      authorName: null,
      bSaved: true,
      // Bobby's personal edit is kept
      tags: ['mine'],
    });
  });

  it('removes pending suggestions and turns suggestions off', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      isSuggestion: true,
      steps: ['Better step'],
    });

    await as(alice).post('/recipes/delete', { id: recipe.id });
    const res = await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      isSuggestion: true,
      steps: ['Another'],
    });

    expect(await Edit.countDocuments({ isSuggestion: true })).toBe(0);
    expect(res.body.message).toBe(ErrorCode.No_Suggestions);
  });

  it("doesn't let the former author edit it", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);

    await as(alice).post('/recipes/delete', { id: recipe.id });
    const res = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      title: 'Back again',
    });

    expect(res.status).toBe(400);
  });

  it('can only be done by the author', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);

    const res = await as(bobby).post('/recipes/delete', { id: recipe.id });

    expect(res.status).toBe(404);
  });
});

describe('recipes without an author', () => {
  it('are hidden from general search but stay in saved lists', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(alice).post('/recipes/delete', { id: recipe.id });

    const general = await as(bobby).get('/recipes/search');
    const saved = await as(bobby).get('/recipes/search?bOnlySaved=true');

    expect(general.body.data).toHaveLength(0);
    expect(saved.body.data).toHaveLength(1);
  });

  it('can still be opened from a link if they were public', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(alice).post('/recipes/delete', { id: recipe.id });

    const res = await as(carol).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(200);
  });

  it('stay visible only to their savers if they were private', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      bPrivate: true,
    });
    await as(alice).post('/recipes/delete', { id: recipe.id });

    const asSaver = await as(bobby).get(`/recipes/${recipe.id}`);
    const asOther = await as(carol).get(`/recipes/${recipe.id}`);

    expect(asSaver.status).toBe(200);
    expect(asOther.status).toBe(404);
  });

  it('are removed, with their edits, when the last saver unsaves', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await saveRecipe(carol, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['mine'],
    });
    await as(alice).post('/recipes/delete', { id: recipe.id });

    await saveRecipe(carol, recipe.id, false);
    const afterFirst = await as(bobby).get(`/recipes/${recipe.id}`);
    await as(bobby).post('/recipes/toggle-save', {
      id: recipe.id,
      bSave: false,
      bConfirmLoseEdits: true,
    });
    const afterLast = await as(bobby).get(`/recipes/${recipe.id}`);

    expect(afterFirst.status).toBe(200);
    expect(afterLast.status).toBe(404);
    expect(await Edit.countDocuments({ recipeId: recipe.id })).toBe(0);
  });
});

describe('DELETE /users/delete-account', () => {
  it('handles their recipes the same as deleting them', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const shared = await createRecipe(alice, { title: 'Shared' });
    const solo = await createRecipe(alice, { title: 'Solo' });
    await saveRecipe(bobby, shared.id);

    const res = await as(alice).delete('/users/delete-account');
    const sharedView = await as(bobby).get(`/recipes/${shared.id}`);
    const soloView = await as(bobby).get(`/recipes/${solo.id}`);

    expect(res.status).toBe(204);
    expect(sharedView.status).toBe(200);
    expect(sharedView.body.data.recipe.authorName).toBeNull();
    expect(soloView.status).toBe(404);
  });

  it('unsaves their saved recipes and deletes their edits and suggestions', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['mine'],
    });
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      isSuggestion: true,
      steps: ['Better step'],
    });

    await as(bobby).delete('/users/delete-account');
    const res = await as(alice).get(`/recipes/${recipe.id}`);

    expect(res.body.data.recipe.savedCount).toBe(1);
    expect(await Edit.countDocuments({ userId: bobby.id })).toBe(0);
  });

  it('removes recipes without an author that only they had saved', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);
    await as(alice).post('/recipes/delete', { id: recipe.id });

    await as(bobby).delete('/users/delete-account');
    const res = await as(carol).get(`/recipes/${recipe.id}`);

    expect(res.status).toBe(404);
  });

  it('stops their token working', async () => {
    const alice = await createUser('alice');

    await as(alice).delete('/users/delete-account');
    const res = await as(alice).get('/recipes/search');

    expect(res.status).not.toBe(200);
  });
});
