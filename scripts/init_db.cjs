// scripts/init_db.cjs
// Initialisiert die SQLite-Datenbank.
// Muss einmalig ausgeführt werden: node scripts/init_db.cjs
// Kann gefahrlos erneut ausgeführt werden — IF NOT EXISTS verhindert Datenverlust.

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./users.db');

db.serialize(() => {

  // --- Tabelle: users ---
  // Speichert alle registrierten User.
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      birthday TEXT NOT NULL,
      password TEXT NOT NULL        -- bcrypt-Hash, nie Klartext
    )
  `);
  console.log('✓ users-Tabelle bereit.');

  // --- Tabelle: user_permissions ---
  // Speichert welcher User welches Recht hat.
  //
  // Warum separate Tabelle statt einer Spalte in users?
  // → Flexibel: Rechte können jederzeit hinzugefügt/entfernt werden
  //   ohne die users-Tabelle anzufassen.
  // → Ein User kann beliebig viele Rechte haben (n:m-Beziehung).
  // → UNIQUE(username, permission) verhindert doppelte Einträge.
  //
  // Verfügbare Rechte: siehe KNOWN_PERMISSIONS in src/lib/permissions.js
  // (u. a. super_access = Vollzugriff, quote_poster, tester_access, rpg_access).
  db.run(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(username, permission)              -- kein Recht doppelt vergeben
    )
  `);
  console.log('✓ user_permissions-Tabelle bereit.');

  // --- Tabelle: quotes ---
  // Speichert alle eingereichten Zitate.
  // Nur User mit dem Recht "quote_poster" dürfen Zitate hinzufügen.
  db.run(`
    CREATE TABLE IF NOT EXISTS quotes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL,             -- wer hat es eingereicht
      text       TEXT NOT NULL,             -- das Zitat selbst
      author     TEXT,                      -- angezeigter Urheber (optional; leer = keiner)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ quotes-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS site_settings (
      setting_key TEXT PRIMARY KEY,
      value       TEXT NOT NULL
    )
  `);
  console.log('✓ site_settings-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS custom_fonts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      family_name       TEXT NOT NULL UNIQUE,
      original_filename TEXT NOT NULL,
      mime_type         TEXT NOT NULL,
      format_hint       TEXT NOT NULL DEFAULT 'truetype',
      data              BLOB NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ custom_fonts-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS fractal_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL,
      mode       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ fractal_snapshots-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS rpg_user_state (
      username   TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ rpg_user_state-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS rpg_questmaker_items (
      id          TEXT PRIMARY KEY,
      category    TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ rpg_questmaker_items-Tabelle bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS rpg_locations (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      city        TEXT NOT NULL DEFAULT '',
      country     TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ rpg_locations-Tabelle bereit.');

  db.run(`
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
    )
  `);
  console.log('✓ ai_usage_log-Tabelle bereit.');

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created ON ai_usage_log (username, created_at DESC)
  `);
  console.log('✓ idx_ai_usage_log_user_created bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS tester_bug_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL,
      page_url      TEXT NOT NULL,
      comment       TEXT NOT NULL DEFAULT '',
      screenshot    BLOB NOT NULL,
      mime_type     TEXT NOT NULL DEFAULT 'image/png',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ tester_bug_reports-Tabelle bereit.');

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_tester_bug_reports_created ON tester_bug_reports (created_at DESC)
  `);
  console.log('✓ idx_tester_bug_reports_created bereit.');

  db.run(`
    CREATE TABLE IF NOT EXISTS tester_ui_preferences (
      username    TEXT PRIMARY KEY,
      enabled     INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  console.log('✓ tester_ui_preferences-Tabelle bereit.');

  db.run(`
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
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_feeds_username ON user_feeds (username, sort_order ASC, id ASC)`);
  db.run(`
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
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_feed_sources_feed ON user_feed_sources (feed_id)`);
  db.run(`
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
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_feed_items_feed_published ON user_feed_items (feed_id, published_at DESC, fetched_at DESC)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_feed_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title_override TEXT,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_feed_pins_feed ON user_feed_pins (feed_id)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_feed_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      body_md TEXT NOT NULL,
      covers_through TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL DEFAULT ''
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_feed_summaries_feed ON user_feed_summaries (feed_id, generated_at DESC)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS feed_allowlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      trust_tier INTEGER NOT NULL DEFAULT 2,
      UNIQUE(kind, value)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS feed_blocklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_pattern TEXT NOT NULL UNIQUE
    )
  `);
  console.log('✓ Topic-Feed-Tabellen bereit.');

});

db.close();
