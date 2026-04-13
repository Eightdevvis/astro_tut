import { getDb, ensureDbSchema } from '../../lib/db.js';
import { hasPermission, SUPERUSER } from '../../lib/permissions.js';
import { getUsernameFromCookies } from '../../lib/session.js';

function decodeDataUrl(input) {
  const m = /^data:(image\/png|image\/jpeg|image\/webp);base64,(.+)$/i.exec(String(input || ''));
  if (!m) return null;
  try {
    const mime = m[1].toLowerCase();
    const data = Buffer.from(m[2], 'base64');
    if (!data || data.length === 0) return null;
    if (data.length > 3 * 1024 * 1024) return null;
    return { mime, data };
  } catch {
    return null;
  }
}

export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT id, username, page_url, comment, mime_type, created_at
      FROM tester_bug_reports
      ORDER BY created_at DESC, id DESC
      LIMIT 300
    `,
  });
  const reports = result.rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    pageUrl: String(row.page_url || ''),
    comment: String(row.comment || ''),
    mimeType: String(row.mime_type || 'image/png'),
    createdAt: String(row.created_at || ''),
    imageUrl: `/api/tester-bug-reports/${encodeURIComponent(String(row.id))}/image`,
  }));
  return new Response(JSON.stringify({ reports }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }
  const allowed = username === SUPERUSER || (await hasPermission(username, 'tester_access'));
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pageUrl = String(body?.pageUrl || '').slice(0, 500).trim();
  const comment = String(body?.comment || '').slice(0, 2000).trim();
  const decoded = decodeDataUrl(body?.screenshotDataUrl);
  if (!decoded) {
    return new Response(JSON.stringify({ error: 'Ungültiger Screenshot' }), { status: 400 });
  }
  if (!pageUrl) {
    return new Response(JSON.stringify({ error: 'Seiten-URL fehlt' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO tester_bug_reports (username, page_url, comment, screenshot, mime_type)
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [username, pageUrl, comment, decoded.data, decoded.mime],
  });

  return new Response(JSON.stringify({ success: true }), { status: 201 });
}
