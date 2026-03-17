import { jwtVerify } from 'jose';

/**
 * Dasselbe Secret wie in login.js/register.js — Tokens können nur verifiziert werden
 * wenn das Secret identisch ist.
 */
const JWT_SECRET = new TextEncoder().encode(import.meta.env.JWT_SECRET);

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
    const { payload } = await jwtVerify(token, JWT_SECRET);

    return new Response(
      JSON.stringify({ user: { username: payload.username, birthday: payload.birthday } }),
      { status: 200 }
    );
  } catch {
    // Mögliche Fehler: Token manipuliert, abgelaufen, falsches Secret
    return new Response(JSON.stringify({ error: 'Session ungültig' }), { status: 401 });
  }
}
