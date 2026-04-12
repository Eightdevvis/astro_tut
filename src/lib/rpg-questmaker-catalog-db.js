/**
 * Persistenter Questmaker-Item-Katalog (libsql).
 */

import { getDb } from './db.js';
import { isRpgItemCategoryId } from './rpg-item-categories.js';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function coerceCategory(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return isRpgItemCategoryId(s) ? s : 'sonstiges';
}

/**
 * @typedef {{ id: string; category: string; title: string; description: string; updatedAt: string }} QuestmakerCatalogRow
 */

/**
 * @returns {Promise<QuestmakerCatalogRow[]>}
 */
export async function listQuestmakerCatalogRows() {
  const db = getDb();
  const r = await db.execute(
    `SELECT id, category, title, description, updated_at FROM rpg_questmaker_items ORDER BY id`
  );
  /** @type {QuestmakerCatalogRow[]} */
  const out = [];
  for (const row of r.rows) {
    const o = /** @type {Record<string, unknown>} */ (row);
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) continue;
    const updatedRaw = o.updated_at ?? o.updatedAt;
    out.push({
      id,
      category: coerceCategory(o.category),
      title: typeof o.title === 'string' ? o.title : id,
      description: typeof o.description === 'string' ? o.description : '',
      updatedAt: typeof updatedRaw === 'string' ? updatedRaw : '',
    });
  }
  return out;
}

/**
 * Nur fehlende IDs anlegen (Titel aus Quest-Referenz, Kategorie sonstiges).
 * @param {Map<string, { displayName?: string }>} refs
 */
export async function insertMissingQuestmakerItems(refs) {
  if (refs.size === 0) return;
  const db = getDb();
  for (const [id, meta] of refs) {
    if (!id.trim()) continue;
    const title = (meta.displayName && meta.displayName.trim()) || id;
    const description = '';
    const category = 'sonstiges';
    await db.execute({
      sql: `INSERT OR IGNORE INTO rpg_questmaker_items (id, category, title, description, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [id, category, title, description],
    });
  }
}

/**
 * Admin: komplette Liste ersetzen.
 * @param {{ id: string; category?: string; title: string; description?: string }[]} items
 */
export async function replaceQuestmakerCatalog(items) {
  const db = getDb();
  await db.execute('DELETE FROM rpg_questmaker_items');
  for (const raw of items) {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) continue;
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id;
    const description = typeof raw.description === 'string' ? raw.description : '';
    const category = coerceCategory(raw.category);
    await db.execute({
      sql: `INSERT INTO rpg_questmaker_items (id, category, title, description, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [id, category, title, description],
    });
  }
}
