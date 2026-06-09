/**
 * Nachvollziehbare API-Fehler-Antworten.
 *
 * Jeder Fehler bekommt einen stabilen `code` (Branch-Identifikator wie
 * `add:db_insert_failed`). Der Client zeigt ihn an — ein Fehlerbericht
 * ("ich kriege add:db_insert_failed") zeigt damit sofort auf die Stelle im
 * Code, statt nur "Speichern fehlgeschlagen".
 *
 * 500er bekommen zusaetzlich eine kurze `ref`, die identisch im Server-Log
 * (`console.error`) auftaucht — so laesst sich eine konkrete Fehlinstanz im
 * Log wiederfinden (z. B. Vercel-Functions-Logs).
 */

let __seq = 0;

/** Kurze, gut vorlesbare Referenz. Kein Krypto — nur zum Korrelieren. */
export function errorRef() {
  __seq = (__seq + 1) % 0x100;
  const t = Date.now().toString(36).slice(-4);
  const r = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${t}${r}`;
}

/** JSON-Fehlerantwort mit `code` (+ optional `ref`). */
export function apiError(message, code, status = 400, extra = {}) {
  return new Response(JSON.stringify({ error: message, code, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Wrapper fuer 500er: loggt den echten Fehler mit `ref` + `code` und gibt
 * eine getraced JSON-Antwort zurueck, die NUR die Referenz nach aussen
 * gibt (keine internen Details).
 */
export function serverError(message, code, err, status = 500) {
  const ref = errorRef();
  console.error(`[${code}][ref:${ref}]`, err);
  return apiError(message, code, status, { ref });
}
