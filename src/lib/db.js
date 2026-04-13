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
    author     TEXT,
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

  CREATE TABLE IF NOT EXISTS rpg_user_state (
    username   TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rpg_questmaker_items (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT NOT NULL,
    feature             TEXT NOT NULL,
    model               TEXT NOT NULL,
    prompt_tokens       INTEGER NOT NULL DEFAULT 0,
    completion_tokens   INTEGER NOT NULL DEFAULT 0,
    total_tokens        INTEGER NOT NULL DEFAULT 0,
    cost                REAL,
    generation_id       TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created ON ai_usage_log (username, created_at DESC);

  CREATE TABLE IF NOT EXISTS tester_bug_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    page_url      TEXT NOT NULL,
    comment       TEXT NOT NULL DEFAULT '',
    screenshot    BLOB NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT 'image/png',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tester_bug_reports_created ON tester_bug_reports (created_at DESC);

  CREATE TABLE IF NOT EXISTS tester_ui_preferences (
    username    TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

let schemaPromise = null;

/** Bestehende DBs ohne Spalte: einmalig ALTER (idempotent). */
async function ensureQuotesAuthorColumn() {
  const db = createDbClient();
  try {
    await db.execute('ALTER TABLE quotes ADD COLUMN author TEXT');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

export async function ensureDbSchema() {
  if (!schemaPromise) {
    const db = createDbClient();
    schemaPromise = db.executeMultiple(SCHEMA_DDL).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
  await ensureQuotesAuthorColumn();
}

export function getDb() {
  return createDbClient();
}
