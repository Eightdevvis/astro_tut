import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

/**
 * POST /api/quotes/delete
 * Body: { id: number } — eigenes Zitat löschen.
 * (POST statt DELETE: zuverlässiger hinter Proxys / manchen Deployments.)
 */
export async function POST({ request, cookies }) {
  const token = cookies.get('session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let username;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = payload.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const allowed = await hasPermission(username, 'quote_poster');
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = Number(body?.id);
  if (!Number.isFinite(id) || id < 1) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM quotes WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) {
      return new Response(JSON.stringify({ error: 'Nicht gefunden' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.execute({
      sql: 'DELETE FROM quotes WHERE id = ? AND username = ?',
      args: [id, username],
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('quotes/delete POST', err);
    return new Response(JSON.stringify({ error: 'Löschen fehlgeschlagen' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
