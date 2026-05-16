import { jwtVerify } from 'jose';
import { hasPermission } from '../../../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../../../lib/db.js';
import { getJwtSecretBytes } from '../../../../../lib/jwt-secret.js';

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

export async function DELETE({ params, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const postId = Number(String(params?.id ?? '').trim());
  const tokenId = Number(String(params?.tokenId ?? '').trim());
  if (!Number.isInteger(postId) || postId <= 0 || !Number.isInteger(tokenId) || tokenId <= 0) {
    return json({ error: 'Ungültige IDs' }, 400);
  }
  try {
    await ensureDbSchema();
    const r = await getDb().execute({
      sql: `UPDATE blog_post_tokens
              SET revoked_at = datetime('now')
            WHERE id = ? AND owner_user = ? AND post_id = ? AND revoked_at IS NULL`,
      args: [tokenId, auth.username, postId],
    });
    if (Number(r.rowsAffected ?? 0) === 0) return json({ error: 'Token nicht gefunden' }, 404);
    return json({ success: true });
  } catch (err) {
    console.error('posts/[id]/tokens/[tokenId] DELETE', err);
    return json({ error: 'Widerruf fehlgeschlagen' }, 500);
  }
}
