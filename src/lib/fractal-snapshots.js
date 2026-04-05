/**
 * Validierung und Normalisierung von Fraktal-Snapshot-Payloads (API + Client).
 */

/** @typedef {{
 *   mode: 'mandelbrot' | 'julia',
 *   centerX: number,
 *   centerY: number,
 *   halfWidth: number,
 *   juliaRe: number,
 *   juliaIm: number,
 *   maxIter: number,
 *   hueOffset: number,
 *   saturation: number,
 *   cDrive: boolean,
 * }} FractalSnapshotSettings */

const MAX_HALF = 8;
const MIN_HALF = 1e-7;

/**
 * @param {unknown} body Roher JSON-Body (flach oder { settings: {...} })
 * @returns {{ ok: true, value: FractalSnapshotSettings } | { ok: false, error: string }}
 */
export function normalizeFractalSnapshot(body) {
  const o =
    body && typeof body === 'object' && body.settings && typeof body.settings === 'object'
      ? body.settings
      : body;
  if (!o || typeof o !== 'object') {
    return { ok: false, error: 'Erwarte JSON-Objekt oder { settings: { … } }' };
  }

  const mode = o.mode;
  if (mode !== 'mandelbrot' && mode !== 'julia') {
    return { ok: false, error: 'mode muss mandelbrot oder julia sein' };
  }

  const centerX = Number(o.centerX);
  const centerY = Number(o.centerY);
  const halfWidth = Number(o.halfWidth);
  const juliaRe = Number(o.juliaRe);
  const juliaIm = Number(o.juliaIm);
  const maxIter = Math.round(Number(o.maxIter));
  const hueOffset = Number(o.hueOffset);
  const saturation = Number(o.saturation);

  if (![centerX, centerY, halfWidth, juliaRe, juliaIm, hueOffset, saturation].every(Number.isFinite)) {
    return { ok: false, error: 'Ungültige Zahlenwerte' };
  }
  if (!Number.isFinite(maxIter) || maxIter < 32 || maxIter > 512) {
    return { ok: false, error: 'maxIter muss zwischen 32 und 512 liegen' };
  }
  if (halfWidth < MIN_HALF || halfWidth > MAX_HALF) {
    return { ok: false, error: 'halfWidth außerhalb des erlaubten Bereichs' };
  }
  if (hueOffset < 0 || hueOffset > 360) {
    return { ok: false, error: 'hueOffset muss 0–360 sein' };
  }
  if (saturation < 0 || saturation > 1) {
    return { ok: false, error: 'saturation muss 0–1 sein' };
  }

  const cDrive = Boolean(o.cDrive);

  return {
    ok: true,
    value: {
      mode,
      centerX,
      centerY,
      halfWidth,
      juliaRe,
      juliaIm,
      maxIter,
      hueOffset,
      saturation,
      cDrive,
    },
  };
}
