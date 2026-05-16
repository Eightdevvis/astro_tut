import { jwtVerify } from 'jose';
import { hasPermission } from '../../../lib/permissions.js';
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getJwtSecretBytes } from '../../../lib/jwt-secret.js';

function normalizeColor(v) {
  const value = String(v || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return '#8dc5ff';
  return value.toLowerCase();
}

export async function POST({ request, cookies }) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }

  const contentHtml = String(body?.contentHtml || '').trim();
  const contentText = String(body?.contentText || '').trim();
  const accentColor = normalizeColor(body?.accentColor);
  const doodleDataUrl = String(body?.doodleDataUrl || '').trim();

  if (!contentText) {
    return new Response(JSON.stringify({ error: 'Inhalt darf nicht leer sein' }), { status: 400 });
  }
  if (contentText.length > 10000 || contentHtml.length > 40000) {
    return new Response(JSON.stringify({ error: 'Post ist zu lang' }), { status: 400 });
  }
  if (doodleDataUrl && !doodleDataUrl.startsWith('data:image/')) {
    return new Response(JSON.stringify({ error: 'Ungültige Kritzel-Daten' }), { status: 400 });
  }
  if (doodleDataUrl.length > 2_000_000) {
    return new Response(JSON.stringify({ error: 'Kritzelbild ist zu groß' }), { status: 400 });
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `INSERT INTO blog_posts (username, content_html, content_text, accent_color, doodle_data_url)
            VALUES (?, ?, ?, ?, ?)`,
      args: [username, contentHtml, contentText, accentColor, doodleDataUrl],
    });
    const id = result.lastInsertRowid == null ? null : String(result.lastInsertRowid);
    // A2-Cleanup: der "neuer Post"-Draft-Slot (post_id = 0) ist nach
    // erfolgreichem Erst-Post obsolet.
    try {
      await db.execute({
        sql: `DELETE FROM blog_post_drafts WHERE username = ? AND post_id = 0`,
        args: [username],
      });
    } catch (cleanupErr) {
      console.warn('posts/add: draft cleanup', cleanupErr);
    }
    return new Response(JSON.stringify({ success: true, id }), { status: 201 });
  } catch (err) {
    console.error('posts/add', err);
    return new Response(JSON.stringify({ error: 'Speichern fehlgeschlagen' }), { status: 500 });
  }
}
