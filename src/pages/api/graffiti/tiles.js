/**
 * GET /api/graffiti/tiles?page=<path>
 *
 * Liefert alle gespeicherten Tiles fuer eine Page als JSON-Liste.
 * Jeder Tile enthaelt seine (tile_x, tile_y)-Coords im Page-Grid, die aktuelle
 * Versions-Nummer (fuer optimistic concurrency beim Upload) und das PNG als base64.
 *
 * Response-Form:
 *   { success: true, tileSize: 512, tiles: [{ x, y, version, pngBase64, updatedAt }, ...] }
 *
 * Eine leere Liste ist valide ("Page wurde noch nie bemalt"). Kein 404.
 */
import { ensureDbSchema, getDb } from '../../../lib/db.js';
import { TILE_SIZE, bytesToBase64, normalizePath } from '../../../lib/graffiti-tiles.js';

export async function GET({ url }) {
  const pagePath = normalizePath(url.searchParams.get('page'));
  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT tile_x, tile_y, version, png_blob, updated_at
            FROM graffiti_tiles
            WHERE page_path = ?
            ORDER BY tile_y ASC, tile_x ASC`,
      args: [pagePath],
    });
    const tiles = (result.rows || []).map((row) => ({
      x: Number(row.tile_x),
      y: Number(row.tile_y),
      version: Number(row.version),
      pngBase64: bytesToBase64(row.png_blob),
      updatedAt: String(row.updated_at || ''),
    }));
    return new Response(JSON.stringify({ success: true, tileSize: TILE_SIZE, tiles }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('GET /api/graffiti/tiles', err);
    return new Response(JSON.stringify({ error: 'Tiles laden fehlgeschlagen' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
