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
 * @param {string} raw
 * @returns {string[]}
 */
function tokenizeLookupText(raw) {
  return String(raw || '')
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 12);
}

/**
 * @param {QuestmakerCatalogRow} row
 * @param {{ proposedItemId?: string; name?: string; keywords?: string[] }} lookup
 * @param {string[]} tokens
 */
function scoreLookupMatch(row, lookup, tokens) {
  let score = 0;
  const rowId = row.id.toLowerCase();
  const rowTitle = String(row.title || '').toLowerCase();
  const rowDesc = String(row.description || '').toLowerCase();
  const proposedId = String(lookup?.proposedItemId || '').trim().toLowerCase();
  const lookupName = String(lookup?.name || '').trim().toLowerCase();
  if (proposedId && rowId === proposedId) score += 120;
  if (lookupName && rowTitle === lookupName) score += 90;
  if (lookupName && rowTitle.includes(lookupName)) score += 50;
  for (const t of tokens) {
    if (rowId === t) score += 45;
    else if (rowId.includes(t)) score += 25;
    if (rowTitle.includes(t)) score += 18;
    if (rowDesc.includes(t)) score += 8;
  }
  return score;
}

/**
 * Katalog-Retrieval für AI-Orchestrierung:
 * liefert nur wenige, relevante Kandidaten statt Vollkatalog.
 * @param {{ proposedItemId?: string; name?: string; keywords?: string[]; limit?: number }} lookup
 * @returns {Promise<QuestmakerCatalogRow[]>}
 */
export async function searchQuestmakerCatalogCandidates(lookup) {
  const proposedItemId = String(lookup?.proposedItemId || '').trim().toLowerCase();
  const name = String(lookup?.name || '').trim();
  const kwRaw = Array.isArray(lookup?.keywords) ? lookup.keywords.map((x) => String(x)).join(' ') : '';
  const tokens = [...new Set([...tokenizeLookupText(proposedItemId), ...tokenizeLookupText(name), ...tokenizeLookupText(kwRaw)])].slice(0, 8);
  const limit = Math.min(Math.max(Number(lookup?.limit) || 5, 1), 12);
  if (!proposedItemId && !name && tokens.length === 0) return [];

  const db = getDb();
  const likeArgs = [];
  const likeClauses = [];
  for (const t of tokens) {
    const like = `%${t}%`;
    likeClauses.push('(lower(id) LIKE ? OR lower(title) LIKE ? OR lower(description) LIKE ?)');
    likeArgs.push(like, like, like);
  }
  const where = [
    proposedItemId ? 'lower(id) = ?' : '',
    name ? 'lower(title) LIKE ?' : '',
    likeClauses.length > 0 ? `(${likeClauses.join(' OR ')})` : '',
  ]
    .filter(Boolean)
    .join(' OR ');
  /** @type {unknown[]} */
  const args = [];
  if (proposedItemId) args.push(proposedItemId);
  if (name) args.push(`%${name.toLowerCase()}%`);
  args.push(...likeArgs);
  const sql = `SELECT id, category, title, description, updated_at
               FROM rpg_questmaker_items
               ${where ? `WHERE ${where}` : ''}
               LIMIT 120`;
  const r = await db.execute({ sql, args });
  /** @type {QuestmakerCatalogRow[]} */
  const rows = [];
  for (const raw of r.rows) {
    const o = /** @type {Record<string, unknown>} */ (raw);
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) continue;
    rows.push({
      id,
      category: coerceCategory(o.category),
      title: typeof o.title === 'string' ? o.title : id,
      description: typeof o.description === 'string' ? o.description : '',
      updatedAt: typeof o.updated_at === 'string' ? o.updated_at : '',
    });
  }
  return rows
    .map((row) => ({ row, score: scoreLookupMatch(row, lookup || {}, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map((x) => x.row);
}

/**
 * Legt nur **neue** Katalog-Zeilen an. Bereits existierende `id` bleiben unverändert
 * (kein Überschreiben fremder oder eigener Einträge durch spätere PUTs).
 * @param {{ id: string; category: string; title: string; description: string }[]} items
 */
export async function upsertQuestmakerCatalogItems(items) {
  if (!items.length) return;
  const db = getDb();
  for (const it of items) {
    await db.execute({
      sql: `INSERT INTO rpg_questmaker_items (id, category, title, description, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO NOTHING`,
      args: [it.id, it.category, it.title, it.description],
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
