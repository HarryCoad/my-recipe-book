import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { ErrorCode } from 'translations/errorCodes';
import { as, createRecipe, createUser, saveRecipe } from './helpers';

/** Titles of the recipes in a search response, sorted */
const titles = (res: { body: { data: { title: string }[] } }) =>
  res.body.data.map((recipe) => recipe.title).sort();

describe('GET /users/:id', () => {
  it('returns public profile fields, but not their email', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');

    const res = await as(bobby).get(`/users/${alice.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: alice.id,
      username: 'alice',
      photo: 'default.jpg',
      bPrivateSaves: false,
    });
  });

  it.each([
    ['an unknown', () => String(new Types.ObjectId())],
    ['a malformed', () => 'nonsense'],
  ])('returns 404 for %s id', async (_label, id) => {
    const alice = await createUser('alice');

    const res = await as(alice).get(`/users/${id()}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe(ErrorCode.Invalid_Id);
  });

  it('returns 404 for a deleted account', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    await as(alice).delete('/users/delete-account');

    const res = await as(bobby).get(`/users/${alice.id}`);

    expect(res.status).toBe(404);
  });

  it("doesn't catch the other user routes", async () => {
    const alice = await createUser('alice');

    const res = await as(alice).get('/users/user-details');

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('alice@test.com');
  });
});

describe('bPrivateSaves', () => {
  it('can be turned on with update-me and shows on the profile', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');

    const update = await as(alice).patch('/users/update-me', {
      bPrivateSaves: true,
    });
    const profile = await as(bobby).get(`/users/${alice.id}`);

    expect(update.status).toBe(200);
    expect(update.body.data.user.bPrivateSaves).toBe(true);
    expect(profile.body.data.user.bPrivateSaves).toBe(true);
  });

  it('must be a boolean', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).patch('/users/update-me', {
      bPrivateSaves: 'yes',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid);
  });
});

describe('GET /recipes/search?savedBy=', () => {
  it("lists the user's saved recipes, including ones they wrote", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    await createRecipe(alice, { title: 'Own' });
    const saved = await createRecipe(bobby, { title: 'Saved' });
    await createRecipe(bobby, { title: 'Not saved' });
    await saveRecipe(alice, saved.id);

    const res = await as(carol).get(`/recipes/search?savedBy=${alice.id}`);

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Own', 'Saved']);
  });

  it('only shows recipes the viewer is allowed to see', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    await createRecipe(alice, { title: 'Alice private', bPrivate: true });
    const madePrivate = await createRecipe(bobby, { title: 'Made private' });
    await saveRecipe(alice, madePrivate.id);
    await as(bobby).patch('/recipes/update-own-recipe', {
      id: madePrivate.id,
      bPrivate: true,
    });

    const asCarol = await as(carol).get(`/recipes/search?savedBy=${alice.id}`);
    const asBobby = await as(bobby).get(`/recipes/search?savedBy=${alice.id}`);

    expect(titles(asCarol)).toEqual([]);
    expect(titles(asBobby)).toEqual(['Made private']);
  });

  it('includes public recipes whose author deleted them', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    const recipe = await createRecipe(bobby, { title: 'Orphaned' });
    await saveRecipe(alice, recipe.id);
    await as(bobby).post('/recipes/delete', { id: recipe.id });

    const res = await as(carol).get(`/recipes/search?savedBy=${alice.id}`);

    expect(titles(res)).toEqual(['Orphaned']);
  });

  it("shows whether the viewer has saved each one, not the profile's owner", async () => {
    const alice = await createUser('alice');
    const carol = await createUser('carol');
    await createRecipe(alice, { title: 'Recipe' });

    const res = await as(carol).get(`/recipes/search?savedBy=${alice.id}`);

    expect(res.body.data[0]).toMatchObject({ bSaved: false, savedCount: 1 });
  });

  it('is refused when the user has made their saves private', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    await createRecipe(alice, { title: 'Own' });
    await as(alice).patch('/users/update-me', { bPrivateSaves: true });

    const asOther = await as(bobby).get(`/recipes/search?savedBy=${alice.id}`);
    const asSelf = await as(alice).get(`/recipes/search?savedBy=${alice.id}`);

    expect(asOther.status).toBe(403);
    expect(asOther.body.message).toBe(ErrorCode.Saves_Private);
    expect(titles(asSelf)).toEqual(['Own']);
  });

  it('rejects malformed and unknown user ids', async () => {
    const alice = await createUser('alice');

    const malformed = await as(alice).get('/recipes/search?savedBy=nonsense');
    const unknown = await as(alice).get(
      `/recipes/search?savedBy=${new Types.ObjectId()}`,
    );

    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe(ErrorCode.Invalid_Id);
  });
});
