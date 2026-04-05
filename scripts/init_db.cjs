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
  // Verfügbare Rechte (werden hier nur dokumentiert, nicht erzwungen):
  //   quote_poster  — darf Zitate auf der Startseite posten
  //   (weitere folgen)
  //
  // Sonderfall "sash": wird NICHT in dieser Tabelle geprüft —
  // sash ist hardcoded Superuser in src/lib/permissions.js und hat immer alle Rechte.
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

});

db.close();
