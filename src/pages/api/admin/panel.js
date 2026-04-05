import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getPermissions, KNOWN_PERMISSIONS, SUPERUSER } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { getAllSiteFontSettings } from '../../../lib/site-font-settings.js';

export async function GET({ cookies }) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller || caller !== SUPERUSER) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), { status: 403 });
  }

  await ensureDbSchema();
  const db = getDb();
  const usersResult = await db.execute({
    sql: 'SELECT username, birthday FROM users ORDER BY username ASC',
  });

  const users = [];
  for (const row of usersResult.rows) {
    users.push({
      username: row.username,
      birthday: row.birthday,
      permissions: await getPermissions(row.username),
    });
  }

  const fonts = await getAllSiteFontSettings();
  return new Response(
    JSON.stringify({
      users,
      knownPermissions: KNOWN_PERMISSIONS,
      fonts,
      superuser: SUPERUSER,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
