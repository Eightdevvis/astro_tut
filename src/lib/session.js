import { jwtVerify } from 'jose';
import { getJwtSecretBytes } from './jwt-secret.js';
import { getDb, ensureDbSchema } from './db.js';

/**
 * Liest den eingeloggten Username aus dem Session-Cookie (JWT).
 * @param {import('astro').AstroCookies | import('astro').APIContext['cookies']} cookies
 */
export async function getUsernameFromCookies(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    return payload.username;
  } catch {
    return null;
  }
}

/**
 * Liest Session-Userprofil aus dem Session-Cookie (JWT) und ergaenzt den
 * Display-Namen aus der DB. Display-Name liegt nicht im JWT, damit eine
 * Namensaenderung sofort wirkt (ohne Re-Login).
 *
 * @param {import('astro').AstroCookies | import('astro').APIContext['cookies']} cookies
 * @returns {Promise<null | { username: string, displayName: string, birthday: string }>}
 */
export async function getSessionUserFromCookies(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '').trim();
    if (!username) return null;
    let displayName = username;
    try {
      await ensureDbSchema();
      const r = await getDb().execute({
        sql: 'SELECT display_name FROM users WHERE username = ? LIMIT 1',
        args: [username],
      });
      const dn = r.rows[0]?.display_name;
      if (typeof dn === 'string' && dn.trim()) displayName = dn;
    } catch {
      /* DB-Fehler ist nicht-fatal — username als Anzeige reicht. */
    }
    return {
      username,
      displayName,
      birthday: String(payload.birthday || ''),
    };
  } catch {
    return null;
  }
}
