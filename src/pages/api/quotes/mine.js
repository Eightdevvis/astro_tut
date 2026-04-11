import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

/**
 * GET /api/quotes/mine
 * Alle Zitate des eingeloggten Nutzers (Submitter), sortiert nach Datum absteigend.
 */
export async function GET({ cookies }) {
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

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, username, text, author, created_at
            FROM quotes WHERE username = ? ORDER BY datetime(created_at) DESC`,
      args: [username],
    });
    const raw = result.rows ?? [];
    const quotes = raw.map((row) => ({
      id: Number(row.id),
      username: row.username,
      text: row.text,
      author: row.author ?? null,
      created_at: row.created_at,
    }));
    return new Response(JSON.stringify({ quotes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('quotes/mine', err);
    return new Response(JSON.stringify({ error: 'Laden fehlgeschlagen' }), { status: 500 });
  }
}
