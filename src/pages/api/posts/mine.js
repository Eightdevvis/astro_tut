import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

export async function GET({ cookies }) {
  const token = cookies.get('session')?.value;
  if (!token) return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });

  let username = '';
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    username = String(payload.username || '');
  } catch {
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }

  const allowed = await hasPermission(username, 'blogpost_poster');
  if (!allowed) return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, content_html, content_text, accent_color, doodle_data_url, created_at
            FROM blog_posts
           WHERE username = ? AND deleted_at IS NULL
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT 100`,
      args: [username],
    });
    const posts = (result.rows || []).map((row) => ({
      id: Number(row.id),
      content_html: String(row.content_html || ''),
      content_text: String(row.content_text || ''),
      accent_color: String(row.accent_color || '#8dc5ff'),
      doodle_data_url: String(row.doodle_data_url || ''),
      created_at: String(row.created_at || ''),
    }));
    return new Response(JSON.stringify({ posts }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('posts/mine', err);
    return new Response(JSON.stringify({ error: 'Laden fehlgeschlagen' }), { status: 500 });
  }
}
