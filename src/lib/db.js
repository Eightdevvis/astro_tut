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
import { seedFeedPolicyDefaults } from './feed-policy.js';

function isValidDbUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (url.includes('deine-turso-url-hier')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function readBooleanFlag(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function resolveDbUrl() {
  const env = import.meta.env ?? process.env ?? {};
  const tursoUrl = env.TURSO_URL;
  if (isValidDbUrl(tursoUrl)) return tursoUrl;

  const isDev = readBooleanFlag(env.DEV) || String(env.NODE_ENV || '').toLowerCase() !== 'production';
  const allowLocalFallback = readBooleanFlag(env.ALLOW_LOCAL_FILE_DB_FALLBACK);
  if (allowLocalFallback || isDev) {
    const reason = allowLocalFallback ? 'ALLOW_LOCAL_FILE_DB_FALLBACK=1' : 'dev-mode';
    console.warn(`[db] TURSO_URL fehlt/ungueltig -> verwende lokale file:users.db (${reason}).`);
    return 'file:users.db';
  }

  throw new Error(
    '[db] TURSO_URL fehlt oder ist ungueltig. Setze TURSO_URL/TURSO_AUTH_TOKEN (z. B. via Vercel env pull) oder erlaube lokal explizit ALLOW_LOCAL_FILE_DB_FALLBACK=1.'
  );
}

function createDbClient() {
  const env = import.meta.env ?? process.env ?? {};
  return createClient({
    url: resolveDbUrl(),
    authToken: env.TURSO_AUTH_TOKEN,
  });
}

/** Gleiche DDL wie scripts/init_turso.js / init_db.cjs — idempotent bei jedem Start. */
const SCHEMA_DDL = `
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

  CREATE TABLE IF NOT EXISTS blog_posts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT NOT NULL,
    content_html     TEXT NOT NULL,
    content_text     TEXT NOT NULL DEFAULT '',
    accent_color     TEXT NOT NULL DEFAULT '#8dc5ff',
    doodle_data_url  TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_blog_posts_user_created ON blog_posts (username, created_at DESC, id DESC);

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

  CREATE TABLE IF NOT EXISTS rpg_user_state_backups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL,
    backup_kind TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rpg_user_state_backups_user_created
    ON rpg_user_state_backups (username, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS rpg_questmaker_items (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rpg_achievements (
    id          TEXT PRIMARY KEY,
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

  -- Tile-basierte Graffiti-Architektur (Phase 2):
  -- Pro Page wird der Canvas in 512x512-Kacheln unterteilt. Jede Kachel ist ein
  -- gerendertes PNG. Der Client malt, render lokal die betroffenen Kacheln neu
  -- und uploadet sie. Erase = einfaches destination-out im Client, dann Tile-Upload.
  -- version dient zur optimistic-concurrency: wenn ein anderer User zwischendurch
  -- denselben Tile editiert hat, lehnt der Server den Upload ab (409).
  CREATE TABLE IF NOT EXISTS graffiti_tiles (
    page_path  TEXT NOT NULL,
    tile_x     INTEGER NOT NULL,
    tile_y     INTEGER NOT NULL,
    png_blob   BLOB NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (page_path, tile_x, tile_y)
  );
  CREATE INDEX IF NOT EXISTS idx_graffiti_tiles_page_updated ON graffiti_tiles (page_path, updated_at DESC);

  CREATE TABLE IF NOT EXISTS user_feeds (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    title         TEXT NOT NULL,
    user_prompt   TEXT NOT NULL DEFAULT '',
    ai_plan_json  TEXT NOT NULL DEFAULT '{}',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_ingest_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_feeds_username ON user_feeds (username, sort_order ASC, id ASC);

  CREATE TABLE IF NOT EXISTS user_feed_sources (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id         INTEGER NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'rss',
    url             TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    added_by        TEXT NOT NULL DEFAULT 'user',
    user_confirmed  INTEGER NOT NULL DEFAULT 0,
    last_fetch_at   TEXT,
    last_error      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_sources_feed ON user_feed_sources (feed_id);

  CREATE TABLE IF NOT EXISTS user_feed_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id         INTEGER NOT NULL,
    stable_id       TEXT NOT NULL,
    title           TEXT NOT NULL,
    url             TEXT NOT NULL,
    summary         TEXT,
    published_at    TEXT,
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    source_feed_url TEXT,
    domain          TEXT,
    image_url       TEXT,
    UNIQUE(feed_id, stable_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_items_feed_published ON user_feed_items (feed_id, published_at DESC, fetched_at DESC);

  CREATE TABLE IF NOT EXISTS user_feed_pins (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id         INTEGER NOT NULL,
    url             TEXT NOT NULL,
    title_override  TEXT,
    note            TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_pins_feed ON user_feed_pins (feed_id);

  CREATE TABLE IF NOT EXISTS user_feed_summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id         INTEGER NOT NULL,
    body_md         TEXT NOT NULL,
    covers_through  TEXT,
    generated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    model           TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_user_feed_summaries_feed ON user_feed_summaries (feed_id, generated_at DESC);

  CREATE TABLE IF NOT EXISTS feed_allowlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    value       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    trust_tier  INTEGER NOT NULL DEFAULT 2,
    UNIQUE(kind, value)
  );

  CREATE TABLE IF NOT EXISTS feed_blocklist (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host_pattern  TEXT NOT NULL UNIQUE
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

async function ensureUserFeedItemsImageUrlColumn() {
  const db = createDbClient();
  try {
    await db.execute('ALTER TABLE user_feed_items ADD COLUMN image_url TEXT');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

async function dropLegacyGraffitiStrokesTable() {
  const db = createDbClient();
  try {
    await db.execute('DROP TABLE IF EXISTS graffiti_strokes');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/no such table|does not exist/i.test(msg)) throw err;
  }
}

async function ensureUserPermissionsStateColumn() {
  const db = createDbClient();
  try {
    await db.execute("ALTER TABLE user_permissions ADD COLUMN state TEXT NOT NULL DEFAULT 'granted'");
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

async function dropUsersGlobalColumn() {
  const db = createDbClient();
  try {
    await db.execute('ALTER TABLE users DROP COLUMN "global"');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/no such column|cannot drop|does not exist/i.test(msg)) throw err;
  }
}

async function ensureUsersDisplayNameColumn() {
  const db = createDbClient();
  try {
    await db.execute('ALTER TABLE users ADD COLUMN display_name TEXT');
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
  await ensureUserFeedItemsImageUrlColumn();
  await dropLegacyGraffitiStrokesTable();
  await ensureUserPermissionsStateColumn();
  await dropUsersGlobalColumn();
  await ensureUsersDisplayNameColumn();
  const db = createDbClient();
  await seedFeedPolicyDefaults(db);
}

export function getDb() {
  return createDbClient();
}
