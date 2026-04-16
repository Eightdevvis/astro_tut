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

});

db.close();
