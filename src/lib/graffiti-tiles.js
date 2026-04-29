/**
 * src/lib/graffiti-tiles.js
 * Gemeinsame Helfer und Konstanten fuer das Tile-basierte Graffiti-System.
 *
 * Architektur (Phase 2):
 *  - Pro Page wird der Canvas in TILE_SIZE x TILE_SIZE CSS-Pixel-Kacheln unterteilt.
 *  - Jede Kachel ist ein eigenstaendiges PNG in der DB (graffiti_tiles).
 *  - Client rendert die betroffenen Kacheln lokal und uploadet sie als base64-PNG.
 *  - Server validiert Format/Groesse/Coords, increment-version, last-write-wins (mit
 *    optimistic-concurrency-Check ueber `version`).
 */

/** Kantenlaenge eines Tiles in CSS-Pixeln. 512 ist der pragmatische Default
 *  (gemaess Web-Whiteboard-Konvention). Aenderungen brechen alle bestehenden Tiles
 *  in der DB — Migration erforderlich. */
export const TILE_SIZE = 512;

/** Maximale erlaubte PNG-Bytegroesse pro Tile (200 KB).
 *  Schuetzt vor "Bombe-Uploads" mit grossen Bildern. */
export const MAX_TILE_BYTES = 200 * 1024;

/** Normalisiert ein page_path-Param. Verhindert dass jemand absolute URLs
 *  oder Pfade ohne Slash unterjubelt. */
export function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  return raw.slice(0, 250);
}

/** Konvertiert einen BLOB-Wert aus libsql in einen base64-String fuer JSON-Transport. */
export function bytesToBase64(bytes) {
  if (!bytes) return '';
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.toString('base64');
}

/** Konvertiert einen base64-String in ein Buffer/Uint8Array fuer DB-Inserts.
 *  Wirft NICHT bei ungueltigem Input — gibt null zurueck, damit der Caller
 *  einen ordentlichen 400er liefern kann. */
export function base64ToBytes(value) {
  if (typeof value !== 'string' || !value) return null;
  // Optionaler data:-URL-Prefix entfernen (z.B. wenn der Client toDataURL geschickt hat)
  const stripped = value.startsWith('data:') ? value.split(',', 2)[1] || '' : value;
  try {
    const buf = Buffer.from(stripped, 'base64');
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

/** Prueft ob ein Buffer mit den PNG-Magic-Bytes (\x89 P N G \r \n \x1a \n) anfaengt.
 *  Verhindert dass jemand andere Formate (oder Junk) als PNG hochjubelt. */
export function looksLikePng(buf) {
  if (!buf || buf.length < 8) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/** Liest die Bilddimension aus dem PNG-Header (IHDR-Chunk, Bytes 16-23).
 *  Ein PNG faengt mit 8 Byte Magic + 4 Byte IHDR-Length + 4 Byte "IHDR" + 4 Byte width
 *  + 4 Byte height an. Kein Image-Decode noetig.
 *  @returns {{ width: number, height: number } | null} */
export function readPngDimensions(buf) {
  if (!looksLikePng(buf) || buf.length < 24) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

/** Berechnet welche Tile-Koordinaten von einer Bounding-Box im Page-Koordinatensystem
 *  beruehrt werden. Gibt eine Liste {x, y} zurueck. Die Liste kann leer sein wenn
 *  die Box komplett im Negativen liegt.
 *
 *  Wird sowohl Client (zur Bestimmung welche Tiles neu gerendert werden muessen)
 *  als auch Server (zur Validierung dass der hochgeladene Tile zur behaupteten
 *  Stroke-Region passt) aufgerufen. */
export function tilesCoveringBounds(minX, minY, maxX, maxY) {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return [];
  }
  const txMin = Math.floor(minX / TILE_SIZE);
  const tyMin = Math.floor(minY / TILE_SIZE);
  const txMax = Math.floor(maxX / TILE_SIZE);
  const tyMax = Math.floor(maxY / TILE_SIZE);
  const tiles = [];
  for (let ty = tyMin; ty <= tyMax; ty += 1) {
    for (let tx = txMin; tx <= txMax; tx += 1) {
      // Negative Tile-Coords zulassen (z.B. Striche knapp ueber Page-Anfang)
      tiles.push({ x: tx, y: ty });
    }
  }
  return tiles;
}

/** Server-Validation: liegt das behauptete Tile (tx, ty) tatsaechlich in dem
 *  Bounding-Box-Bereich den der Client meldet? Plus etwas Slack fuer den
 *  Erase-Radius / Antialiasing-Rand.
 *
 *  Slack-Logik: Ein Stroke-Punkt malt nicht nur EINEN Pixel, sondern einen
 *  Pinsel-Radius drumrum. Wenn der Client also einen Stroke-Bound von 100..200
 *  meldet, kann das tatsaechliche Bemalte bis 100-RADIUS .. 200+RADIUS reichen.
 *  Wir nehmen einen grosszuegigen Slack damit Schwamm-Updates auch validiert werden. */
const TILE_CLAIM_SLACK = 64;

export function tileClaimMatchesBounds(tileX, tileY, minX, minY, maxX, maxY) {
  if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) return false;
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return false;
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) return false;
  const tileLeft = tileX * TILE_SIZE - TILE_CLAIM_SLACK;
  const tileTop = tileY * TILE_SIZE - TILE_CLAIM_SLACK;
  const tileRight = (tileX + 1) * TILE_SIZE + TILE_CLAIM_SLACK;
  const tileBottom = (tileY + 1) * TILE_SIZE + TILE_CLAIM_SLACK;
  // Standard AABB-Overlap-Test: kein Overlap = mindestens eine Achse disjunkt.
  if (maxX < tileLeft || minX > tileRight) return false;
  if (maxY < tileTop || minY > tileBottom) return false;
  return true;
}
