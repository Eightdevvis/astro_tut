import { jwtVerify } from 'jose';
import { hasPermission } from '../../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import { getJwtSecretBytes } from '../../../../lib/jwt-secret.js';
import { fireBackupWebhook } from '../../../../lib/backup-webhook.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parsePostId(params) {
  const raw = String(params?.id ?? '').trim();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
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

export async function POST({ params, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const id = parsePostId(params);
  if (!id) return json({ error: 'Ungültige Post-ID' }, 400);

  try {
    await ensureDbSchema();
    const result = await getDb().execute({
      sql: `UPDATE blog_posts
              SET deleted_at = NULL
            WHERE id = ? AND username = ? AND deleted_at IS NOT NULL`,
      args: [id, auth.username],
    });
    const changes = Number(result.rowsAffected ?? 0);
    if (changes === 0) return json({ error: 'Nicht im Papierkorb' }, 404);
    fireBackupWebhook(auth.username, 'post.restore', { id });
    return json({ success: true, id });
  } catch (err) {
    console.error('posts/[id]/restore', err);
    return json({ error: 'Wiederherstellen fehlgeschlagen' }, 500);
  }
}
