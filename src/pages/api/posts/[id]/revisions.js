import { jwtVerify } from 'jose';
import { hasPermission } from '../../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import { getJwtSecretBytes } from '../../../../lib/jwt-secret.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

function parsePostId(params) {
  const id = Number(String(params?.id ?? '').trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET({ params, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const postId = parsePostId(params);
  if (!postId) return json({ error: 'Ungültige Post-ID' }, 400);
  try {
    await ensureDbSchema();
    const r = await getDb().execute({
      sql: `SELECT id, change_reason, created_at,
                   substr(content_text, 1, 160) AS preview,
                   length(content_text) AS length
              FROM blog_post_revisions
             WHERE post_id = ? AND username = ?
             ORDER BY id DESC
             LIMIT 200`,
      args: [postId, auth.username],
    });
    return json({ revisions: r.rows || [] });
  } catch (err) {
    console.error('posts/[id]/revisions GET', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}
