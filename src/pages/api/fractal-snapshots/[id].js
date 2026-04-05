import { jwtVerify } from 'jose';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

async function getUsername(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    return payload.username;
  } catch {
    return null;
  }
}

/**
 * DELETE /api/fractal-snapshots/:id
 */
export async function DELETE({ cookies, params }) {
  const username = await getUsername(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 1) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), { status: 400 });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const chk = await db.execute({
      sql: 'SELECT id FROM fractal_snapshots WHERE id = ? AND username = ?',
      args: [id, username],
    });
    if (!chk.rows?.length) {
      return new Response(JSON.stringify({ error: 'Nicht gefunden' }), { status: 404 });
    }
    await db.execute({
      sql: 'DELETE FROM fractal_snapshots WHERE id = ? AND username = ?',
      args: [id, username],
    });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('fractal-snapshots DELETE', err);
    return new Response(JSON.stringify({ error: 'Löschen fehlgeschlagen' }), { status: 500 });
  }
}
