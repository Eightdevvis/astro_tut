// scripts/init_turso.js
// Legt alle Tabellen in der Turso-Cloud-DB an.
// Einmalig ausführen: node scripts/init_turso.js
//
// Braucht TURSO_URL und TURSO_AUTH_TOKEN in der .env Datei.

import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config(); // lädt .env

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT,
    birthday     TEXT NOT NULL,
    password     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    permission TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'granted',
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(username, permission)
  );

  CREATE TABLE IF NOT EXISTS global_permissions (
    permission TEXT PRIMARY KEY,
    granted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS permission_warnings (
    permission TEXT PRIMARY KEY,
    activated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  CREATE TABLE IF NOT EXISTS rpg_locations (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS user_feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    user_prompt TEXT NOT NULL DEFAULT '',
    ai_plan_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_ingest_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_feeds_username ON user_feeds (username, sort_order ASC, id ASC);

  CREATE TABLE IF NOT EXISTS user_feed_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'rss',
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    added_by TEXT NOT NULL DEFAULT 'user',
    user_confirmed INTEGER NOT NULL DEFAULT 0,
    last_fetch_at TEXT,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_sources_feed ON user_feed_sources (feed_id);

  CREATE TABLE IF NOT EXISTS user_feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    stable_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_feed_url TEXT,
    domain TEXT,
    image_url TEXT,
    UNIQUE(feed_id, stable_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_items_feed_published ON user_feed_items (feed_id, published_at DESC, fetched_at DESC);

  CREATE TABLE IF NOT EXISTS user_feed_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title_override TEXT,
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_pins_feed ON user_feed_pins (feed_id);

  CREATE TABLE IF NOT EXISTS user_feed_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    body_md TEXT NOT NULL,
    covers_through TEXT,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    model TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_summaries_feed ON user_feed_summaries (feed_id, generated_at DESC);

  CREATE TABLE IF NOT EXISTS feed_allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    trust_tier INTEGER NOT NULL DEFAULT 2,
    UNIQUE(kind, value)
  );

  CREATE TABLE IF NOT EXISTS feed_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_pattern TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS user_vocab_cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    word          TEXT NOT NULL,
    pronunciation TEXT NOT NULL DEFAULT '',
    definition    TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_user_vocab_cards_user_created
    ON user_vocab_cards (username, created_at ASC, id ASC);
`);

console.log('✓ Alle Tabellen in Turso angelegt.');
