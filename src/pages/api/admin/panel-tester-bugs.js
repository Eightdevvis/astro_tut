import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

/** Lazy-Sub-Endpoint fuer den Tester-Bugs-Tab. */
export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  await ensureDbSchema();
  const db = getDb();
  const bugReportsResult = await db.execute({
    sql: `
      SELECT id, username, page_url, comment, mime_type, created_at
      FROM tester_bug_reports
      ORDER BY created_at DESC, id DESC
      LIMIT 300
    `,
  });
  const testerBugReports = bugReportsResult.rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    pageUrl: String(row.page_url || ''),
    comment: String(row.comment || ''),
    mimeType: String(row.mime_type || 'image/png'),
    createdAt: String(row.created_at || ''),
    imageUrl: `/api/tester-bug-reports/${encodeURIComponent(String(row.id))}/image`,
  }));

  return new Response(
    JSON.stringify({ testerBugReports }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
