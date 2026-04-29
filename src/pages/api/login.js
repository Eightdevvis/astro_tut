import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';
import { getSessionCookieOptions } from '../../lib/session-cookie.js';
import { getPermissions } from '../../lib/permissions.js';
import { getTesterUiPreference } from '../../lib/tester-ui-preference.js';

export async function POST({ request, cookies }) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Alle Felder ausfüllen' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE username = ?',
    args: [username]
  });
  const user = result.rows[0];

  if (!user) {
    return new Response(JSON.stringify({ error: 'User nicht gefunden' }), { status: 404 });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 });
  }

  const token = await new SignJWT({ username: user.username, birthday: user.birthday })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getJwtSecretBytes());

  cookies.set('session', token, getSessionCookieOptions());

  const un = user.username;
  const permissions = await getPermissions(un);
  const isSuperuser = permissions.includes('super_access');
  const isTester = isSuperuser || permissions.includes('tester_access');
  const testerUiEnabled = isTester ? await getTesterUiPreference(un) : false;
  return new Response(
    JSON.stringify({
      success: true,
      user: {
        username: un,
        birthday: user.birthday,
        isSuperuser,
        permissions,
        isTester,
        canUseRpg: isSuperuser || permissions.includes('rpg_access'),
        // Minigames vorerst nur Superuser (Architektur-Umbau).
        canUseMinigames: isSuperuser,
        testerUiEnabled,
      },
    }),
    { status: 200 }
  );
}
