/**
 * src/lib/db.js
 * Zentrale Datenbankverbindung.
 *
 * Lokal:       file:users.db  (SQLite-Datei)
 * Vercel/Prod: unbedingt Turso (TURSO_URL + TURSO_AUTH_TOKEN) — reine Datei-DB auf
 *              Serverless ist flüchtig und eignet sich nicht als einzige Datenquelle.
 *
 * @libsql/client kann beides — gleiche API, anderer URL.
 */

import { createClient } from '@libsql/client';

function createDbClient() {
  return createClient({
    url: import.meta.env.TURSO_URL ?? 'file:users.db',
    authToken: import.meta.env.TURSO_AUTH_TOKEN,
  });
}

/** Gleiche DDL wie scripts/init_turso.js / init_db.cjs — idempotent bei jedem Start. */
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    birthday TEXT NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    permission TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(username, permission)
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    setting_key TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_fonts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    family_name       TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    format_hint       TEXT NOT NULL DEFAULT 'truetype',
    data              BLOB NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fractal_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    mode       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

let schemaPromise = null;

export async function ensureDbSchema() {
  if (!schemaPromise) {
    const db = createDbClient();
    schemaPromise = db.executeMultiple(SCHEMA_DDL).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

export function getDb() {
  return createDbClient();
}
