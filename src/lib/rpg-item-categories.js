/**
 * Item-Kategorien für Questmaker / Katalog (hardcodierte Enum — KI filtert darüber).
 * Erweiterungen: hier ergänzen, ggf. Anzeigenamen in UI.
 */

/** @type {readonly string[]} */
export const RPG_ITEM_CATEGORY_IDS = Object.freeze([
  'alltag',
  'studium',
  'arbeit',
  'gesundheit',
  'beziehungen',
  'organisation',
  'sonstiges',
]);

/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isRpgItemCategoryId(id) {
  return typeof id === 'string' && /** @type {readonly string[]} */ (RPG_ITEM_CATEGORY_IDS).includes(id);
}
