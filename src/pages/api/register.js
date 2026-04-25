import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';
import { getSessionCookieOptions } from '../../lib/session-cookie.js';
import { getPermissions } from '../../lib/permissions.js';
import { getTesterUiPreference } from '../../lib/tester-ui-preference.js';

export async function POST({ request, cookies }) {
  const { username, birthday, password } = await request.json();

  if (!username || !birthday || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();

  const exists = await db.execute({
    sql: 'SELECT id FROM users WHERE username = ?',
    args: [username]
  });
  if (exists.rows.length > 0) {
    return new Response(JSON.stringify({ error: 'Username existiert schon' }), { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: 'INSERT INTO users (username, birthday, password, "global") VALUES (?, ?, ?, 0)',
    args: [username, birthday, hash]
  });

  const token = await new SignJWT({ username, birthday })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getJwtSecretBytes());

  cookies.set('session', token, getSessionCookieOptions());
  const permissions = await getPermissions(username);
  const isSuperuser = permissions.includes('super_access');
  const isTester = isSuperuser || permissions.includes('tester_access');
  const testerUiEnabled = isTester ? await getTesterUiPreference(username) : false;

  return new Response(
    JSON.stringify({
      success: true,
      user: {
        username,
        birthday,
        isSuperuser,
        permissions,
        isTester,
        canUseRpg: isSuperuser || permissions.includes('rpg_access'),
        canUseMinigames: isSuperuser || permissions.includes('minigames_access'),
        testerUiEnabled,
      },
    }),
    { status: 201 }
  );
}
