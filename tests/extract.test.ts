import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractRecipe, IMPORT_MODEL } from '@utils/recipeImport/extract';
import { ErrorCode } from 'translations/errorCodes';

// A fake Anthropic client, so no request reaches the API
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { parse } })),
}));

const recipe = {
  title: 'Pancakes',
  description: null,
  category: 'Breakfast',
  serves: 4,
  prepTime: 10,
  cookTime: 15,
  ingredients: [{ subheader: null, quantity: 2, name: 'eggs', unit: null }],
  steps: ['Mix', 'Cook'],
  tags: ['quick'],
};

beforeEach(() => {
  parse.mockReset();
});

describe('extractRecipe', () => {
  it('returns the recipe Claude found', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { bFoundRecipe: true, recipe },
    });

    const result = await extractRecipe({ text: 'Pancakes...' });

    expect(result).toEqual(recipe);
  });

  it("returns null when there's no recipe", async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { bFoundRecipe: false, recipe: null },
    });

    const result = await extractRecipe({ text: 'A blog post' });

    expect(result).toBeNull();
  });

  it('uses the cheap import model at low effort, with structured output', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { bFoundRecipe: true, recipe },
    });

    await extractRecipe({ text: '<recipe>' });

    const params = parse.mock.calls[0][0];
    expect(IMPORT_MODEL).toBe('claude-haiku-5-5');
    expect(params.model).toBe(IMPORT_MODEL);
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0].content[0].text).toContain('<recipe>');
  });

  it('sends images as base64 with their type', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { bFoundRecipe: true, recipe },
    });
    const image = Buffer.from('image bytes');

    await extractRecipe({ images: [{ data: image, mediaType: 'image/png' }] });

    expect(parse.mock.calls[0][0].messages[0].content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: image.toString('base64'),
      },
    });
  });

  it('sends several images in order, as the pages of one recipe', async () => {
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { bFoundRecipe: true, recipe },
    });
    const page1 = Buffer.from('page one');
    const page2 = Buffer.from('page two');

    await extractRecipe({
      images: [
        { data: page1, mediaType: 'image/jpeg' },
        { data: page2, mediaType: 'image/png' },
      ],
    });

    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content.map((block: { type: string }) => block.type)).toEqual([
      'image',
      'image',
      'text',
    ]);
    expect(content[0].source.data).toBe(page1.toString('base64'));
    expect(content[1].source.data).toBe(page2.toString('base64'));
    expect(content[2].text).toContain('2 images are the pages of one recipe');
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal', parsed_output: null }],
    [
      'output that could not be parsed',
      { stop_reason: 'max_tokens', parsed_output: null },
    ],
  ])('fails with IMPORT_FAILED on %s', async (_label, response) => {
    parse.mockResolvedValue(response);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(extractRecipe({ text: 'x' })).rejects.toThrow(
      ErrorCode.Import_Failed,
    );
  });

  it('fails with IMPORT_FAILED when the API call fails', async () => {
    parse.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(extractRecipe({ text: 'x' })).rejects.toThrow(
      ErrorCode.Import_Failed,
    );
  });
});
