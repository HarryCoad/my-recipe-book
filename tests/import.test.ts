import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app';
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
      description: null,
      cookTime: 0,
    });

    const res = await as(alice).post('/recipes/import-url', {
      url: 'https://example.com/p',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.draft.cookTime).toBe(0);
    expect(
      res.body.data.issues.map((i: { fieldname: string }) => i.fieldname),
    ).toEqual(['description', 'cookTime']);
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
      image: jpeg,
      mediaType: 'image/jpeg',
    });
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

describe('import rate limit', () => {
  it('allows 20 imports an hour per user', async () => {
    const bobby = await createUser('bobby');
    vi.mocked(extractRecipe).mockResolvedValue(extracted);

    for (let i = 0; i < 20; i += 1) {
      await importImage(alice, png);
    }
    const limited = await importImage(alice, png);
    const otherUser = await importImage(bobby, png);

    expect(limited.status).toBe(429);
    expect(limited.body.message).toBe(ErrorCode.Too_Many_Imports);
    expect(otherUser.status).toBe(200);
  });
});
