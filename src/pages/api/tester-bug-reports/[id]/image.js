import { getDb, ensureDbSchema } from '../../../../lib/db.js';
import { SUPERUSER } from '../../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../../lib/session.js';

export async function GET({ params, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return new Response('Keine Berechtigung', { status: 403 });
  }

  const id = Number.parseInt(String(params.id || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response('Ungültige ID', { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT screenshot, mime_type FROM tester_bug_reports WHERE id = ? LIMIT 1',
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return new Response('Nicht gefunden', { status: 404 });

  const contentType = String(row.mime_type || 'image/png');
  let buf = row.screenshot;
  if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) buf = new Uint8Array(buf);
  else if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
