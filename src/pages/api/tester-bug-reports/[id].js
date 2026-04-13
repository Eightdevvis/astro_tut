import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

async function removeReport(params, cookies) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  const id = Number.parseInt(String(params.id || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();
  const existing = await db.execute({
    sql: 'SELECT id FROM tester_bug_reports WHERE id = ? LIMIT 1',
    args: [id],
  });
  if (!existing.rows[0]) {
    return new Response(JSON.stringify({ error: 'Nicht gefunden' }), { status: 404 });
  }

  await db.execute({
    sql: 'DELETE FROM tester_bug_reports WHERE id = ?',
    args: [id],
  });
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE({ params, cookies }) {
  return removeReport(params, cookies);
}

// Fallback for environments where DELETE is filtered.
export async function POST({ params, cookies }) {
  return removeReport(params, cookies);
}
