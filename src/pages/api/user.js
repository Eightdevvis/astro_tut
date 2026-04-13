import { jwtVerify } from 'jose';
import { getJwtSecretBytes } from '../../lib/jwt-secret.js';
import { getPermissions, SUPERUSER } from '../../lib/permissions.js';
import { getTesterUiPreference } from '../../lib/tester-ui-preference.js';

/**
 * API-Endpunkt: GET /api/user
 * Liest den Session-Cookie aus, verifiziert den JWT und gibt den User zurück.
 *
 * Warum JWT statt DB-Lookup?
 * → Der JWT enthält die User-Daten signiert. Wir können die Signatur prüfen
 *   ohne nochmal in die DB zu gehen. Wenn der JWT gültig und nicht abgelaufen ist,
 *   vertrauen wir dem Payload.
 *
 * Wird vom LoginWidget beim Laden der Seite aufgerufen um die Session wiederherzustellen.
 */
export async function GET({ cookies }) {
  // Cookie auslesen — gibt undefined zurück wenn nicht vorhanden
  const token = cookies.get('session')?.value;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
  }

  try {
    // jwtVerify prüft gleichzeitig:
    // 1. Signatur korrekt? (Secret stimmt)
    // 2. Token abgelaufen? (exp claim)
    // Wenn beides ok → payload enthält unsere Daten (username, birthday)
    const { payload } = await jwtVerify(token, getJwtSecretBytes());

    const username = String(payload.username || '');
    const permissions = await getPermissions(username);
    const isSuperuser = username === SUPERUSER;
    const isTester = isSuperuser || permissions.includes('tester_access');
    const testerUiEnabled = isTester ? await getTesterUiPreference(username) : false;
    return new Response(
      JSON.stringify({
        user: {
          username,
          birthday: payload.birthday,
          isSuperuser,
          permissions,
          isTester,
          canUseRpg: isSuperuser || permissions.includes('rpg_access'),
          testerUiEnabled,
        },
      }),
      { status: 200 }
    );
  } catch {
    // Mögliche Fehler: Token manipuliert, abgelaufen, falsches Secret
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }
}
