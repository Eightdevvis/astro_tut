import { getDb } from './db.js';

/**
 * @typedef {{ graph: { quests: unknown[]; edges: unknown[] }; addedIds: string[]; stepDone: Record<string, Record<string, boolean>> }} RpgStoredPayload
 */

/** @param {string} username */
export async function getRpgState(username) {
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT payload FROM rpg_user_state WHERE username = ?',
    args: [username],
  });
  const row = r.rows[0];
  if (!row) return null;
  const raw = row.payload;
  if (typeof raw !== 'string') return null;
  try {
    return /** @type {RpgStoredPayload} */ (JSON.parse(raw));
  } catch {
    return null;
  }
}

/** @param {string} username @param {RpgStoredPayload} payload */
export async function saveRpgState(username, payload) {
  const db = getDb();
  const text = JSON.stringify(payload);
  await db.execute({
    sql: `INSERT INTO rpg_user_state (username, payload, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(username) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
    args: [username, text],
  });
}

/** @param {string} username */
export async function deleteRpgState(username) {
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM rpg_user_state WHERE username = ?', args: [username] });
}
