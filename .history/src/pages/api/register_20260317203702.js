import { sqlite3 } from 'sqlite3';
import { open } from 'sqlite';

/**
 * API-Endpunkt: /api/register
 * Registriert einen neuen User mit Username, Geburtstag (MM-TT), Passwort (gehasht)
 * Antwort: { success: true, user: { ... } } oder { error: ... }
 */

export async function POST({ request }) {
  const db = await open({ filename: './users.db', driver: sqlite3.Database });
  const { username, birthday, password } = await request.json();

  // Validierung
  if (!username || !birthday || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  // Username-Check
  const exists = await db.get('SELECT * FROM users WHERE username = ?', username);
  if (exists) {
    return new Response(JSON.stringify({ error: 'Username existiert schon' }), { status: 409 });
  }

  // Passwort hashen
  const hash = await hashPassword(password);

  // User speichern
  await db.run('INSERT INTO users (username, birthday, password) VALUES (?, ?, ?)', username, birthday, hash);
  const user = { username, birthday };

  // Session setzen (Demo: JWT oder Cookie)
  // ...

  return new Response(JSON.stringify({ success: true, user }), { status: 201 });
}

// Hilfsfunktion: Passwort hashen (Demo, in echt bcrypt oder argon2)
async function hashPassword(pw) {
  // TODO: bcrypt/argon2 einbauen
  return 'hashed_' + pw;
}

/**
 * Stolperstellen:
 * - SQLite muss initialisiert sein (users-Tabelle)
 * - Passwort-Hashing: Demo, in echt bcrypt/argon2
 * - Session-Handling: Noch nicht implementiert
 * - Fehlerhandling: Minimal
 */
