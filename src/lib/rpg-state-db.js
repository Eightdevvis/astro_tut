import { getDb } from './db.js';

/**
 * Server-Payload: Pflichtfelder unten; zusätzliche Top-Level-Keys (z. B. später Kategorien, KI-Meta)
 * bleiben beim PUT erhalten, solange der Client sie nicht überschreibt (Merge mit vorherigem Stand).
 *
 * @typedef {{
 *   graph: { quests: unknown[]; edges: unknown[] } & Record<string, unknown>;
 *   addedIds: string[];
 *   stepDone: Record<string, Record<string, boolean>>;
 *   schemaVersion?: number;
 *   location?: { city: string; place: string };
 *   locationCatalog?: { cityIds: string[]; placeIds: string[] };
 *   locations?: { id: string; kind: string; name: string; description?: string; city?: string; country?: string }[];
 *   [key: string]: unknown;
 * }} RpgStoredPayload
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

/**
 * @param {string} username
 * @param {string} backupKind
 * @param {unknown} payloadLike
 */
async function insertRpgStateBackup(username, backupKind, payloadLike) {
  if (!username || !backupKind) return;
  let payloadText = '';
  if (typeof payloadLike === 'string') {
    payloadText = payloadLike;
  } else {
    try {
      payloadText = JSON.stringify(payloadLike ?? null);
    } catch {
      payloadText = JSON.stringify({ error: 'backup_serialize_failed' });
    }
  }
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO rpg_user_state_backups (username, backup_kind, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))`,
    args: [username, backupKind, payloadText],
  });
}

/** @param {string} username @param {RpgStoredPayload} payload */
export async function saveRpgState(username, payload) {
  const db = getDb();
  const prev = await db.execute({
    sql: 'SELECT payload FROM rpg_user_state WHERE username = ?',
    args: [username],
  });
  const prevRaw = typeof prev.rows[0]?.payload === 'string' ? prev.rows[0].payload : '';
  if (prevRaw) {
    // Doppelsicherung vor jedem Write: vorheriger Zustand + eingehender Zustand.
    await insertRpgStateBackup(username, 'before_overwrite', prevRaw);
  }
  await insertRpgStateBackup(username, 'incoming_write', payload);
  const text = JSON.stringify(payload);
  await db.execute({
    sql: `INSERT INTO rpg_user_state (username, payload, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(username) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
    args: [username, text],
  });
  // Retention: begrenzt Backup-Wachstum pro User (neueste 240 behalten).
  await db.execute({
    sql: `DELETE FROM rpg_user_state_backups
          WHERE username = ?
            AND id NOT IN (
              SELECT id FROM rpg_user_state_backups
              WHERE username = ?
              ORDER BY id DESC
              LIMIT 240
            )`,
    args: [username, username],
  });
}

/** @param {string} username */
export async function deleteRpgState(username) {
  const db = getDb();
  const prev = await db.execute({
    sql: 'SELECT payload FROM rpg_user_state WHERE username = ?',
    args: [username],
  });
  const prevRaw = typeof prev.rows[0]?.payload === 'string' ? prev.rows[0].payload : '';
  if (prevRaw) {
    await insertRpgStateBackup(username, 'before_delete', prevRaw);
    await insertRpgStateBackup(username, 'delete_marker', { resetToDefault: true, username });
  }
  await db.execute({ sql: 'DELETE FROM rpg_user_state WHERE username = ?', args: [username] });
}

/**
 * Alle gespeicherten RPG-Payloads (Migration / Admin).
 * @returns {Promise<{ username: string; payload: RpgStoredPayload }[]>}
 */
export async function listAllRpgStates() {
  const db = getDb();
  const r = await db.execute('SELECT username, payload FROM rpg_user_state');
  /** @type {{ username: string; payload: RpgStoredPayload }[]} */
  const out = [];
  for (const row of r.rows) {
    const username = typeof row.username === 'string' ? row.username : String(row.username ?? '').trim();
    if (!username) continue;
    const raw = row.payload;
    if (typeof raw !== 'string') continue;
    try {
      const payload = /** @type {RpgStoredPayload} */ (JSON.parse(raw));
      if (payload && typeof payload === 'object') out.push({ username, payload });
    } catch {
      /* Zeile überspringen */
    }
  }
  return out;
}

/**
 * @param {string} username
 * @param {number} [limit]
 */
export async function listRpgStateBackups(username, limit = 30) {
  const db = getDb();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 30;
  const r = await db.execute({
    sql: `SELECT id, backup_kind, created_at, length(payload) AS payload_bytes
          FROM rpg_user_state_backups
          WHERE username = ?
          ORDER BY id DESC
          LIMIT ?`,
    args: [username, safeLimit],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    kind: typeof row.backup_kind === 'string' ? row.backup_kind : String(row.backup_kind ?? ''),
    created_at: typeof row.created_at === 'string' ? row.created_at : String(row.created_at ?? ''),
    payload_bytes: Number(row.payload_bytes || 0),
  }));
}

/**
 * @param {string} username
 * @param {number} backupId
 * @returns {Promise<RpgStoredPayload | null>}
 */
export async function getRpgStateBackupPayload(username, backupId) {
  const db = getDb();
  const id = Math.trunc(Number(backupId));
  if (!Number.isFinite(id) || id <= 0) return null;
  const r = await db.execute({
    sql: `SELECT payload FROM rpg_user_state_backups WHERE username = ? AND id = ? LIMIT 1`,
    args: [username, id],
  });
  const raw = r.rows[0]?.payload;
  if (typeof raw !== 'string') return null;
  try {
    return /** @type {RpgStoredPayload} */ (JSON.parse(raw));
  } catch {
    return null;
  }
}
