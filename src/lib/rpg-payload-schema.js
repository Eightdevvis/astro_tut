/**
 * Schema-Version des gespeicherten RPG-Payloads (`rpg_user_state.payload`).
 * Bei inkompatiblen Strukturänderungen hochzählen und Migration im API-Lesen/Speichern ergänzen.
 */
export const RPG_PAYLOAD_SCHEMA_VERSION = 1;

/**
 * @param {unknown} v
 * @returns {number}
 */
export function coerceRpgPayloadSchemaVersion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 999999);
}
