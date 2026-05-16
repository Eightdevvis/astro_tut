/**
 * Erzeugt einen nicht-ratbaren Slug fuer oeffentliche Post-URLs (B13).
 *
 * 12 Hex-Zeichen aus `crypto.randomUUID()` = 48 Bit Entropie. Damit ist
 * eine zufaellige Kollision oder gar systematisches Raten zwischen den
 * Posts dieser Seite ausgeschlossen — wir nutzen das vor allem fuer
 * `unlisted` Posts (URL muss bekannt sein, aber nicht hochzaehlbar).
 *
 * Single-Source-of-Truth fuer Slug-Format. Wenn sich Laenge/Alphabet
 * je aendert, hier zentral umstellen.
 */
export function makePublicSlug() {
  const uuid = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(16) + Math.random().toString(16).slice(2);
  return uuid.replace(/-/g, '').slice(0, 12).toLowerCase();
}

export function isValidPublicSlug(value) {
  return typeof value === 'string' && /^[0-9a-f]{12}$/.test(value);
}

const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private', 'password']);

export function normalizeVisibility(value) {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_VISIBILITIES.has(v) ? v : 'public';
}

export function isListableVisibility(value) {
  return normalizeVisibility(value) === 'public';
}
