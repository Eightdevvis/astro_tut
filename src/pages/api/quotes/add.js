import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  let username;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = payload.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  const allowed = await hasPermission(username, 'quote_poster');
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const { text } = body;
  if (!text || String(text).trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Zitat darf nicht leer sein' }), { status: 400 });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: 'INSERT INTO quotes (username, text) VALUES (?, ?)',
      args: [username, String(text).trim()]
    });

    const rid = result.lastInsertRowid;
    const id = rid === undefined || rid === null ? null : String(rid);

    return new Response(JSON.stringify({ success: true, id }), { status: 201 });
  } catch (err) {
    console.error('quotes/add', err);
    return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen' }), { status: 500 });
  }
}
