/** Clean up one tag: trim, lowercase and collapse repeated spaces */
export const normaliseTag = (tag: string) =>
  tag.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Clean up user-entered tags so "Quick", " quick " and "QUICK" are all stored
 * as "quick", removing duplicates and empty tags. Anything that isn't a list
 * of strings is returned unchanged, so validation can reject it
 */
export const normaliseTags = <T>(tags: T): T => {
  if (!Array.isArray(tags)) return tags;

  const cleaned = tags.map((tag) =>
    typeof tag === 'string' ? normaliseTag(tag) : tag,
  );
  return [...new Set(cleaned)].filter((tag) => tag !== '') as T;
};
