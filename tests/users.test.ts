import { describe, expect, it } from 'vitest';
import { ErrorCode } from 'translations/errorCodes';
import { api, as, createRecipe, createUser, saveRecipe } from './helpers';

const savedIds = async (user: Awaited<ReturnType<typeof createUser>>) => {
  const res = await as(user).get('/users/saved-recipes');
  return res.body.data.map((saved: { recipeId: string }) => saved.recipeId);
};

describe('signup and login', () => {
  it('returns the user id on signup', async () => {
    const res = await api.post('/users/signup', {
      username: 'alice',
      email: 'alice@test.com',
      password: 'password123',
      passwordConfirm: 'password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.data.user).toMatchObject({
      id: expect.any(String),
      username: 'alice',
      email: 'alice@test.com',
    });
  });

  it('returns the user id on login', async () => {
    const alice = await createUser('alice');

    const res = await api.post('/users/login', {
      email: alice.email,
      password: 'password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(alice.id);
  });

  it('rejects requests without a token', async () => {
    const res = await api.get('/recipes/search');

    expect(res.status).toBe(401);
  });
});

describe('PATCH /users/update-me', () => {
  it('updates the username', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).patch('/users/update-me', {
      username: 'alice2',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: alice.id,
      username: 'alice2',
    });
  });

  it('shows the new username on their recipes', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    await as(alice).patch('/users/update-me', { username: 'alice2' });
    const res = await as(alice).get(`/recipes/${recipe.id}`);

    expect(res.body.data.recipe.authorName).toBe('alice2');
  });

  it('rejects a username that is already taken', async () => {
    const alice = await createUser('alice');
    await createUser('bobby');

    const res = await as(alice).patch('/users/update-me', {
      username: 'bobby',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Username_Taken);
  });

  it('rejects a username that is too short', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).patch('/users/update-me', { username: 'al' });

    expect(res.status).toBe(400);
  });

  it.each([
    ['email', { email: 'new@test.com' }],
    ['password', { password: 'newpassword123' }],
  ])('rejects changing %s, and changes nothing', async (_field, body) => {
    const alice = await createUser('alice');

    const res = await as(alice).patch('/users/update-me', {
      username: 'alice2',
      ...body,
    });
    const details = await as(alice).get('/users/user-details');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Fieldname);
    expect(details.body.data).toMatchObject({
      username: 'alice',
      email: 'alice@test.com',
    });
  });
});

describe('GET /users/saved-recipes', () => {
  it('includes recipes the user created', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await as(alice).get('/users/saved-recipes');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { recipeId: recipe.id, savedAt: expect.any(String) },
    ]);
  });

  it('lists recipes in the order they were saved', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const first = await createRecipe(alice, { title: 'First' });
    const second = await createRecipe(alice, { title: 'Second' });

    await saveRecipe(bobby, second.id);
    await saveRecipe(bobby, first.id);

    expect(await savedIds(bobby)).toEqual([second.id, first.id]);
  });

  it('keeps the original position when a recipe is saved again', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const first = await createRecipe(alice, { title: 'First' });
    const second = await createRecipe(alice, { title: 'Second' });
    await saveRecipe(bobby, first.id);
    await saveRecipe(bobby, second.id);

    await saveRecipe(bobby, first.id);

    expect(await savedIds(bobby)).toEqual([first.id, second.id]);
  });

  it('leaves out unsaved and deleted recipes', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const kept = await createRecipe(alice, { title: 'Kept' });
    const unsaved = await createRecipe(alice, { title: 'Unsaved' });
    const deleted = await createRecipe(bobby, { title: 'Deleted' });
    await saveRecipe(bobby, kept.id);
    await saveRecipe(bobby, unsaved.id);

    await saveRecipe(bobby, unsaved.id, false);
    await as(bobby).post('/recipes/delete', { id: deleted.id });

    expect(await savedIds(bobby)).toEqual([kept.id]);
  });

  it("doesn't include other users' saves", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);

    const ids = await savedIds(bobby);

    expect(ids).toEqual([recipe.id]);
  });
});
