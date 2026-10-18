import * as cheerio from 'cheerio';

const MAX_TEXT_LENGTH = 60_000;

// JSON-LD fields that are large and have nothing to do with the recipe itself
const IGNORED_FIELDS = new Set([
  'review',
  'aggregateRating',
  'video',
  'comment',
  'interactionStatistic',
  'publisher',
  'author',
  'image',
  'thumbnailUrl',
]);

const isRecipe = (node: Record<string, unknown>) => {
  const type = node['@type'];
  return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
};

/**
 * Find a schema.org Recipe anywhere in parsed JSON-LD. Sites nest it in
 * arrays, in @graph, or under mainEntity, so this searches the whole tree
 */
const findRecipe = (
  node: unknown,
  depth = 0,
): Record<string, unknown> | null => {
  if (depth > 10 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  if (isRecipe(obj)) return obj;
  for (const value of Object.values(obj)) {
    const found = findRecipe(value, depth + 1);
    if (found) return found;
  }
  return null;
};

/**
 * Get what we need from a recipe page to send for extraction. Most recipe
 * sites embed a schema.org Recipe as JSON-LD, which is small and accurate, so
 * that's used when it's there. Otherwise the page's main text is used
 */
export const parsePage = (html: string) => {
  const $ = cheerio.load(html);

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const recipe = findRecipe(JSON.parse($(script).text()));
      if (recipe) {
        const trimmed = Object.fromEntries(
          Object.entries(recipe).filter(([key]) => !IGNORED_FIELDS.has(key)),
        );
        return { source: 'json-ld' as const, content: JSON.stringify(trimmed) };
      }
    } catch {
      // Invalid JSON-LD is common. Try the next script, then fall back to text
    }
  }

  $(
    'script, style, noscript, svg, iframe, nav, header, footer, aside, form',
  ).remove();
  const main = $('main').first().length
    ? $('main').first()
    : $('article').first().length
      ? $('article').first()
      : $('body');
  const text = main
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);

  return { source: 'text' as const, content: text };
};
