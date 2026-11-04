import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app';
import { IMPORTS_PER_HOUR, MAX_IMAGES } from '@controllers/importController';
import AppError from '@utils/appError';
import { extractRecipe } from '@utils/recipeImport/extract';
import { fetchPage } from '@utils/recipeImport/fetchPage';
import { ErrorCode } from 'translations/errorCodes';
import { api, as, createUser, TestUser } from './helpers';

// Tests never call Claude or the internet
vi.mock('@utils/recipeImport/extract', () => ({ extractRecipe: vi.fn() }));
vi.mock('@utils/recipeImport/fetchPage', () => ({ fetchPage: vi.fn() }));

const extracted = {
  title: 'Pancakes',
  description: 'Fluffy pancakes',
  category: 'Breakfast',
  serves: 4,
  prepTime: 10,
  cookTime: 15,
  ingredients: [
    { subheader: null, quantity: 1.5, name: 'plain flour', unit: 'cup' },
    { subheader: null, quantity: 2, name: 'eggs', unit: null },
    { subheader: null, quantity: null, name: 'salt, to taste', unit: null },
  ],
  steps: ['Mix', 'Cook'],
  tags: ['Breakfast ', 'QUICK'],
};

const recipePage = `<html><head><script type="application/ld+json">
  {"@type": "Recipe", "name": "Pancakes"}
</script></head><body></body></html>`;

// Smallest valid PNG and JPEG headers, enough for the type check
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

// Multipart, so not through as(): its .send() can't be mixed with .attach()
const importImage = (user: TestUser, data: Buffer, filename = 'recipe.png') =>
  request(app)
    .post('/api/v1/recipes/import-image')
    .set('Authorization', `Bearer ${user.token}`)
    .attach('image', data, filename);

let alice: TestUser;

beforeEach(async () => {
  vi.mocked(extractRecipe).mockReset();
  vi.mocked(fetchPage).mockReset();
  alice = await createUser('alice');
});

describe('POST /recipes/import-url', () => {
  it('returns a private draft with the source URL, and saves nothing', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });
    const search = await as(alice).get('/recipes/search');

    expect(res.status).toBe(200);
    expect(res.body.data.issues).toEqual([]);
    expect(res.body.data.draft).toMatchObject({
      title: 'Pancakes',
      bPrivate: true,
      sourceUrl: 'https://example.com/pancakes',
      tags: ['breakfast', 'quick'],
    });
    expect(res.body.data.recipe).toBeNull();
    expect(search.body.data).toHaveLength(0);
  });

  it('sends the JSON-LD recipe for extraction', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    const input = vi.mocked(extractRecipe).mock.calls[0][0] as { text: string };
    expect(JSON.parse(input.text)).toMatchObject({ name: 'Pancakes' });
  });

  it('can be submitted to create once the user has checked it', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const imported = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });
    const created = await as(alice).post(
      '/recipes/create',
      imported.body.data.draft,
    );

    expect(created.status).toBe(200);
    expect(created.body.data.recipe).toMatchObject({
      bPrivate: true,
      sourceUrl: 'https://example.com/pancakes',
    });
  });

  it('maps close units and categories, and flags unknown ones', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue({
      ...extracted,
      category: 'desserts',
      ingredients: [
        { subheader: null, quantity: 2, name: 'flour', unit: 'Cups' },
        { subheader: null, quantity: 1, name: 'sugar', unit: 'Tablespoons' },
        { subheader: null, quantity: 1, name: 'butter', unit: 'knob' },
      ],
    });

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    expect(res.body.data.draft.category).toBe('Dessert');
    expect(
      res.body.data.draft.ingredients.map((i: { unit: string }) => i.unit),
    ).toEqual(['cup', 'tbsp', 'knob']);
    expect(res.body.data.issues).toEqual([
      { fieldname: 'ingredients.[2].unit', code: 'invalid_enum_value' },
    ]);
  });

  it('lists the fields the user needs to fix', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue({
      ...extracted,
      serves: 0,
      cookTime: 0,
    });

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.draft.cookTime).toBe(0);
    expect(
      res.body.data.issues.map((i: { fieldname: string }) => i.fieldname),
    ).toEqual(['serves', 'cookTime']);
  });

  it("doesn't flag a missing description", async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockResolvedValue({
      ...extracted,
      description: null,
    });

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
      bSkipReview: true,
    });

    expect(res.body.data.issues).toEqual([]);
    expect(res.body.data.recipe.description).toBeNull();
  });

  it.each([{}, { url: '' }, { url: 42 }])(
    'rejects a missing URL (%o)',
    async (body) => {
      const res = await as(alice).post('/recipes/import-url', body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(ErrorCode.Invalid_Url);
    },
  );

  it('passes on errors from fetching the page', async () => {
    vi.mocked(fetchPage).mockRejectedValue(
      new AppError(ErrorCode.Url_Not_Allowed, 400),
    );

    const res = await as(alice).post('/recipes/import-url', {
      url: 'http://169.254.169.254/',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Url_Not_Allowed);
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it("returns 422 when there's no recipe on the page", async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: '<html><body><main>Just a blog post</main></body></html>',
      finalUrl: 'https://example.com/post',
    });
    vi.mocked(extractRecipe).mockResolvedValue(null);

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/post',
    });

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(ErrorCode.No_Recipe_Found);
  });

  it('passes on a failed extraction', async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
    vi.mocked(extractRecipe).mockRejectedValue(
      new AppError(ErrorCode.Import_Failed, 502),
    );

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    expect(res.status).toBe(502);
    expect(res.body.message).toBe(ErrorCode.Import_Failed);
  });

  it('needs auth', async () => {
    const res = await api.post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    expect(res.status).toBe(401);
  });
});

describe('POST /recipes/import-image', () => {
  it('returns a private draft without a source URL', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await importImage(alice, png);

    expect(res.status).toBe(200);
    expect(res.body.data.draft).toMatchObject({
      title: 'Pancakes',
      bPrivate: true,
      sourceUrl: null,
    });
  });

  it('sends the image with the type read from its bytes, not its name', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    await importImage(alice, jpeg, 'photo.png');

    expect(extractRecipe).toHaveBeenCalledWith({
      images: [{ data: jpeg, mediaType: 'image/jpeg' }],
    });
  });

  it('sends several images of one recipe, in order', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await importImage(alice, jpeg, 'page1.jpg').attach(
      'image',
      png,
      'page2.png',
    );

    expect(res.status).toBe(200);
    expect(extractRecipe).toHaveBeenCalledTimes(1);
    expect(extractRecipe).toHaveBeenCalledWith({
      images: [
        { data: jpeg, mediaType: 'image/jpeg' },
        { data: png, mediaType: 'image/png' },
      ],
    });
  });

  it(`rejects more than ${MAX_IMAGES} images`, async () => {
    let req = importImage(alice, png);
    for (let i = 1; i <= MAX_IMAGES; i += 1) {
      req = req.attach('image', png, `page${i}.png`);
    }

    const res = await req;

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Too_Many_Images);
  });

  it('rejects the import if any of the images is invalid', async () => {
    const res = await importImage(alice, png).attach(
      'image',
      Buffer.from('%PDF-1.7'),
      'page2.pdf',
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Image);
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it("rejects a file that isn't a supported image", async () => {
    const res = await importImage(alice, Buffer.from('%PDF-1.7'), 'recipe.pdf');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Image);
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it('rejects a request with no image', async () => {
    const res = await request(app)
      .post('/api/v1/recipes/import-image')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(ErrorCode.Invalid_Image);
  });

  it('rejects an image over 5 MB', async () => {
    const big = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);

    const res = await importImage(alice, big);

    expect(res.status).toBe(413);
    expect(res.body.message).toBe(ErrorCode.Image_Too_Large);
  });

  it("returns 422 when there's no recipe in the image", async () => {
    vi.mocked(extractRecipe).mockResolvedValue(null);

    const res = await importImage(alice, png);

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(ErrorCode.No_Recipe_Found);
  });
});

describe('bSkipReview', () => {
  const mockPage = () => {
    vi.mocked(fetchPage).mockResolvedValue({
      html: recipePage,
      finalUrl: 'https://example.com/pancakes',
    });
  };

  it('creates the recipe straight away when the import has no issues', async () => {
    mockPage();
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
      bSkipReview: true,
    });
    const saved = await as(alice).get('/recipes/search?bOnlySaved=true');

    expect(res.status).toBe(200);
    expect(res.body.data.issues).toEqual([]);
    expect(res.body.data.recipe).toMatchObject({
      id: expect.any(String),
      title: 'Pancakes',
      authorId: alice.id,
      bPrivate: true,
      bSaved: true,
      sourceUrl: 'https://example.com/pancakes',
    });
    expect(saved.body.data.map((r: { id: string }) => r.id)).toEqual([
      res.body.data.recipe.id,
    ]);
  });

  it("doesn't create a recipe that has issues, returning it for review", async () => {
    mockPage();
    vi.mocked(extractRecipe).mockResolvedValue({ ...extracted, cookTime: 0 });

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
      bSkipReview: true,
    });
    const search = await as(alice).get('/recipes/search');

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toBeNull();
    expect(res.body.data.issues).toHaveLength(1);
    expect(search.body.data).toHaveLength(0);
  });

  it('works for image imports, sent as a form field', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await importImage(alice, png).field('bSkipReview', 'true');

    expect(res.status).toBe(200);
    expect(res.body.data.recipe).toMatchObject({
      title: 'Pancakes',
      sourceUrl: null,
    });
  });

  it.each([false, 'false', 'yes'])(
    'only creates the recipe for true, not %s',
    async (bSkipReview) => {
      mockPage();
      vi.mocked(extractRecipe).mockResolvedValue(extracted);

      const res = await as(alice).post('/recipes/import-url', {
        url: 'https://example.com/p',
        bSkipReview,
      });

      expect(res.body.data.recipe).toBeNull();
    },
  );
});

describe('duplicate imports', () => {
  const importUrl = (user: TestUser, body: object = {}) =>
    as(user).post('/recipes/import-url', {
      url: 'https://example.com/p',
      ...body,
    });
  const pageAt = (finalUrl: string) =>
    vi.mocked(fetchPage).mockResolvedValue({ html: recipePage, finalUrl });

  it('stores the page URL without tracking parameters or an anchor', async () => {
    pageAt('https://example.com/pancakes?utm_source=pin&id=7#recipe');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    const res = await importUrl(alice);

    expect(res.body.data.draft.sourceUrl).toBe(
      'https://example.com/pancakes?id=7',
    );
  });

  it('flags a page already in the book, without calling Claude', async () => {
    pageAt('https://example.com/pancakes');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    const first = await importUrl(alice, { bSkipReview: true });
    vi.mocked(extractRecipe).mockClear();
    pageAt('https://example.com/pancakes?utm_campaign=x#top');

    const again = await importUrl(alice, { bSkipReview: true });
    const search = await as(alice).get('/recipes/search');

    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({
      draft: null,
      issues: [],
      recipe: null,
      duplicateOf: { id: first.body.data.recipe.id, title: 'Pancakes' },
    });
    expect(extractRecipe).not.toHaveBeenCalled();
    expect(search.body.data).toHaveLength(1);
  });

  it('flags photos already imported, including after review', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    const imported = await importImage(alice, png);
    // The user reviews the draft, then saves it through the normal create
    const created = await as(alice).post(
      '/recipes/create',
      imported.body.data.draft,
    );
    vi.mocked(extractRecipe).mockClear();

    const again = await importImage(alice, png);

    expect(imported.body.data.draft.sourceImageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.body.data.recipe.sourceImageHash).toBeUndefined();
    expect(again.body.data.duplicateOf).toEqual({
      id: created.body.data.recipe.id,
      title: 'Pancakes',
    });
    expect(extractRecipe).not.toHaveBeenCalled();
  });

  it('treats the same photos in a different order as different', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    await importImage(alice, png)
      .attach('image', jpeg, 'b.jpg')
      .field('bSkipReview', 'true');

    const reordered = await importImage(alice, jpeg, 'b.jpg').attach(
      'image',
      png,
      'a.png',
    );

    expect(reordered.body.data.duplicateOf).toBeNull();
  });

  it("only looks in the user's own book", async () => {
    const bobby = await createUser('bobby');
    pageAt('https://example.com/pancakes');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    await importUrl(bobby, { bSkipReview: true });

    const res = await importUrl(alice);

    expect(res.body.data.duplicateOf).toBeNull();
    expect(res.body.data.draft.title).toBe('Pancakes');
  });

  it('imports it anyway with bAllowDuplicate', async () => {
    pageAt('https://example.com/pancakes');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    await importUrl(alice, { bSkipReview: true });

    const res = await importUrl(alice, {
      bSkipReview: true,
      bAllowDuplicate: true,
    });
    const search = await as(alice).get('/recipes/search');

    expect(res.body.data.recipe).not.toBeNull();
    expect(search.body.data).toHaveLength(2);
  });

  it('works with bAllowDuplicate as a form field for images', async () => {
    vi.mocked(extractRecipe).mockResolvedValue(extracted);
    await importImage(alice, png).field('bSkipReview', 'true');

    const res = await importImage(alice, png).field('bAllowDuplicate', 'true');

    expect(res.body.data.duplicateOf).toBeNull();
    expect(res.body.data.draft.title).toBe('Pancakes');
  });
});

describe('import rate limit', () => {
  it(`allows ${IMPORTS_PER_HOUR} imports an hour per user`, async () => {
    const bobby = await createUser('bobby');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    for (let i = 0; i < IMPORTS_PER_HOUR; i += 1) {
      await importImage(alice, png);
    }
    const limited = await importImage(alice, png);
    const otherUser = await importImage(bobby, png);

    expect(limited.status).toBe(429);
    expect(limited.body.message).toBe(ErrorCode.Too_Many_Imports);
    expect(otherUser.status).toBe(200);
  });
});
