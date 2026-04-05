import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb } from '../../../lib/db.js';
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

  const { text } = await request.json();
  if (!text || text.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Zitat darf nicht leer sein' }), { status: 400 });
  }

  const db = getDb();
  const result = await db.execute({
    sql: 'INSERT INTO quotes (username, text) VALUES (?, ?)',
    args: [username, text.trim()]
  });

  return new Response(JSON.stringify({ success: true, id: result.lastInsertRowid }), { status: 201 });
}
