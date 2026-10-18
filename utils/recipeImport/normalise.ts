import { RecipeCategory, Unit } from 'constants/recipeConstants';

// Common ways recipes write units, mapped to ours
const UNIT_ALIASES: Record<string, Unit> = {
  gram: Unit.g,
  grams: Unit.g,
  gr: Unit.g,
  kilogram: Unit.kg,
  kilograms: Unit.kg,
  kgs: Unit.kg,
  teaspoon: Unit.tsp,
  teaspoons: Unit.tsp,
  tsps: Unit.tsp,
  tablespoon: Unit.tbsp,
  tablespoons: Unit.tbsp,
  tbsps: Unit.tbsp,
  tbs: Unit.tbsp,
  tbl: Unit.tbsp,
  millilitre: Unit.ml,
  millilitres: Unit.ml,
  milliliter: Unit.ml,
  milliliters: Unit.ml,
  mls: Unit.ml,
  l: Unit.liter,
  litre: Unit.liter,
  litres: Unit.liter,
  liters: Unit.liter,
  cups: Unit.cup,
  ounce: Unit.oz,
  ounces: Unit.oz,
  'fl. oz': Unit.fl_oz,
  floz: Unit.fl_oz,
  'fluid ounce': Unit.fl_oz,
  'fluid ounces': Unit.fl_oz,
  pound: Unit.lb,
  pounds: Unit.lb,
  lbs: Unit.lb,
  pinches: Unit.pinch,
  dashes: Unit.dash,
  cans: Unit.can,
  tin: Unit.can,
  tins: Unit.can,
  bunches: Unit.bunch,
  slices: Unit.slice,
  piece: Unit.pieces,
  pcs: Unit.pieces,
  clove: Unit.cloves,
};

const units = new Set<string>(Object.values(Unit));

/**
 * Map a unit from an imported recipe to one of ours ('Tablespoons' to
 * 'tbsp'). Anything unrecognised is returned unchanged, so validation flags it
 */
export const matchUnit = (unit: string | null): string | null => {
  if (unit === null) return null;
  const key = unit.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (key === '') return null;
  if (units.has(key)) return key;
  return UNIT_ALIASES[key] ?? unit;
};

/**
 * Map a category from an imported recipe to one of ours, ignoring case and a
 * plural 's' ('desserts' to 'Dessert'). Anything else is returned unchanged
 */
export const matchCategory = (category: string): string => {
  const key = category.trim().toLowerCase().replace(/s$/, '');
  return (
    Object.values(RecipeCategory).find(
      (value) => value.toLowerCase().replace(/s$/, '') === key,
    ) ?? category
  );
};
