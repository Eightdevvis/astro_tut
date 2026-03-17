/**
 * src/lib/db.js
 * Zentrale Datenbankverbindung.
 *
 * Lokal:       file:users.db  (SQLite-Datei, wie bisher)
 * Production:  Turso-Cloud-DB via TURSO_URL + TURSO_AUTH_TOKEN
 *
 * @libsql/client kann beides — gleiche API, anderer URL.
 */

import { createClient } from '@libsql/client';

export function getDb() {
  return createClient({
    url: import.meta.env.TURSO_URL ?? 'file:users.db',
    authToken: import.meta.env.TURSO_AUTH_TOKEN,
  });
}
