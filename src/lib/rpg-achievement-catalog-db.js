/**
 * Persistenter Achievement-Katalog (libsql).
 * Achievements wachsen dynamisch — jeder Nutzer kann neue anlegen.
 * Struktur: { id, title, description, updated_at }
 */

import { getDb } from './db.js';

/**
 * @typedef {{ id: string; title: string; description: string; updatedAt: string }} RpgAchievementRow
 */

/**
 * Slugifiziert einen Titel zu einer stabilen ID (Kleinbuchstaben, Bindestriche).
 * @param {string} title
 * @returns {string}
 */
function slugifyTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c] ?? c)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || 'achievement';
}

/**
 * Erzeugt eine eindeutige ID basierend auf dem Titel.
 * Fügt -2, -3, … an wenn die Basis-ID schon belegt ist.
 * @param {string} title
 * @returns {Promise<string>}
 */
async function resolveUniqueId(title) {
  const db = getDb();
  const base = slugifyTitle(title);
  // Erst prüfen ob Basis frei
  const r = await db.execute({ sql: 'SELECT id FROM rpg_achievements WHERE id = ?', args: [base] });
  if (r.rows.length === 0) return base;
  // Suffix-Schleife
  for (let n = 2; n <= 999; n++) {
    const id = `${base}-${n}`;
    const r2 = await db.execute({ sql: 'SELECT id FROM rpg_achievements WHERE id = ?', args: [id] });
    if (r2.rows.length === 0) return id;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Sucht Achievements nach Freitext-Query.
 * Leere Query → die neuesten 20 zurückgeben (für initiales Dropdown).
 * @param {string} q
 * @param {number} [limit]
 * @returns {Promise<RpgAchievementRow[]>}
 */
export async function searchAchievements(q, limit = 8) {
  const db = getDb();
  const safe = Math.min(Math.max(Number(limit) || 8, 1), 30);
  const term = (q || '').trim().toLowerCase();

  if (!term) {
    // Keine Query → neueste zurückgeben
    const r = await db.execute(`SELECT id, title, description, updated_at FROM rpg_achievements ORDER BY updated_at DESC LIMIT ${safe}`);
    return _rowsToAchievements(r.rows);
  }

  const like = `%${term}%`;
  const r = await db.execute({
    sql: `SELECT id, title, description, updated_at
          FROM rpg_achievements
          WHERE lower(id) LIKE ? OR lower(title) LIKE ?
          ORDER BY
            CASE WHEN lower(title) = ? THEN 0
                 WHEN lower(title) LIKE ? THEN 1
                 ELSE 2 END,
            title ASC
          LIMIT ${safe}`,
    args: [like, like, term, `${term}%`],
  });
  return _rowsToAchievements(r.rows);
}

/**
 * Legt ein neues Achievement an. Gibt das gespeicherte Objekt zurück.
 * @param {{ title: string; description?: string }} data
 * @returns {Promise<RpgAchievementRow>}
 */
export async function upsertAchievement(data) {
  const title = String(data.title || '').trim();
  if (!title) throw new Error('title erforderlich');
  const description = String(data.description || '').trim();
  const id = await resolveUniqueId(title);
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO rpg_achievements (id, title, description, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO NOTHING`,
    args: [id, title, description],
  });
  // Objekt zurückliefern (entweder neu oder existierend bei race)
  const r = await db.execute({ sql: 'SELECT id, title, description, updated_at FROM rpg_achievements WHERE id = ?', args: [id] });
  const row = r.rows[0];
  if (!row) throw new Error('Achievement konnte nicht angelegt werden');
  return _rowToAchievement(/** @type {Record<string, unknown>} */ (row));
}

/**
 * @param {unknown[]} rows
 * @returns {RpgAchievementRow[]}
 */
function _rowsToAchievements(rows) {
  return rows.map((r) => _rowToAchievement(/** @type {Record<string, unknown>} */ (r)));
}

/**
 * @param {Record<string, unknown>} o
 * @returns {RpgAchievementRow}
 */
function _rowToAchievement(o) {
  const updatedRaw = o.updated_at ?? o.updatedAt;
  return {
    id: typeof o.id === 'string' ? o.id : '',
    title: typeof o.title === 'string' ? o.title : '',
    description: typeof o.description === 'string' ? o.description : '',
    updatedAt: typeof updatedRaw === 'string' ? updatedRaw : '',
  };
}
