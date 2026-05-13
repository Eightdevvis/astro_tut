/**
 * GET /api/site-placed-items?page=<path>
 *
 * Liefert alle Items die aktuell auf einer Seite liegen, mit eingebetteten
 * Catalog-Daten (kind, behavior, config). Reihenfolge: id ASC, damit später
 * platzierte Items oben liegen (das frontend zeichnet in dieser Reihenfolge).
 *
 * Public — anonyme User dürfen die Items SEHEN. Pickup ist getrennt über
 * /api/site-inventory/me und braucht einen Login.
 */
import { ensureDbSchema, getDb } from '../../lib/db.js';
import { fetchCatalogMap, normalizePagePath } from '../../lib/site-inventory.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET({ url }) {
  const pagePath = normalizePagePath(url.searchParams.get('page'));
  try {
    await ensureDbSchema();
    const db = getDb();
    const res = await db.execute({
      sql: `SELECT id, item_id, x, y, placed_by, placed_at
            FROM site_placed_items
            WHERE page_path = ?
            ORDER BY id ASC`,
      args: [pagePath],
    });
    const rows = res.rows || [];
    const catalog = await fetchCatalogMap(db, rows.map((r) => String(r.item_id)));
    const items = rows
      .map((r) => {
        const cat = catalog.get(String(r.item_id));
        if (!cat || !cat.enabled) return null;
        return {
          placedItemId: Number(r.id),
          x: Number(r.x),
          y: Number(r.y),
          placedBy: String(r.placed_by || ''),
          placedAt: String(r.placed_at || ''),
          item: cat,
        };
      })
      .filter(Boolean);
    return json({ pagePath, items });
  } catch (err) {
    console.error('GET /api/site-placed-items', err);
    return json({ error: 'Items laden fehlgeschlagen' }, 500);
  }
}
