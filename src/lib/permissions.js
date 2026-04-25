/**
 * src/lib/permissions.js
 * Rechte über Tabelle user_permissions + Bootstrap-Account per Umgebung.
 *
 * super_access: DB-Zeile — hasPermission(username, X) ist true für jedes X.
 *
 * Zusätzlich: Login-Name aus `SITE_SUPERUSER` (`.env` / Vercel) hat immer Vollzugriff wie super_access.
 * Wenn unset oder leer → Fallback `sash`. Nur diese Datei wertet das aus.
 *
 * RECHTE HINZUFÜGEN:
 * 1. Hier in KNOWN_PERMISSIONS eintragen
 * 2. hasPermission() an den passenden Stellen aufrufen
 */

import { getDb, ensureDbSchema } from './db.js';

/** DB-Wert; impliziert alle anderen Rechte bei hasPermission. */
export const SUPER_PERMISSION = 'super_access';

/** Effektiver Bootstrap-Name: Env `SITE_SUPERUSER` oder `sash`. */
function bootstrapSuperUsername() {
  const v = import.meta.env.SITE_SUPERUSER;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return 'sash';
}

function isBootstrapSuper(username) {
  return Boolean(username && username === bootstrapSuperUsername());
}

export const KNOWN_PERMISSIONS = [
  SUPER_PERMISSION,
  'quote_poster',
  'blogpost_poster',
  'tester_access',
  'rpg_access',
  'minigames_access',
];

export async function hasPermission(username, permission) {
  if (!username || !permission) return false;
  if (isBootstrapSuper(username)) return true;

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id FROM user_permissions WHERE username = ? AND (permission = ? OR permission = ?)`,
    args: [username, permission, SUPER_PERMISSION],
  });
  return result.rows.length > 0;
}

export async function getPermissions(username) {
  if (!username) return [];
  if (isBootstrapSuper(username)) return [...KNOWN_PERMISSIONS];

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT permission FROM user_permissions WHERE username = ? ORDER BY permission ASC',
    args: [username],
  });
  return result.rows.map((r) => r.permission);
}

export async function grantPermission(username, permission) {
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: 'INSERT OR IGNORE INTO user_permissions (username, permission) VALUES (?, ?)',
    args: [username, permission],
  });
}

export async function revokePermission(username, permission) {
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM user_permissions WHERE username = ? AND permission = ?',
    args: [username, permission],
  });
}
