import { jwtVerify } from 'jose';
import { hasPermission } from '../../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import { getJwtSecretBytes } from '../../../../lib/jwt-secret.js';
import { fireBackupWebhook } from '../../../../lib/backup-webhook.js';

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

// POST mit Body { revisionId: <n> } stellt diese Revision als aktuellen
// Stand wieder her. Vor dem Restore wird der bisherige Stand selbst als
// neue Revision (change_reason='restore-snapshot') abgelegt — sonst
// koennte ein Restore frueheres Material verlieren.
export async function POST({ params, request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const postId = Number(String(params?.id ?? '').trim());
  if (!Number.isInteger(postId) || postId <= 0) return json({ error: 'Ungültige Post-ID' }, 400);

  let body = {};
  try { body = await request.json(); } catch {}
  const revisionId = Number(body?.revisionId);
  if (!Number.isInteger(revisionId) || revisionId <= 0) return json({ error: 'Ungültige Revision-ID' }, 400);

  try {
    await ensureDbSchema();
    const db = getDb();
    const rev = await db.execute({
      sql: `SELECT content_html, content_text, accent_color, doodle_data_url, privacy_flags
              FROM blog_post_revisions
             WHERE id = ? AND post_id = ? AND username = ?
             LIMIT 1`,
      args: [revisionId, postId, auth.username],
    });
    const revRow = rev.rows?.[0];
    if (!revRow) return json({ error: 'Revision nicht gefunden' }, 404);

    const cur = await db.execute({
      sql: `SELECT content_html, content_text, accent_color, doodle_data_url, privacy_flags, deleted_at
              FROM blog_posts
             WHERE id = ? AND username = ?
             LIMIT 1`,
      args: [postId, auth.username],
    });
    const curRow = cur.rows?.[0];
    if (!curRow) return json({ error: 'Post nicht gefunden' }, 404);
    if (curRow.deleted_at) return json({ error: 'Post ist im Papierkorb' }, 409);

    // Sicherheits-Snapshot des aktuellen Stands.
    await db.execute({
      sql: `INSERT INTO blog_post_revisions
              (post_id, username, content_html, content_text, accent_color,
               doodle_data_url, privacy_flags, change_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'restore-snapshot')`,
      args: [
        postId,
        auth.username,
        String(curRow.content_html || ''),
        String(curRow.content_text || ''),
        String(curRow.accent_color || '#8dc5ff'),
        String(curRow.doodle_data_url || ''),
        String(curRow.privacy_flags || '{}'),
      ],
    });

    await db.execute({
      sql: `UPDATE blog_posts
              SET content_html = ?, content_text = ?, accent_color = ?, doodle_data_url = ?, privacy_flags = ?
            WHERE id = ? AND username = ? AND deleted_at IS NULL`,
      args: [
        String(revRow.content_html || ''),
        String(revRow.content_text || ''),
        String(revRow.accent_color || '#8dc5ff'),
        String(revRow.doodle_data_url || ''),
        String(revRow.privacy_flags || '{}'),
        postId,
        auth.username,
      ],
    });

    fireBackupWebhook(auth.username, 'post.update', {
      id: postId,
      content_text: String(revRow.content_text || ''),
      content_html: String(revRow.content_html || ''),
    });
    return json({ success: true, postId, restoredFrom: revisionId });
  } catch (err) {
    console.error('posts/[id]/restore-revision POST', err);
    return json({ error: 'Wiederherstellen fehlgeschlagen' }, 500);
  }
}
