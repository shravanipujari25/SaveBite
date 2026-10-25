/**
 * Unit conversion & normalization utilities for grocery intelligence
 */

// Canonical volume units converted to milliliters (ml)
const VOLUME_CONVERSIONS = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  cup: 240,
  cups: 240,
  fl_oz: 29.5735,
  floz: 29.5735,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5
};

// Canonical weight units converted to grams (g)
const WEIGHT_CONVERSIONS = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592
};

// Count/discrete units
const COUNT_UNITS = new Set([
  'piece', 'pieces', 'item', 'items', 'pack', 'packs', 'package', 'packages',
  'box', 'boxes', 'bottle', 'bottles', 'can', 'cans', 'jar', 'jars', 'bunch', 'bunches'
]);

/**
 * Normalize an item name for comparison (lowercased, trimmed, stripped of punctuation and plurals)
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeItemName(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.toLowerCase().trim();
  // Strip leading/trailing qualifiers or punctuation
  clean = clean.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean;
}

/**
 * Standardize unit strings
 *
 * @param {string} unit
 * @returns {string}
 */
export function normalizeUnit(unit) {
  if (!unit || typeof unit !== 'string') return 'piece';
  const u = unit.toLowerCase().trim();
  if (['l', 'liter', 'liters', 'litre', 'litres'].includes(u)) return 'litre';
  if (['ml', 'milliliter', 'milliliters'].includes(u)) return 'ml';
  if (['kg', 'kilogram', 'kilograms'].includes(u)) return 'kg';
  if (['g', 'gram', 'grams'].includes(u)) return 'g';
  if (['oz', 'ounce', 'ounces'].includes(u)) return 'oz';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(u)) return 'lb';
  if (['bottle', 'bottles'].includes(u)) return 'bottle';
  if (['pack', 'packs', 'package', 'packages'].includes(u)) return 'pack';
  if (['box', 'boxes'].includes(u)) return 'box';
  if (['can', 'cans'].includes(u)) return 'can';
  if (['jar', 'jars'].includes(u)) return 'jar';
  if (['piece', 'pieces', 'item', 'items'].includes(u)) return 'piece';
  return u;
}

/**
 * Convert a quantity between two units if compatible.
 * Returns converted quantity or null if units cannot be converted.
 *
 * @param {number} qty
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number|null}
 */
export function convertUnit(qty, fromUnit, toUnit) {
  const normFrom = (fromUnit || '').toLowerCase().trim();
  const normTo = (toUnit || '').toLowerCase().trim();

  if (normFrom === normTo) return qty;

  // Volume
  if (VOLUME_CONVERSIONS[normFrom] && VOLUME_CONVERSIONS[normTo]) {
    const ml = qty * VOLUME_CONVERSIONS[normFrom];
    const converted = ml / VOLUME_CONVERSIONS[normTo];
    return Number(converted.toFixed(3));
  }

  // Weight
  if (WEIGHT_CONVERSIONS[normFrom] && WEIGHT_CONVERSIONS[normTo]) {
    const grams = qty * WEIGHT_CONVERSIONS[normFrom];
    const converted = grams / WEIGHT_CONVERSIONS[normTo];
    return Number(converted.toFixed(3));
  }

  // Same discrete group
  if (COUNT_UNITS.has(normFrom) && COUNT_UNITS.has(normTo)) {
    return qty;
  }

  return null;
}

/**
 * Check if two names are matching or highly similar items
 *
 * @param {string} nameA
 * @param {string} nameB
 * @returns {boolean}
 */
export function isItemNameMatch(nameA, nameB) {
  const a = normalizeItemName(nameA);
  const b = normalizeItemName(nameB);
  if (!a || !b) return false;
  if (a === b) return true;

  // Word token containment (e.g. "whole milk" vs "organic whole milk")
  const tokensA = a.split(' ');
  const tokensB = b.split(' ');
  const commonTokens = tokensA.filter(t => tokensB.includes(t) && t.length > 2);
  
  // If one string contains the other
  if (a.includes(b) || b.includes(a)) {
    return true;
  }

  // Significant common token (e.g. "milk", "eggs", "tomatoes")
  return commonTokens.length > 0 && (commonTokens.length >= Math.min(tokensA.length, tokensB.length) * 0.6);
}
