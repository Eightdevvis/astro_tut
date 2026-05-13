import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { getDb, ensureDbSchema } from '../../lib/db.js';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';
import { getSessionCookieOptions } from '../../lib/session-cookie.js';
import { getPermissions } from '../../lib/permissions.js';
import { getTesterUiPreference } from '../../lib/tester-ui-preference.js';
import {
  validateUserIdShape,
  isUserIdFree,
  findFreeUserId,
  slugifyForUserId,
} from '../../lib/user-id.js';

/**
 * POST /api/register
 *
 * Body: { name, loginId?, birthday, password }
 *  - `name`: Wunsch-Anzeigename (display_name). Pflicht.
 *  - `loginId`: optional vom User gewaehlte Login-ID. Wenn leer wird sie aus
 *    name abgeleitet (slugify + Suffix bei Konflikt).
 *  - `birthday`, `password`: wie gehabt.
 */
export async function POST({ request, cookies }) {
  const { name, loginId, birthday, password } = await request.json();

  const displayName = String(name ?? '').trim();
  if (!displayName) {
    return new Response(JSON.stringify({ error: 'Name fehlt' }), { status: 400 });
  }
  if (!birthday || !password) {
    return new Response(JSON.stringify({ error: 'Geburtstag und Passwort sind Pflicht' }), { status: 400 });
  }

  await ensureDbSchema();
  const db = getDb();

  let username;
  if (loginId && String(loginId).trim()) {
    const candidate = String(loginId).trim().toLowerCase();
    const shapeError = validateUserIdShape(candidate);
    if (shapeError) {
      return new Response(JSON.stringify({ error: shapeError }), { status: 400 });
    }
    if (!(await isUserIdFree(candidate))) {
      return new Response(
        JSON.stringify({ error: 'Login-ID schon vergeben', suggestion: await findFreeUserId(candidate) }),
        { status: 409 }
      );
    }
    username = candidate;
  } else {
    username = await findFreeUserId(slugifyForUserId(displayName));
  }

  const hash = await bcrypt.hash(password, 10);
  await db.execute({
    sql: 'INSERT INTO users (username, display_name, birthday, password) VALUES (?, ?, ?, ?)',
    args: [username, displayName, birthday, hash],
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
        displayName,
        birthday,
        isSuperuser,
        permissions,
        isTester,
        canUseRpg: isSuperuser || permissions.includes('rpg_access'),
        canUseMinigames: isSuperuser,
        testerUiEnabled,
      },
    }),
    { status: 201 }
  );
}
