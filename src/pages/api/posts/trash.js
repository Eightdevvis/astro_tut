import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireUser(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return { error: json({ error: 'Nicht eingeloggt' }, 401) };
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '');
    const allowed = await hasPermission(username, 'blogpost_poster');
    if (!allowed) return { error: json({ error: 'Keine Berechtigung' }, 403) };
    return { username };
  } catch {
    return { error: json({ error: 'Session ungültig' }, 401) };
  }
}

export async function GET({ cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  try {
    await ensureDbSchema();
    const result = await getDb().execute({
      sql: `SELECT id, content_html, content_text, accent_color, doodle_data_url,
                   created_at, deleted_at
              FROM blog_posts
             WHERE username = ? AND deleted_at IS NOT NULL
             ORDER BY datetime(deleted_at) DESC, id DESC
             LIMIT 100`,
      args: [auth.username],
    });
    const posts = (result.rows || []).map((row) => ({
      id: Number(row.id),
      content_html: String(row.content_html || ''),
      content_text: String(row.content_text || ''),
      accent_color: String(row.accent_color || '#8dc5ff'),
      doodle_data_url: String(row.doodle_data_url || ''),
      created_at: String(row.created_at || ''),
      deleted_at: String(row.deleted_at || ''),
    }));
    return json({ posts });
  } catch (err) {
    console.error('posts/trash', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}
