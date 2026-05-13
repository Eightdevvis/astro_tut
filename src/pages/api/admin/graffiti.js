import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { TILE_SIZE, bytesToBase64 } from '../../../lib/graffiti-tiles.js';

const MAX_PREVIEW_TILES = 16;

async function assertSuper(cookies) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller) return { ok: false, status: 401, error: 'Nicht eingeloggt' };
  if (!(await hasPermission(caller, 'super_access'))) {
    return { ok: false, status: 403, error: 'Keine Berechtigung' };
  }
  return { ok: true, caller };
}

export async function GET({ cookies, url }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  const limit = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') || 30)));
  try {
    await ensureDbSchema();
    const db = getDb();

    // Aggregat pro Page: Anzahl Tiles, Summe Bytes, letzter Update.
    const groups = await db.execute({
      sql: `SELECT page_path,
                   COUNT(*) AS tile_count,
                   COALESCE(SUM(LENGTH(png_blob)), 0) AS total_bytes,
                   MAX(updated_at) AS last_updated
            FROM graffiti_tiles
            GROUP BY page_path
            ORDER BY last_updated DESC
            LIMIT ?`,
      args: [limit],
    });

    const rows = [];
    for (const g of groups.rows || []) {
      const pagePath = String(g.page_path || '/');
      const tileCount = Number(g.tile_count || 0);
      const totalBytes = Number(g.total_bytes || 0);
      const lastUpdated = String(g.last_updated || '');

      // Bis zu MAX_PREVIEW_TILES Tiles fuer die Composite-Vorschau. Sortiert
      // nach (y, x), damit das Composite stabil aussieht.
      const tilesRes = await db.execute({
        sql: `SELECT tile_x, tile_y, png_blob
              FROM graffiti_tiles
              WHERE page_path = ?
              ORDER BY tile_y ASC, tile_x ASC
              LIMIT ?`,
        args: [pagePath, MAX_PREVIEW_TILES],
      });
      const previewTiles = (tilesRes.rows || []).map((t) => ({
        x: Number(t.tile_x),
        y: Number(t.tile_y),
        pngBase64: bytesToBase64(t.png_blob),
      }));

      rows.push({
        pagePath,
        tileCount,
        totalBytes,
        lastUpdated,
        previewTiles,
        previewTruncated: tileCount > previewTiles.length,
      });
    }

    return new Response(
      JSON.stringify({ success: true, tileSize: TILE_SIZE, rows }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    console.error('GET /api/admin/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti-Liste fehlgeschlagen' }), { status: 500 });
  }
}

export async function POST({ cookies, request }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), { status: 400 });
  }
  const pagePath = typeof body?.pagePath === 'string' ? body.pagePath : '';
  if (!pagePath || !pagePath.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'pagePath erforderlich' }), { status: 400 });
  }
  try {
    await ensureDbSchema();
    const db = getDb();
    const res = await db.execute({
      sql: 'DELETE FROM graffiti_tiles WHERE page_path = ?',
      args: [pagePath],
    });
    return new Response(
      JSON.stringify({ success: true, deleted: Number(res.rowsAffected ?? 0) }),
      { status: 200 }
    );
  } catch (err) {
    console.error('POST /api/admin/graffiti', err);
    return new Response(JSON.stringify({ error: 'Graffiti-Löschen fehlgeschlagen' }), { status: 500 });
  }
}
