/**
 * src/lib/permissions.js
 * Zentrale Logik für das Rechte-System.
 *
 * SUPERUSER: "sash" hat immer alle Rechte, hardcoded.
 *
 * VERFÜGBARE RECHTE:
 *   quote_poster  — darf Zitate posten
 *
 * RECHTE HINZUFÜGEN:
 * 1. Hier in KNOWN_PERMISSIONS eintragen
 * 2. hasPermission() aufrufen wo gebraucht
 */

import { getDb } from './db.js';

const SUPERUSER = 'sash';

export const KNOWN_PERMISSIONS = [
  'quote_poster',
];

export async function hasPermission(username, permission) {
  if (username === SUPERUSER) return true;

  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id FROM user_permissions WHERE username = ? AND permission = ?',
    args: [username, permission]
  });
  return result.rows.length > 0;
}

export async function getPermissions(username) {
  if (username === SUPERUSER) return [...KNOWN_PERMISSIONS];

  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT permission FROM user_permissions WHERE username = ?',
    args: [username]
  });
  return result.rows.map(r => r.permission);
}

export async function grantPermission(username, permission) {
  const db = getDb();
  await db.execute({
    sql: 'INSERT OR IGNORE INTO user_permissions (username, permission) VALUES (?, ?)',
    args: [username, permission]
  });
}

export async function revokePermission(username, permission) {
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM user_permissions WHERE username = ? AND permission = ?',
    args: [username, permission]
  });
}
