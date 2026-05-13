/**
 * POST /api/graffiti/tile
 *
 * Single-Tile-Upload. Body (JSON):
 *   {
 *     pagePath:    "/some/path",
 *     tileX:       <int>,
 *     tileY:       <int>,
 *     baseVersion: <int>           // letzter dem Client bekannter Version-Counter
 *                                  //   0 = "Tile gibt es noch nicht"
 *     pngBase64:   "iVBORw0KG..."  // base64-PNG, exakt TILE_SIZE x TILE_SIZE, max MAX_TILE_BYTES
 *     strokeBounds:{ minX, minY, maxX, maxY }   // AABB des Strokes im Page-Koordinatensystem
 *   }
 *
 * Validierung in 3 Stufen:
 *   1) Format: PNG-Magic-Bytes, Dimension, Groesse
 *   2) Trust: tileX/tileY muss zu strokeBounds passen (mit Slack)
 *   3) Concurrency: baseVersion muss = aktueller DB-Version sein
 *
 * Response:
 *   200 { success: true, version: <int> } — Tile geschrieben, neuer Version-Counter
 *   400/413 { error: ... }                 — Format-/Trust-Fehler
 *   409 { error, currentVersion }          — Conflict, Client soll neu laden + erneut posten
 *   500 { error: ... }                     — Server-Fehler
 */
import { ensureDbSchema, getDb } from '../../../lib/db.js';
import {
  TILE_SIZE,
  MAX_TILE_BYTES,
  MAX_TILES_PER_PAGE,
  MAX_TILE_BYTES_PER_PAGE,
  base64ToBytes,
  looksLikePng,
  normalizePath,
  readPngDimensions,
  tileClaimMatchesBounds,
} from '../../../lib/graffiti-tiles.js';

// Helfer: integer-Parse mit klarer Failure-Mode (NaN bedeutet "nicht parsbar").
function asInt(value, fallback = NaN) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// Helfer: float-Parse fuer Bounding-Box-Coords.
function asFiniteNumber(value, fallback = NaN) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

// Helfer: einheitliches JSON-Error-Format.
function jsonError(status, message, extra = null) {
  const body = { error: message };
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Ungueltiger JSON-Body');
  }

  // --- Stufe 0: Pflichtfelder parsen ---
  const pagePath = normalizePath(body?.pagePath);
  const tileX = asInt(body?.tileX);
  const tileY = asInt(body?.tileY);
  const baseVersion = asInt(body?.baseVersion, 0);

  if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
    return jsonError(400, 'tileX/tileY erforderlich (integer)');
  }
  if (!Number.isFinite(baseVersion) || baseVersion < 0) {
    return jsonError(400, 'baseVersion ungueltig');
  }

  const sb = body?.strokeBounds || {};
  const minX = asFiniteNumber(sb.minX);
  const minY = asFiniteNumber(sb.minY);
  const maxX = asFiniteNumber(sb.maxX);
  const maxY = asFiniteNumber(sb.maxY);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) ||
      !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return jsonError(400, 'strokeBounds {minX,minY,maxX,maxY} erforderlich');
  }
  if (minX > maxX || minY > maxY) {
    return jsonError(400, 'strokeBounds invertiert');
  }

  // --- Stufe 1: Trust-Check ---
  // Verhindert dass jemand wahllos PNGs in beliebige Tile-Coords kippt.
  // Der Client behauptet "ich male Stroke X bis Y" — wir checken ob die behauptete
  // Tile-Coord ueberhaupt von dieser Region beruehrt werden KANN.
  if (!tileClaimMatchesBounds(tileX, tileY, minX, minY, maxX, maxY)) {
    return jsonError(400, 'Tile-Coords passen nicht zur Stroke-Region');
  }

  // --- Stufe 2: PNG-Format-Check ---
  const buf = base64ToBytes(body?.pngBase64);
  if (!buf) return jsonError(400, 'pngBase64 ungueltig oder leer');
  if (buf.length > MAX_TILE_BYTES) {
    return jsonError(413, `PNG zu gross (max ${MAX_TILE_BYTES} bytes, geliefert: ${buf.length})`);
  }
  if (!looksLikePng(buf)) {
    return jsonError(400, 'Daten sind kein PNG (Magic-Bytes fehlen)');
  }
  const dims = readPngDimensions(buf);
  if (!dims) return jsonError(400, 'PNG-Dimension nicht lesbar');
  if (dims.width !== TILE_SIZE || dims.height !== TILE_SIZE) {
    return jsonError(400, `PNG muss ${TILE_SIZE}x${TILE_SIZE} sein (geliefert: ${dims.width}x${dims.height})`);
  }

  // --- Stufe 3: Concurrency-Check + Persist ---
  try {
    await ensureDbSchema();
    const db = getDb();

    // Aktuelle Version lesen (oder 0 wenn der Tile noch nicht existiert).
    const cur = await db.execute({
      sql: `SELECT version FROM graffiti_tiles
            WHERE page_path = ? AND tile_x = ? AND tile_y = ?`,
      args: [pagePath, tileX, tileY],
    });
    const exists = (cur.rows || []).length > 0;
    const currentVersion = exists ? Number(cur.rows[0].version) : 0;

    if (currentVersion !== baseVersion) {
      // Optimistic-Concurrency-Conflict. Client soll Tile neu laden, Stroke ggf.
      // erneut auf das aktualisierte Tile applizieren und nochmal posten.
      return jsonError(409, 'Tile wurde von jemand anders aktualisiert', {
        currentVersion,
      });
    }

    if (exists) {
      await db.execute({
        sql: `UPDATE graffiti_tiles
              SET png_blob = ?, version = version + 1, updated_at = datetime('now')
              WHERE page_path = ? AND tile_x = ? AND tile_y = ?`,
        args: [buf, pagePath, tileX, tileY],
      });
    } else {
      // Anti-Spam-Guardrail: nur neue Tiles werden gegen das Page-Budget gechecked.
      // Editieren bestehender Tiles bleibt frei (sonst koennte der User sein eigenes
      // Werk nicht mehr ueberarbeiten).
      const budget = await db.execute({
        sql: `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(png_blob)), 0) AS bytes
              FROM graffiti_tiles
              WHERE page_path = ?`,
        args: [pagePath],
      });
      const usedTiles = Number(budget.rows?.[0]?.n || 0);
      const usedBytes = Number(budget.rows?.[0]?.bytes || 0);
      if (usedTiles >= MAX_TILES_PER_PAGE || usedBytes + buf.length > MAX_TILE_BYTES_PER_PAGE) {
        return jsonError(429, 'Seite ist voll — bitte erst Platz schaffen', {
          usedTiles,
          maxTiles: MAX_TILES_PER_PAGE,
          usedBytes,
          maxBytes: MAX_TILE_BYTES_PER_PAGE,
        });
      }
      try {
        await db.execute({
          sql: `INSERT INTO graffiti_tiles (page_path, tile_x, tile_y, png_blob, version, updated_at)
                VALUES (?, ?, ?, ?, 1, datetime('now'))`,
          args: [pagePath, tileX, tileY, buf],
        });
      } catch (insertErr) {
        // Race: zwischen unserem SELECT (kein Eintrag) und INSERT hat ein anderer
        // Client den Tile angelegt. PK-Constraint feuert -> als 409 zurueckspielen.
        const msg = insertErr?.message ?? String(insertErr);
        if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) {
          const recheck = await db.execute({
            sql: `SELECT version FROM graffiti_tiles
                  WHERE page_path = ? AND tile_x = ? AND tile_y = ?`,
            args: [pagePath, tileX, tileY],
          });
          const v = Number(recheck.rows?.[0]?.version || 1);
          return jsonError(409, 'Tile wurde von jemand anders zuerst angelegt', {
            currentVersion: v,
          });
        }
        throw insertErr;
      }
    }

    return new Response(JSON.stringify({ success: true, version: currentVersion + 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('POST /api/graffiti/tile', err);
    return jsonError(500, 'Tile speichern fehlgeschlagen');
  }
}
