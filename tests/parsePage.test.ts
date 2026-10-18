import { describe, expect, it } from 'vitest';
import { parsePage } from '@utils/recipeImport/parsePage';

const page = (head: string, body = '') =>
  `<html><head>${head}</head><body>${body}</body></html>`;
const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

const recipe = {
  '@type': 'Recipe',
  name: 'Pancakes',
  recipeIngredient: ['200g flour', '2 eggs'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix' }],
  totalTime: 'PT25M',
};

describe('parsePage', () => {
  it('uses JSON-LD when the page has a Recipe', () => {
    const result = parsePage(
      page(jsonLd({ '@context': 'https://schema.org', ...recipe })),
    );

    expect(result.source).toBe('json-ld');
    expect(JSON.parse(result.content)).toMatchObject({
      name: 'Pancakes',
      recipeIngredient: ['200g flour', '2 eggs'],
    });
  });

  it('finds a Recipe inside @graph, alongside other types', () => {
    const result = parsePage(
      page(
        jsonLd({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Food blog' },
            { '@type': ['Recipe', 'NewsArticle'], name: 'Soup' },
          ],
        }),
      ),
    );

    expect(result.source).toBe('json-ld');
    expect(JSON.parse(result.content).name).toBe('Soup');
  });

  it('finds a Recipe nested under another node or in an array', () => {
    const nested = parsePage(
      page(jsonLd({ '@type': 'WebPage', mainEntity: recipe })),
    );
    const inArray = parsePage(
      page(jsonLd([{ '@type': 'Organization' }, recipe])),
    );

    expect(JSON.parse(nested.content).name).toBe('Pancakes');
    expect(JSON.parse(inArray.content).name).toBe('Pancakes');
  });

  it('drops large fields that have nothing to do with the recipe', () => {
    const result = parsePage(
      page(
        jsonLd({
          ...recipe,
          review: [{ reviewBody: 'Yum' }],
          aggregateRating: { ratingValue: 5 },
          video: { contentUrl: 'https://example.com/v.mp4' },
        }),
      ),
    );

    const content = JSON.parse(result.content);
    expect(content.review).toBeUndefined();
    expect(content.aggregateRating).toBeUndefined();
    expect(content.video).toBeUndefined();
    expect(content.name).toBe('Pancakes');
  });

  it('skips invalid JSON-LD and uses the next script', () => {
    const result = parsePage(
      page(
        `<script type="application/ld+json">{ not json</script>${jsonLd(recipe)}`,
      ),
    );

    expect(result.source).toBe('json-ld');
  });

  it("falls back to the main text when there's no Recipe JSON-LD", () => {
    const result = parsePage(
      page(
        jsonLd({ '@type': 'WebSite' }) + '<style>.x{}</style>',
        `<nav>Home | Recipes</nav>
         <main><h1>Pancakes</h1><p>200g   flour</p><script>track()</script></main>
         <footer>Copyright</footer>`,
      ),
    );

    expect(result.source).toBe('text');
    expect(result.content).toContain('Pancakes');
    expect(result.content).toContain('200g flour');
    expect(result.content).not.toMatch(/Home|Copyright|track/);
  });

  it('limits the length of the text', () => {
    const result = parsePage(
      page('', `<main>${'word '.repeat(50_000)}</main>`),
    );

    expect(result.content.length).toBeLessThanOrEqual(60_000);
  });
});
