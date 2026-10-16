import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from 'translations/errorCodes';
import { as, createRecipe, createUser, saveRecipe, TestUser } from './helpers';

// Bobby has saved Alice's recipe and makes his own changes to it
let alice: TestUser;
let bobby: TestUser;
let recipeId: string;

beforeEach(async () => {
  alice = await createUser('alice');
  bobby = await createUser('bobby');
  recipeId = (await createRecipe(alice, { tags: ['quick'] })).id;
  await saveRecipe(bobby, recipeId);
});

const editRecipe = (user: TestUser, changes: object) =>
  as(user).post('/recipes/edit-recipe', { id: recipeId, ...changes });
const viewRecipe = (user: TestUser, query = '') =>
  as(user).get(`/recipes/${recipeId}${query}`);

describe('POST /recipes/edit-recipe (personal edits)', () => {
  it('only shows the edit to the user who made it', async () => {
    await editRecipe(bobby, { tags: ['mine'], steps: ['My way'] });

    const asEditor = await viewRecipe(bobby);
    const asAuthor = await viewRecipe(alice);

    expect(asEditor.body.data.recipe).toMatchObject({
      tags: ['mine'],
      steps: ['My way'],
    });
    expect(asEditor.body.data.bHasEdits).toBe(true);
    expect(asAuthor.body.data.recipe).toMatchObject({
      tags: ['quick'],
      steps: ['Mix', 'Cook'],
    });
    expect(asAuthor.body.data.bHasEdits).toBe(false);
  });

  it('keeps earlier changes when editing a different field', async () => {
    await editRecipe(bobby, { tags: ['mine'] });
    await editRecipe(bobby, { steps: ['My way'] });

    const res = await viewRecipe(bobby);

    expect(res.body.data.recipe).toMatchObject({
      tags: ['mine'],
      steps: ['My way'],
    });
  });

  it('can remove all tags', async () => {
    await editRecipe(bobby, { tags: [] });

    const res = await viewRecipe(bobby);

    expect(res.body.data.recipe.tags).toEqual([]);
  });

  it('requires the recipe to be saved first', async () => {
    const carol = await createUser('carol');

    const res = await editRecipe(carol, { tags: ['mine'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Recipe);
  });

  it("can't be used by the author on their own recipe", async () => {
    const res = await editRecipe(alice, { tags: ['mine'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Use_Update_Own_Recipe_Endpoint);
  });
});

describe('viewing the original', () => {
  it('shows the recipe without your edits with ?original=true', async () => {
    await editRecipe(bobby, { tags: ['mine'] });

    const res = await viewRecipe(bobby, '?original=true');

    expect(res.body.data.recipe.tags).toEqual(['quick']);
    expect(res.body.data.bHasEdits).toBe(true);
  });
});

describe('POST /recipes/reset-edit', () => {
  it('removes your edits', async () => {
    await editRecipe(bobby, { tags: ['mine'] });

    const reset = await as(bobby).post('/recipes/reset-edit', { id: recipeId });
    const res = await viewRecipe(bobby);

    expect(reset.status).toBe(200);
    expect(res.body.data.recipe.tags).toEqual(['quick']);
    expect(res.body.data.bHasEdits).toBe(false);
  });

  it('returns 404 when there are no edits to reset', async () => {
    const res = await as(bobby).post('/recipes/reset-edit', { id: recipeId });

    expect(res.status).toBe(404);
  });
});

describe('unsaving a recipe you have edited', () => {
  it('asks for confirmation first', async () => {
    await editRecipe(bobby, { tags: ['mine'] });

    const res = await saveRecipe(bobby, recipeId, false);
    const stillSaved = await viewRecipe(bobby);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Confirm_Lose_Edits);
    expect(stillSaved.body.data.recipe.bSaved).toBe(true);
  });

  it('deletes your edits once confirmed', async () => {
    await editRecipe(bobby, { tags: ['mine'] });

    const res = await as(bobby).post('/recipes/toggle-save', {
      id: recipeId,
      bSave: false,
      bConfirmLoseEdits: true,
    });
    await saveRecipe(bobby, recipeId);
    const resaved = await viewRecipe(bobby);

    expect(res.status).toBe(200);
    expect(resaved.body.data.bHasEdits).toBe(false);
    expect(resaved.body.data.recipe.tags).toEqual(['quick']);
  });

  it("doesn't need confirmation when you have no edits", async () => {
    const res = await saveRecipe(bobby, recipeId, false);

    expect(res.status).toBe(200);
  });
});
