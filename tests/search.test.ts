import { describe, expect, it } from 'vitest';
import { ErrorCode } from 'translations/errorCodes';
import { as, createRecipe, createUser, saveRecipe } from './helpers';

/** Titles of the recipes in a search response, in order */
const titles = (res: { body: { data: { title: string }[] } }) =>
  res.body.data.map((recipe) => recipe.title);

describe('GET /recipes/search', () => {
  it("only returns other users' public recipes", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    await createRecipe(alice, { title: 'Public' });
    await createRecipe(alice, { title: 'Private', bPrivate: true });

    const asOther = await as(bobby).get('/recipes/search');
    const asAuthor = await as(alice).get('/recipes/search');

    expect(titles(asOther)).toEqual(['Public']);
    expect(titles(asAuthor).sort()).toEqual(['Private', 'Public']);
  });

  it('searches title and description', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Pancakes' });
    await createRecipe(alice, { title: 'Soup', description: 'Not pancakes' });
    await createRecipe(alice, { title: 'Salad', description: 'Green' });

    const res = await as(alice).get('/recipes/search?search=pancake');

    expect(titles(res).sort()).toEqual(['Pancakes', 'Soup']);
  });

  it('treats special characters in the search text literally', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Pancakes' });

    // '.*' would match everything if it were treated as a regular expression
    const res = await as(alice).get(`/recipes/search?search=${encodeURIComponent('.*')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('filters to saved recipes with bOnlySaved=true only', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const saved = await createRecipe(alice, { title: 'Saved' });
    await createRecipe(alice, { title: 'Not saved' });
    await saveRecipe(bobby, saved.id);

    const onlySaved = await as(bobby).get('/recipes/search?bOnlySaved=true');
    const notFiltered = await as(bobby).get('/recipes/search?bOnlySaved=false');

    expect(titles(onlySaved)).toEqual(['Saved']);
    expect(notFiltered.body.data).toHaveLength(2);
  });

  it('sorts newest first by default, and by oldest', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'First' });
    await createRecipe(alice, { title: 'Second' });

    const newest = await as(alice).get('/recipes/search');
    const oldest = await as(alice).get('/recipes/search?sort=oldest');

    expect(titles(newest)).toEqual(['Second', 'First']);
    expect(titles(oldest)).toEqual(['First', 'Second']);
  });

  it('sorts by number of saves with sort=popular', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const carol = await createUser('carol');
    await createRecipe(alice, { title: 'Unpopular' });
    const popular = await createRecipe(alice, { title: 'Popular' });
    await saveRecipe(bobby, popular.id);
    await saveRecipe(carol, popular.id);

    const res = await as(bobby).get('/recipes/search?sort=popular');

    expect(titles(res)).toEqual(['Popular', 'Unpopular']);
    expect(res.body.data[0]).toMatchObject({
      authorName: 'alice',
      bSaved: true,
      savedCount: 3,
    });
  });

  it("shows the user's own edited tags in the results", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice, { tags: ['quick'] });
    await saveRecipe(bobby, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', { id: recipe.id, tags: ['mine'] });

    const asEditor = await as(bobby).get('/recipes/search');
    const asAuthor = await as(alice).get('/recipes/search');
    const asEditorPopular = await as(bobby).get('/recipes/search?sort=popular');

    expect(asEditor.body.data[0].tags).toEqual(['mine']);
    expect(asAuthor.body.data[0].tags).toEqual(['quick']);
    expect(asEditorPopular.body.data[0].tags).toEqual(['mine']);
  });

  it('pages results', async () => {
    const alice = await createUser('alice');
    for (const title of ['One', 'Two', 'Three']) {
      await createRecipe(alice, { title });
    }

    const res = await as(alice).get('/recipes/search?limit=2&page=2&sort=oldest');

    expect(titles(res)).toEqual(['Three']);
    expect(res.body).toMatchObject({ totalPages: 2, currentPage: 2 });
  });

  it('rejects an invalid authorId', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).get('/recipes/search?authorId=nonsense');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Id);
  });
});
