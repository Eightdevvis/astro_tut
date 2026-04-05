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
`);

console.log('✓ Alle Tabellen in Turso angelegt.');
