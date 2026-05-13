/**
 * GET /api/site-items/active
 *
 * Public-Endpoint. Liefert alle enabled=1 Items als schmale Public-Form
 * (kein sort_order/created_at/enabled). Filter optional:
 *   ?kind=graffiti           — nur eine Kategorie
 *   ?kind=graffiti,pen       — Komma-Liste
 *   ?behavior=draw           — analog für behavior
 *
 * Reihenfolge: sort_order ASC, id ASC (Admin-konfigurierbar via sortOrder).
 */
import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { normalizeDbRow, toPublic } from '../../../lib/site-items.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseCsvFilter(value) {
  if (!value) return null;
  const parts = String(value)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export async function GET({ url }) {
  const kindFilter = parseCsvFilter(url.searchParams.get('kind'));
  const behaviorFilter = parseCsvFilter(url.searchParams.get('behavior'));

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, kind, variant, name, description, behavior, config_json,
                   enabled, sort_order, created_at
            FROM site_item_catalog
            WHERE enabled = 1
            ORDER BY sort_order ASC, id ASC`,
      args: [],
    });
    const all = (result.rows || []).map(normalizeDbRow);
    const filtered = all.filter((it) => {
      if (kindFilter && !kindFilter.includes(it.kind)) return false;
      if (behaviorFilter && !behaviorFilter.includes(it.behavior)) return false;
      return true;
    });
    return json({ items: filtered.map(toPublic) });
  } catch (err) {
    console.error('GET /api/site-items/active', err);
    return json({ error: 'Items laden fehlgeschlagen' }, 500);
  }
}
