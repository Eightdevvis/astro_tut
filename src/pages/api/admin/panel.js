import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getPermissions, KNOWN_PERMISSIONS, hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { buildFontCatalog, getCustomFontFacesCss } from '../../../lib/font-catalog.js';
import { getAllSiteFontSettings } from '../../../lib/site-font-settings.js';
import { getTesterUiPreference } from '../../../lib/tester-ui-preference.js';

export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || !(await hasPermission(caller, 'super_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  await ensureDbSchema();
  const db = getDb();
  const usersResult = await db.execute({
    sql: 'SELECT username, birthday, COALESCE("global", 0) AS global_flag FROM users ORDER BY username ASC',
  });

  const users = [];
  for (const row of usersResult.rows) {
    users.push({
      username: row.username,
      birthday: row.birthday,
      global: Boolean(row.global_flag),
      permissions: await getPermissions(row.username),
    });
  }
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

  const fonts = await getAllSiteFontSettings();
  const fontCatalog = await buildFontCatalog();
  const fontPreviewCss = await getCustomFontFacesCss();
  const testerUiEnabled = await getTesterUiPreference(caller);
  return new Response(
    JSON.stringify({
      users,
      knownPermissions: KNOWN_PERMISSIONS,
      fonts,
      fontCatalog,
      fontPreviewCss,
      testerBugReports,
      testerUiEnabled,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
