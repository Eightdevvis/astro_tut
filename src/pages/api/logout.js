/**
 * API-Endpunkt: POST /api/logout
 * Löscht den Session-Cookie → User ist ausgeloggt.
 *
 * Warum reicht Cookie löschen?
 * → Der Server "vergisst" den Token nicht aktiv (wir haben keine Token-Blacklist),
 *   aber ohne Cookie schickt der Browser den Token nicht mehr mit.
 *   Für Demo-Zwecke ausreichend — in Produktion würde man zusätzlich eine
 *   Token-Blacklist oder kurze Ablaufzeiten nutzen.
 *
 * Wichtig: path (und bei HTTPS secure) müssen zum Setzen passen.
 */
import { getSessionCookieOptions } from '../../lib/session-cookie.js';

export async function POST({ cookies }) {
  const o = getSessionCookieOptions();
  cookies.delete('session', { path: o.path, secure: o.secure });
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
