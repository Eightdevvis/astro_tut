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

function parsePostId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

function normalizeColor(v) {
  const value = String(v || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return '#8dc5ff';
  return value.toLowerCase();
}

// A2 — Server-seitiger Auto-Save. Eine Reihe pro (username, post_id).
// post_id = 0 ist der Draft-Slot fuer einen neuen, noch nicht gespeicherten Post.
export async function GET({ url, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const postId = parsePostId(url.searchParams.get('postId') ?? '0');
  try {
    await ensureDbSchema();
    const result = await getDb().execute({
      sql: `SELECT post_id, content_html, content_text, accent_color,
                   doodle_data_url, updated_at
              FROM blog_post_drafts
             WHERE username = ? AND post_id = ?
             LIMIT 1`,
      args: [auth.username, postId],
    });
    const row = result.rows?.[0] || null;
    if (!row) return json({ draft: null });
    return json({
      draft: {
        post_id: Number(row.post_id ?? 0),
        content_html: String(row.content_html || ''),
        content_text: String(row.content_text || ''),
        accent_color: String(row.accent_color || '#8dc5ff'),
        doodle_data_url: String(row.doodle_data_url || ''),
        updated_at: String(row.updated_at || ''),
      },
    });
  } catch (err) {
    console.error('posts/draft GET', err);
    return json({ error: 'Laden fehlgeschlagen' }, 500);
  }
}

export async function PUT({ request, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültiger JSON-Body' }, 400);
  }
  const postId = parsePostId(body?.postId ?? 0);
  const contentHtml = String(body?.contentHtml || '').slice(0, 80000);
  const contentText = String(body?.contentText || '').slice(0, 20000);
  const accentColor = normalizeColor(body?.accentColor);
  const doodleDataUrl = String(body?.doodleDataUrl || '');
  if (doodleDataUrl && !doodleDataUrl.startsWith('data:image/')) {
    return json({ error: 'Ungültige Kritzel-Daten' }, 400);
  }
  if (doodleDataUrl.length > 2_000_000) {
    return json({ error: 'Kritzelbild ist zu groß' }, 400);
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO blog_post_drafts
              (username, post_id, content_html, content_text, accent_color,
               doodle_data_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(username, post_id) DO UPDATE SET
              content_html = excluded.content_html,
              content_text = excluded.content_text,
              accent_color = excluded.accent_color,
              doodle_data_url = excluded.doodle_data_url,
              updated_at = excluded.updated_at`,
      args: [auth.username, postId, contentHtml, contentText, accentColor, doodleDataUrl],
    });
    return json({ success: true });
  } catch (err) {
    console.error('posts/draft PUT', err);
    return json({ error: 'Speichern fehlgeschlagen' }, 500);
  }
}

export async function DELETE({ url, cookies }) {
  const auth = await requireUser(cookies);
  if (auth.error) return auth.error;
  const postId = parsePostId(url.searchParams.get('postId') ?? '0');
  try {
    await ensureDbSchema();
    await getDb().execute({
      sql: `DELETE FROM blog_post_drafts WHERE username = ? AND post_id = ?`,
      args: [auth.username, postId],
    });
    return json({ success: true });
  } catch (err) {
    console.error('posts/draft DELETE', err);
    return json({ error: 'Loeschen fehlgeschlagen' }, 500);
  }
}
