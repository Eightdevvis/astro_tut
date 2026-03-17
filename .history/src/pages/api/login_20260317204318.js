import { sqlite3 } from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';

/**
 * API-Endpunkt: /api/login
 * Loggt einen User ein, prüft Passwort, setzt Session-Cookie (Demo: JWT)
 * Antwort: { success: true, user: { ... } } oder { error: ... }
 */

export async function POST({ request }) {
  const db = await open({ filename: './users.db', driver: sqlite3.Database });
  const { username, password } = await request.json();

  // Validierung
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  // User holen
  const user = await db.get('SELECT * FROM users WHERE username = ?', username);
  if (!user) {
    return new Response(JSON.stringify({ error: 'User nicht gefunden' }), { status: 404 });
  }

  // Passwort prüfen
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 });
  }

  // Session setzen (Demo: JWT)
  // TODO: JWT generieren und als Cookie setzen

  return new Response(JSON.stringify({ success: true, user: { username: user.username, birthday: user.birthday } }), { status: 200 });
}

/**
 * Stolperstellen:
 * - Session-Handling: JWT/Cookie muss noch gebaut werden
 * - Fehlerhandling: Minimal
 * - bcrypt muss installiert sein (npm install bcryptjs)
 */
