import { jwtVerify } from 'jose';
import { getJwtSecretBytes } from './jwt-secret.js';

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
 * Liest minimales Session-Userprofil aus dem Session-Cookie (JWT).
 * @param {import('astro').AstroCookies | import('astro').APIContext['cookies']} cookies
 */
export async function getSessionUserFromCookies(cookies) {
  const token = cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecretBytes());
    const username = String(payload.username || '').trim();
    if (!username) return null;
    return {
      username,
      birthday: String(payload.birthday || ''),
    };
  } catch {
    return null;
  }
}
