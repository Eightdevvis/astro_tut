import { sqlite3 } from 'sqlite3';
import { open } from 'sqlite';

/**
 * API-Endpunkt: /api/user
 * Gibt den eingeloggten User zurück (Demo: ohne echte Session)
 * Antwort: { user: { ... } } oder { error: ... }
 */

export async function GET({ request }) {
  // TODO: Session aus Cookie/JWT auslesen
  // Demo: Kein echter Session-Check
  return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), { status: 401 });
}

/**
 * Stolperstellen:
 * - Session-Handling muss noch gebaut werden
 * - Demo gibt immer Fehler zurück
 */
