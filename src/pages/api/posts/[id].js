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

export async function PATCH({ params, request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const id = parsePostId(params);
  if (!id) return json({ error: 'Ungültige Post-ID' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültiger JSON-Body' }, 400);
  }

  const contentHtml = String(body?.contentHtml || '').trim();
  const contentText = String(body?.contentText || '').trim();
  if (!contentText) return json({ error: 'Inhalt darf nicht leer sein' }, 400);
  if (contentText.length > 10000 || contentHtml.length > 40000) {
    return json({ error: 'Post ist zu lang' }, 400);
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `UPDATE blog_posts
            SET content_html = ?, content_text = ?
            WHERE id = ? AND username = ?`,
      args: [contentHtml, contentText, id, auth.username],
    });
    const changes = Number(result.rowsAffected ?? 0);
    if (changes === 0) return json({ error: 'Post nicht gefunden' }, 404);
    return json({ success: true, id });
  } catch (err) {
    console.error('posts/[id] patch', err);
    return json({ error: 'Aktualisierung fehlgeschlagen' }, 500);
  }
}

export async function DELETE({ params, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const id = parsePostId(params);
  if (!id) return json({ error: 'Ungültige Post-ID' }, 400);

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `DELETE FROM blog_posts WHERE id = ? AND username = ?`,
      args: [id, auth.username],
    });
    const changes = Number(result.rowsAffected ?? 0);
    if (changes === 0) return json({ error: 'Post nicht gefunden' }, 404);
    return json({ success: true, id });
  } catch (err) {
    console.error('posts/[id] delete', err);
    return json({ error: 'Loeschen fehlgeschlagen' }, 500);
  }
}
