import { describe, expect, it } from 'vitest';
import Recipe from '@models/recipeModel';
import { normaliseTags } from '@utils/tagUtils';
import { as, createRecipe, createUser, recipeBody, saveRecipe } from './helpers';

// normaliseTags is a plain function, so it can be tested directly without
// going through the API
describe('normaliseTags', () => {
  it('trims, lowercases and collapses spaces', () => {
    expect(normaliseTags(['  Quick ', 'GLUTEN   Free'])).toEqual([
      'quick',
      'gluten free',
    ]);
  });

  it('removes duplicates and empty tags', () => {
    expect(normaliseTags(['quick', 'Quick', ' QUICK', '', '   '])).toEqual([
      'quick',
    ]);
  });

  it('leaves anything that is not a list unchanged for validation to reject', () => {
    expect(normaliseTags('quick')).toBe('quick');
    expect(normaliseTags(undefined)).toBeUndefined();
  });
});

describe('tags are normalised when saved', () => {
  it('on create', async () => {
    const alice = await createUser('alice');

    const recipe = await createRecipe(alice, { tags: [' Quick', 'quick', 'Easy  Dinner'] });

    expect(recipe.tags).toEqual(['quick', 'easy dinner']);
  });

  it('on update', async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice);

    const res = await as(alice).patch('/recipes/update-own-recipe', {
      id: recipe.id,
      tags: ['VEGAN', 'vegan '],
    });

    expect(res.body.data.recipe.tags).toEqual(['vegan']);
  });

  it('on personal edits and accepted suggestions', async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    const recipe = await createRecipe(alice);
    await saveRecipe(bobby, recipe.id);

    const personal = await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      tags: ['Mine', 'MINE'],
    });
    await as(bobby).post('/recipes/edit-recipe', {
      id: recipe.id,
      isSuggestion: true,
      tags: ['  Better '],
    });
    const suggestions = await as(alice).get(`/recipes/view-suggestions/${recipe.id}`);
    const accepted = await as(alice).post('/recipes/review-suggestion', {
      id: suggestions.body.data.edits[0].id,
      bAccept: true,
    });

    expect(personal.body.data.recipe.tags).toEqual(['mine']);
    expect(accepted.body.data.recipe.tags).toEqual(['better']);
  });
});

describe('tags written directly to the database', () => {
  it('are normalised by the model, e.g. by the seed import script', async () => {
    const alice = await createUser('alice');

    const recipe = await Recipe.create({
      ...recipeBody({ tags: ['  Seeded', 'SEEDED'] }),
      authorId: alice.id,
    });

    expect(recipe.tags).toEqual(['seeded']);
  });
});

describe('tag limits', () => {
  it('rejects tags longer than 30 characters', async () => {
    const alice = await createUser('alice');

    const res = await as(alice).post(
      '/recipes/create',
      recipeBody({ tags: ['a'.repeat(31)] }),
    );

    expect(res.status).toBe(400);
    expect(res.body.errors[0].fieldname).toBe('tags.[0]');
  });

  it('rejects more than 10 tags, counting duplicates once', async () => {
    const alice = await createUser('alice');
    const elevenTags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const tenWithDuplicates = [...elevenTags.slice(0, 10), 'TAG0', 'tag1 '];

    const tooMany = await as(alice).post(
      '/recipes/create',
      recipeBody({ tags: elevenTags }),
    );
    const allowed = await as(alice).post(
      '/recipes/create',
      recipeBody({ tags: tenWithDuplicates }),
    );

    expect(tooMany.status).toBe(400);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.recipe.tags).toHaveLength(10);
  });
});

describe('GET /recipes/tags', () => {
  it('returns tags most used first, with counts', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { tags: ['quick', 'vegan'] });
    await createRecipe(alice, { tags: ['quick'] });
    await createRecipe(alice, { tags: ['quick', 'dessert'] });

    const res = await as(alice).get('/recipes/tags');

    expect(res.status).toBe(200);
    expect(res.body.data.tags).toEqual([
      { tag: 'quick', count: 3 },
      { tag: 'dessert', count: 1 },
      { tag: 'vegan', count: 1 },
    ]);
  });

  it('filters by search text, ignoring case and spacing', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { tags: ['quick', 'quiche', 'vegan', 'easy quick meal'] });

    const res = await as(alice).get('/recipes/tags?search=  QUI');

    expect(res.body.data.tags.map((t: { tag: string }) => t.tag)).toEqual([
      'easy quick meal',
      'quiche',
      'quick',
    ]);
  });

  it("doesn't include tags from other users' private recipes", async () => {
    const alice = await createUser('alice');
    const bobby = await createUser('bobby');
    await createRecipe(alice, { tags: ['public tag'] });
    await createRecipe(alice, { tags: ['secret tag'], bPrivate: true });

    const asOther = await as(bobby).get('/recipes/tags');
    const asAuthor = await as(alice).get('/recipes/tags');

    expect(asOther.body.data.tags).toEqual([{ tag: 'public tag', count: 1 }]);
    expect(asAuthor.body.data.tags).toHaveLength(2);
  });

  it("doesn't include tags from deleted recipes", async () => {
    const alice = await createUser('alice');
    const recipe = await createRecipe(alice, { tags: ['gone'] });

    await as(alice).post('/recipes/delete', { id: recipe.id });
    const res = await as(alice).get('/recipes/tags');

    expect(res.body.data.tags).toEqual([]);
  });

  it('limits the number of results', async () => {
    const alice = await createUser('alice');
    await createRecipe(alice, { tags: ['one', 'two', 'three'] });

    const res = await as(alice).get('/recipes/tags?limit=2');

    expect(res.body.data.tags).toHaveLength(2);
  });
});
