import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from 'translations/errorCodes';
import { as, createRecipe, createUser, saveRecipe, TestUser } from './helpers';

// Bobby and Carol have saved Alice's recipe and can suggest changes to it
let alice: TestUser;
let bobby: TestUser;
let carol: TestUser;
let recipeId: string;

beforeEach(async () => {
  alice = await createUser('alice');
  bobby = await createUser('bobby');
  carol = await createUser('carol');
  recipeId = (await createRecipe(alice)).id;
  await saveRecipe(bobby, recipeId);
  await saveRecipe(carol, recipeId);
});

const suggest = (user: TestUser, changes: object) =>
  as(user).post('/recipes/edit-recipe', {
    id: recipeId,
    isSuggestion: true,
    ...changes,
  });

/** Make a suggestion and return its id, as the author sees it */
const suggestAndGetId = async (user: TestUser, changes: object) => {
  await suggest(user, changes);
  const res = await as(alice).get(`/recipes/view-suggestions/${recipeId}`);
  return res.body.data.edits[0].id as string;
};

const review = (id: string, bAccept: boolean, user = alice) =>
  as(user).post('/recipes/review-suggestion', { id, bAccept });

describe('making a suggestion', () => {
  it("doesn't change the recipe", async () => {
    const res = await suggest(bobby, { steps: ['Better step'] });

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.steps).toEqual(['Mix', 'Cook']);
  });

  it('is refused when the author has turned suggestions off', async () => {
    const noSuggestions = await createRecipe(alice, {
      bAllowSuggestions: false,
    });
    await saveRecipe(bobby, noSuggestions.id);

    const res = await as(bobby).post('/recipes/edit-recipe', {
      id: noSuggestions.id,
      isSuggestion: true,
      steps: ['Better step'],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.No_Suggestions);
  });
});

describe('GET /recipes/view-suggestions/:id', () => {
  it('shows the author pending suggestions, newest first', async () => {
    await suggest(bobby, { steps: ['Bobby step'] });
    await suggest(carol, { steps: ['Carol step'], comments: 'Try this' });

    const res = await as(alice).get(`/recipes/view-suggestions/${recipeId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.edits).toHaveLength(2);
    expect(res.body.data.edits[0]).toMatchObject({
      steps: ['Carol step'],
      comments: 'Try this',
      status: 'pending',
    });
  });

  it("doesn't include personal edits", async () => {
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipeId,
      tags: ['mine'],
    });

    const res = await as(alice).get(`/recipes/view-suggestions/${recipeId}`);

    expect(res.body.data.edits).toHaveLength(0);
  });

  it('only shows reviewed suggestions with bShowAll=true', async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Bobby step'] });
    await review(id, false);

    const pending = await as(alice).get(`/recipes/view-suggestions/${recipeId}`);
    const all = await as(alice).get(
      `/recipes/view-suggestions/${recipeId}?bShowAll=true`,
    );

    expect(pending.body.data.edits).toHaveLength(0);
    expect(all.body.data.edits).toHaveLength(1);
  });

  it("isn't available to other users", async () => {
    const res = await as(bobby).get(`/recipes/view-suggestions/${recipeId}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /recipes/review-suggestion', () => {
  it('applies an accepted suggestion to the recipe for everyone', async () => {
    const id = await suggestAndGetId(bobby, {
      steps: ['Better step'],
      tags: ['improved'],
    });

    const res = await review(id, true);
    const asOther = await as(carol).get(`/recipes/${recipeId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.suggestion.status).toBe('accepted');
    expect(asOther.body.data.recipe).toMatchObject({
      steps: ['Better step'],
      tags: ['improved'],
      // Not part of the suggestion, so unchanged
      ingredients: [expect.objectContaining({ name: 'flour' })],
    });
  });

  it('leaves the recipe alone when rejected', async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Better step'] });

    const res = await review(id, false);

    expect(res.body.data.suggestion.status).toBe('rejected');
    expect(res.body.data.recipe.steps).toEqual(['Mix', 'Cook']);
  });

  it('leaves other pending suggestions for the author to review', async () => {
    const bobbyId = await suggestAndGetId(bobby, { steps: ['Bobby step'] });
    await suggest(carol, { steps: ['Carol step'] });

    await review(bobbyId, true);
    const res = await as(alice).get(`/recipes/view-suggestions/${recipeId}`);

    expect(res.body.data.edits).toHaveLength(1);
    expect(res.body.data.edits[0].steps).toEqual(['Carol step']);
  });

  it("can't review the same suggestion twice", async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Better step'] });
    await review(id, true);

    const res = await review(id, false);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Suggestion_Already_Reviewed);
  });

  it('can only be done by the author', async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Better step'] });

    const res = await review(id, true, carol);

    expect(res.status).toBe(404);
  });

  it('requires bAccept', async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Better step'] });

    const res = await as(alice).post('/recipes/review-suggestion', { id });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.MISSING_FIELDS);
  });
});

describe('GET /recipes/my-suggestions', () => {
  it('lists your suggestions with their status and recipe title', async () => {
    const id = await suggestAndGetId(bobby, { steps: ['Better step'] });
    await review(id, true);
    await suggest(carol, { steps: ['Carol step'] });

    const res = await as(bobby).get('/recipes/my-suggestions');

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toHaveLength(1);
    expect(res.body.data.suggestions[0]).toMatchObject({
      status: 'accepted',
      recipeId: { id: recipeId, title: 'Pancakes' },
    });
  });
});
