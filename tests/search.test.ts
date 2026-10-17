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
    const res = await as(alice).get(
      `/recipes/search?search=${encodeURIComponent('.*')}`,
    );

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
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['mine'],
    });

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

    const res = await as(alice).get(
      '/recipes/search?limit=2&page=2&sort=oldest',
    );

    expect(titles(res)).toEqual(['Three']);
    expect(res.body).toMatchObject({ totalPages: 2, currentPage: 2 });
  });

  it('filters by tags, requiring every tag', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Both', tags: ['quick', 'vegan'] });
    await createRecipe(alice, { title: 'Quick', tags: ['quick'] });
    await createRecipe(alice, { title: 'None', tags: [] });

    const one = await as(alice).get('/recipes/search?tags=quick');
    const both = await as(alice).get(
      `/recipes/search?tags=${encodeURIComponent(' Quick , VEGAN')}`,
    );

    expect(titles(one).sort()).toEqual(['Both', 'Quick']);
    expect(titles(both)).toEqual(['Both']);
  });

  it("filters by the user's own edited tags", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice, {
      title: 'Edited',
      tags: ['quick'],
    });
    await saveRecipe(bobby, recipe.id);
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['mine'],
    });

    const byEdited = await as(bobby).get('/recipes/search?tags=mine');
    const byOriginal = await as(bobby).get('/recipes/search?tags=quick');
    const asAuthor = await as(alice).get('/recipes/search?tags=quick');

    expect(titles(byEdited)).toEqual(['Edited']);
    expect(titles(byOriginal)).toEqual([]);
    expect(titles(asAuthor)).toEqual(['Edited']);
  });

  it('filters by total time, including the limits', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Quick', prepTime: 5, cookTime: 10 });
    await createRecipe(alice, { title: 'Medium', prepTime: 10, cookTime: 20 });
    await createRecipe(alice, { title: 'Slow', prepTime: 30, cookTime: 90 });

    const res = await as(alice).get('/recipes/search?minTime=15&maxTime=30');

    expect(titles(res).sort()).toEqual(['Medium', 'Quick']);
  });

  it('filters by serves', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Two', serves: 2 });
    await createRecipe(alice, { title: 'Four', serves: 4 });
    await createRecipe(alice, { title: 'Eight', serves: 8 });

    const res = await as(alice).get('/recipes/search?minServes=3&maxServes=6');

    expect(titles(res)).toEqual(['Four']);
  });

  it('applies filters when sorting by popular too', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { title: 'Match', tags: ['quick'], serves: 4 });
    await createRecipe(alice, {
      title: 'Wrong tag',
      tags: ['slow'],
      serves: 4,
    });
    await createRecipe(alice, { title: 'Too few', tags: ['quick'], serves: 1 });

    const res = await as(alice).get(
      '/recipes/search?sort=popular&tags=quick&minServes=2&maxTime=60',
    );

    expect(titles(res)).toEqual(['Match']);
    expect(res.body.totalPages).toBe(1);
  });

  it.each(['minTime=abc', 'maxServes=-1'])(
    'rejects an invalid number (%s)',
    async (param) => {
      const alice = await createUser('alice');

      const res = await as(alice).get(`/recipes/search?${param}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(ErrorCode.Invalid);
    },
  );

  it('hides saved recipes, including your own, with bHideSaved=true', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const saved = await createRecipe(alice, { title: 'Saved' });
    await createRecipe(alice, { title: 'Not saved' });
    await createRecipe(bobby, { title: 'Own' });
    await saveRecipe(bobby, saved.id);

    const res = await as(bobby).get('/recipes/search?bHideSaved=true');

    expect(titles(res)).toEqual(['Not saved']);
  });

  it("can't combine bHideSaved and bOnlySaved", async () => {
    const alice = await createUser('alice');

    const res = await as(alice).get(
      '/recipes/search?bHideSaved=true&bOnlySaved=true',
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Options);
  });

  it('rejects an invalid authorId', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).get('/recipes/search?authorId=nonsense');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Id);
  });
});
