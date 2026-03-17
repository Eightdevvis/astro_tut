/**
 * API-Endpunkt: /api/logout
 * Loggt den User aus, löscht Session-Cookie (Demo)
 * Antwort: { success: true }
 */

export async function POST() {
  // TODO: Session-Cookie/JWT löschen
  // Demo: Keine echte Session
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}

/**
 * Stolperstellen:
 * - Session-Handling muss noch gebaut werden
 * - Demo löscht keine echte Session
 */
