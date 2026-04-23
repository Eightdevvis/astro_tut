import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

async function assertSuper(cookies) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller) return { ok: false, status: 401, error: 'Nicht eingeloggt' };
  if (!(await hasPermission(caller, 'super_access'))) {
    return { ok: false, status: 403, error: 'Keine Berechtigung' };
  }
  return { ok: true, caller };
}

export async function GET({ cookies, url }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 120)));
  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, page_path, username, mode, points_json, is_functional, created_at
            FROM graffiti_strokes
            ORDER BY created_at DESC, id DESC
            LIMIT ?`,
      args: [limit],
    });
    const rows = (result.rows || []).map((r) => {
      let points = [];
      try {
        points = JSON.parse(String(r.points_json || '[]'));
      } catch {
        points = [];
      }
      return {
        id: Number(r.id),
        pagePath: String(r.page_path || '/'),
        username: String(r.username || ''),
        mode: String(r.mode || 'tag'),
        points,
        isFunctional: Number(r.is_functional || 0) ? true : false,
        createdAt: String(r.created_at || ''),
      };
    });
    return new Response(JSON.stringify({ success: true, rows }), { status: 200 });
  } catch (err) {
    console.error('GET /api/admin/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti-Liste fehlgeschlagen' }), { status: 500 });
  }
}

export async function POST({ cookies, request }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }
  const id = Number(body?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'id erforderlich' }), { status: 400 });
  }
  try {
    await ensureDbSchema();
    const db = getDb();
    await db.execute({ sql: 'DELETE FROM graffiti_strokes WHERE id = ?', args: [id] });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('POST /api/admin/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti-Löschen fehlgeschlagen' }), { status: 500 });
  }
}
