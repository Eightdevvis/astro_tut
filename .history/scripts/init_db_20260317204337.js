// scripts/init_db.js
// Initialisiert die SQLite-Datenbank und legt die users-Tabelle an
// Ausführlich kommentiert, damit du alles verstehst

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./users.db');

db.serialize(() => {
  // Tabelle anlegen, falls nicht vorhanden
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      birthday TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `);
  console.log('users-Tabelle wurde angelegt (falls nicht vorhanden).');
});

db.close();

// Stolperstellen:
// - Script muss einmal ausgeführt werden (node scripts/init_db.js)
// - users.db wird im Projekt-Root angelegt
// - Keine Migration, nur Initialisierung
