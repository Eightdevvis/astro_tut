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
 * Wichtig: path: '/' muss identisch zum Setzen des Cookies sein,
 * sonst löscht cookies.delete() den falschen Cookie.
 */
export async function POST({ cookies }) {
  cookies.delete('session', { path: '/' });
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
