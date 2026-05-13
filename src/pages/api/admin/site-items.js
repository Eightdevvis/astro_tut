import { getDb, ensureDbSchema } from '../../../lib/db.js';
import { hasPermission } from '../../../lib/permissions.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { normalizeDbRow, validateIncomingItem } from '../../../lib/site-items.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function assertSuper(cookies) {
  const caller = await getUsernameFromCookies(cookies);
  if (!caller) return { ok: false, status: 401, error: 'Nicht eingeloggt' };
  if (!(await hasPermission(caller, 'super_access'))) {
    return { ok: false, status: 403, error: 'Keine Berechtigung' };
  }
  return { ok: true, caller };
}

export async function GET({ cookies }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    await ensureDbSchema();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT id, kind, variant, name, description, behavior, config_json,
                   enabled, sort_order, created_at
            FROM site_item_catalog
            ORDER BY kind ASC, sort_order ASC, id ASC`,
      args: [],
    });
    const items = (result.rows || []).map(normalizeDbRow);
    return json({ items });
  } catch (err) {
    console.error('GET /api/admin/site-items', err);
    return json({ error: 'Katalog laden fehlgeschlagen' }, 500);
  }
}

export async function PUT({ cookies, request }) {
  const auth = await assertSuper(cookies);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültiger JSON-Body' }, 400);
  }
  const raw = Array.isArray(body?.items) ? body.items : null;
  if (!raw) return json({ error: 'items[] erforderlich' }, 400);

  const cleaned = [];
  const seenIds = new Set();
  for (const r of raw) {
    const { item, error } = validateIncomingItem(r);
    if (error) return json({ error }, 400);
    if (seenIds.has(item.id)) {
      return json({ error: `Doppelte ID: ${item.id}` }, 400);
    }
    seenIds.add(item.id);
    cleaned.push(item);
  }

  try {
    await ensureDbSchema();
    const db = getDb();
    // Komplett-Replace: erst DELETE, dann INSERT. Bei Bedarf später durch
    // Diff-basiertes Upsert ersetzen. Für aktuell wenige Items unkritisch.
    await db.execute({ sql: 'DELETE FROM site_item_catalog', args: [] });
    for (const item of cleaned) {
      await db.execute({
        sql: `INSERT INTO site_item_catalog
              (id, kind, variant, name, description, behavior, config_json, enabled, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          item.id,
          item.kind,
          item.variant,
          item.name,
          item.description,
          item.behavior,
          JSON.stringify(item.config),
          item.enabled,
          item.sortOrder,
        ],
      });
    }
    return json({ ok: true, count: cleaned.length });
  } catch (err) {
    console.error('PUT /api/admin/site-items', err);
    return json({ error: 'Katalog speichern fehlgeschlagen' }, 500);
  }
}
