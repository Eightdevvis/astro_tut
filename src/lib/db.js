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

// Vite inlinet `import.meta.env` build-time als statisches Objekt — auf Vercel
// landen Server-Secrets dort u.U. NICHT (nur PUBLIC_-Prefix wird zuverlaessig
// gebaked). Deshalb: zur Laufzeit erst `process.env` lesen, `import.meta.env`
// nur als Backup. Ein einzelnes Object-`??` wuerde nie auf process.env fallen,
// weil import.meta.env als (leeres) Objekt truthy ist.
function readEnv(key) {
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[key];
    if (v != null && v !== '') return v;
  }
  try {
    const v = import.meta.env?.[key];
    if (v != null && v !== '') return v;
  } catch {}
  return undefined;
}

function resolveDbUrl() {
  const tursoUrl = readEnv('TURSO_URL');
  if (isValidDbUrl(tursoUrl)) return tursoUrl;

  const nodeEnv = readEnv('NODE_ENV') ?? '';
  const isDev = readBooleanFlag(readEnv('DEV')) || nodeEnv.toLowerCase() !== 'production';
  const allowLocalFallback = readBooleanFlag(readEnv('ALLOW_LOCAL_FILE_DB_FALLBACK'));
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
  return createClient({
    url: resolveDbUrl(),
    authToken: readEnv('TURSO_AUTH_TOKEN'),
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

  CREATE TABLE IF NOT EXISTS minigame_progress (
    username   TEXT NOT NULL,
    game_id    TEXT NOT NULL,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (username, game_id)
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

  -- Site-Objekt-Katalog (Phase 1): kanonische Liste aller "Dinge" die im
  -- Frontend rumfliegen / nutzbar sind (Spraydosen, Stifte, Stempel, Sticker,
  -- Schwämme, Schlüssel, Sammlerstücke, ...). STRIKT GETRENNT von rpg_*.
  -- - kind: Kategorie für UI-Gruppierung (graffiti/pen/stamp/sticker/eraser/key/...)
  -- - behavior: was die Engine damit anstellt
  --     "draw"   = Werkzeug in GraffitiLayer (z.B. Spraydose, Marker, Schwamm)
  --     "place"  = wird auf einer Seite platziert
  --     "unlock" = schaltet etwas frei
  --     "none"   = nur Sammlerstück / dekorativ
  -- - config_json: typ-spezifische Werte (Farbe, strokeMode, imageUrl, ...).
  CREATE TABLE IF NOT EXISTS site_item_catalog (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    variant      TEXT NOT NULL DEFAULT '',
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    behavior     TEXT NOT NULL DEFAULT 'none',
    config_json  TEXT NOT NULL DEFAULT '{}',
    enabled      INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_site_item_catalog_kind_sort ON site_item_catalog (kind, sort_order, id);

  -- Hand-Inventar pro User. slot = 'hand' (was der User gerade trägt) oder
  -- 'slot0'..'slotN-1'. item_id ist FK auf site_item_catalog.id (kein hartes
  -- FK weil libsql/turso, aber wir prüfen Existenz im Helper).
  CREATE TABLE IF NOT EXISTS site_user_inventory (
    username    TEXT NOT NULL,
    slot        TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (username, slot)
  );

  -- Items die auf einer Seite liegen. Eine Instanz pro Drop — derselbe
  -- Katalog-item_id kann mehrfach auf derselben Page rumliegen.
  CREATE TABLE IF NOT EXISTS site_placed_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_path   TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    placed_by   TEXT NOT NULL,
    placed_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_site_placed_items_page ON site_placed_items (page_path, id);

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

  CREATE TABLE IF NOT EXISTS blog_post_revisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id         INTEGER NOT NULL,
    username        TEXT NOT NULL,
    content_html    TEXT NOT NULL,
    content_text    TEXT NOT NULL DEFAULT '',
    accent_color    TEXT NOT NULL DEFAULT '#8dc5ff',
    doodle_data_url TEXT NOT NULL DEFAULT '',
    privacy_flags   TEXT NOT NULL DEFAULT '{}',
    change_reason   TEXT NOT NULL DEFAULT 'save',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_post
    ON blog_post_revisions (post_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_user
    ON blog_post_revisions (username, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS blog_post_drafts (
    username        TEXT NOT NULL,
    post_id         INTEGER NOT NULL DEFAULT 0,
    content_html    TEXT NOT NULL DEFAULT '',
    content_text    TEXT NOT NULL DEFAULT '',
    accent_color    TEXT NOT NULL DEFAULT '#8dc5ff',
    doodle_data_url TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (username, post_id)
  );
  CREATE INDEX IF NOT EXISTS idx_blog_post_drafts_user_updated
    ON blog_post_drafts (username, updated_at DESC);

  CREATE TABLE IF NOT EXISTS blog_post_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user   TEXT NOT NULL,
    post_id      INTEGER,
    token_hash   TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL DEFAULT 'shared',
    label        TEXT NOT NULL DEFAULT '',
    max_uses     INTEGER,
    used_count   INTEGER NOT NULL DEFAULT 0,
    expires_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_blog_post_tokens_owner
    ON blog_post_tokens (owner_user, post_id, revoked_at);
  CREATE INDEX IF NOT EXISTS idx_blog_post_tokens_post
    ON blog_post_tokens (post_id, revoked_at);

  CREATE TABLE IF NOT EXISTS request_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT NOT NULL DEFAULT (datetime('now')),
    path           TEXT NOT NULL,
    post_id        INTEGER,
    username       TEXT,
    ua_string      TEXT NOT NULL DEFAULT '',
    ua_category    TEXT NOT NULL DEFAULT 'unknown',
    ua_bot_name    TEXT,
    ip_hash        TEXT NOT NULL DEFAULT '',
    country        TEXT,
    referer        TEXT,
    status         INTEGER NOT NULL DEFAULT 200,
    blocked_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_request_log_post_ts
    ON request_log (post_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_request_log_user_ts
    ON request_log (username, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_request_log_blocked_ts
    ON request_log (blocked_reason, ts DESC);

  CREATE TABLE IF NOT EXISTS request_stats_daily (
    date         TEXT NOT NULL,
    scope_kind   TEXT NOT NULL,
    scope_id     TEXT NOT NULL DEFAULT '',
    ua_category  TEXT NOT NULL,
    ua_bot_name  TEXT NOT NULL DEFAULT '',
    status       INTEGER NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, scope_kind, scope_id, ua_category, ua_bot_name, status)
  );

  CREATE TABLE IF NOT EXISTS user_privacy_defaults (
    username           TEXT PRIMARY KEY,
    default_visibility TEXT NOT NULL DEFAULT 'public',
    default_flags      TEXT NOT NULL DEFAULT '{}',
    hub_excluded       INTEGER NOT NULL DEFAULT 0,
    full_hidden        INTEGER NOT NULL DEFAULT 0,
    block_all_ai       INTEGER NOT NULL DEFAULT 0,
    backup_webhook_url TEXT NOT NULL DEFAULT '',
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
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

async function ensureBlogPostsPrivacyColumns() {
  const db = createDbClient();
  const statements = [
    "ALTER TABLE blog_posts ADD COLUMN deleted_at TEXT",
    "ALTER TABLE blog_posts ADD COLUMN public_slug TEXT",
    "ALTER TABLE blog_posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
    "ALTER TABLE blog_posts ADD COLUMN privacy_flags TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE blog_posts ADD COLUMN password_hash TEXT",
    "ALTER TABLE blog_posts ADD COLUMN expires_at TEXT",
  ];
  for (const sql of statements) {
    try {
      await db.execute(sql);
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  }
  try {
    await db.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_public_slug ON blog_posts (public_slug) WHERE public_slug IS NOT NULL'
    );
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/already exists/i.test(msg)) throw err;
  }
  try {
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_blog_posts_visibility ON blog_posts (visibility, deleted_at)'
    );
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (!/already exists/i.test(msg)) throw err;
  }
}

export async function ensureDbSchema() {
  // Alle Wartungs-Statements (ALTER/DROP/Seeds) liefen früher pro Request frisch
  // gegen Turso — 8+ Round-Trips überall, selbst auf der Home. Jetzt einmal pro
  // Cold-Start hinter dem gleichen Promise wie das initiale DDL.
  if (!schemaPromise) {
    const db = createDbClient();
    schemaPromise = (async () => {
      await db.executeMultiple(SCHEMA_DDL);
      await ensureQuotesAuthorColumn();
      await ensureUserFeedItemsImageUrlColumn();
      await dropLegacyGraffitiStrokesTable();
      await ensureUserPermissionsStateColumn();
      await dropUsersGlobalColumn();
      await ensureUsersDisplayNameColumn();
      await ensureBlogPostsPrivacyColumns();
      await seedFeedPolicyDefaults(db);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

export function getDb() {
  return createDbClient();
}
