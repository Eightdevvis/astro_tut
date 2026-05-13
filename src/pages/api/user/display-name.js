import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { getUsernameFromCookies } from '../../../lib/session.js';

const MAX_DISPLAY_LEN = 40;

/**
 * PUT /api/user/display-name
 * Body: { displayName: string }
 *
 * Setzt den frei waehlbaren Anzeigenamen des eingeloggten Users.
 * Die Login-ID (users.username) bleibt unveraendert. Display-Name darf sich
 * mit anderen Usern ueberschneiden — er ist reine Anzeige.
 */
export async function PUT({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.displayName === 'string' ? body.displayName : '';
  const trimmed = raw.trim();
  if (!trimmed) {
    return new Response(JSON.stringify({ error: 'Name darf nicht leer sein' }), { status: 400 });
  }
  if (trimmed.length > MAX_DISPLAY_LEN) {
    return new Response(
      JSON.stringify({ error: `Name max. ${MAX_DISPLAY_LEN} Zeichen` }),
      { status: 400 }
    );
  }

  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: 'UPDATE users SET display_name = ? WHERE username = ?',
    args: [trimmed, username],
  });

  return new Response(
    JSON.stringify({ success: true, displayName: trimmed }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
