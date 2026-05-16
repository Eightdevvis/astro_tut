/**
 * B20 — Rate-Limit pro IP-Hash auf Detail-Routen.
 *
 * Daten-Quelle: `request_log` (wird bei jedem oeffentlichen Detail-
 * Request geschrieben). Wir zaehlen die Zeilen pro `ip_hash` im
 * Sliding-Window und blocken, wenn die Schwelle erreicht ist.
 *
 * Schwellen-Werte (max/Fenster) sind absichtlich konservativ und nicht
 * oeffentlich dokumentiert — exakte Tuning-Werte gehoeren laut Plan in
 * `memory/security-sensitive.md` (gitignored). Defaults hier sind ein
 * sicherer Startpunkt, der einen Browser-Leser nicht stoert.
 */

import { ensureDbSchema, getDb } from './db.js';

const DEFAULT_MAX_PER_MINUTE = 60;
const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Prueft, ob eine weitere Request zugelassen werden darf.
 * Liefert { allowed: boolean, count: number, limit: number }.
 *
 * Bei DB-Fehlern: erlauben (Logging darf den User nicht killen — Privacy
 * ist wichtiger als ein perfekt-zaehlendes Limit).
 */
export async function checkRateLimit({ ipHash, max = DEFAULT_MAX_PER_MINUTE, windowSeconds = DEFAULT_WINDOW_SECONDS }) {
  if (!ipHash) return { allowed: true, count: 0, limit: max };
  try {
    await ensureDbSchema();
    const r = await getDb().execute({
      sql: `SELECT COUNT(*) AS c FROM request_log
             WHERE ip_hash = ?
               AND datetime(ts) > datetime('now', ?)`,
      args: [ipHash, `-${Math.max(1, Number(windowSeconds))} seconds`],
    });
    const count = Number(r.rows?.[0]?.c ?? 0);
    return { allowed: count < max, count, limit: max };
  } catch (err) {
    console.warn('[rate-limit] check failed', err?.message || err);
    return { allowed: true, count: 0, limit: max };
  }
}
