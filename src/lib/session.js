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
