/**
 * /api/site-inventory/me
 *
 * GET   — Liefert das Inventar des eingeloggten Users (Hand + 6 Slots) mit
 *         eingebetteten Catalog-Daten.
 * POST  — Mutations via { action: ... }:
 *         { action: 'swap',    from: 'hand'|'slotN', to: 'hand'|'slotN' }
 *         { action: 'pickup',  placedItemId: number }
 *         { action: 'drop',    pagePath: string, x: number, y: number }
 *
 * Anonymous-User → 401. Inventar ist user-gebunden.
 */
import { ensureDbSchema, getDb } from '../../../lib/db.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import {
  INVENTORY_SLOTS,
  isValidSlot,
  loadInventoryMap,
  setInventorySlot,
  swapInventorySlots,
  fetchCatalogMap,
  normalizePagePath,
  clampDropCoord,
} from '../../../lib/site-inventory.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function requireUser(cookies) {
  const username = await getUsernameFromCookies(cookies);
  return username || null;
}

async function buildInventoryResponse(db, username) {
  const map = await loadInventoryMap(db, username);
  const ids = Object.values(map).filter((v) => v != null);
  const catalog = await fetchCatalogMap(db, ids);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const slot of INVENTORY_SLOTS) {
    const id = map[slot];
    out[slot] = id ? catalog.get(id) || null : null;
  }
  return out;
}

export async function GET({ cookies }) {
  const username = await requireUser(cookies);
  if (!username) return json({ error: 'Nicht eingeloggt' }, 401);
  try {
    await ensureDbSchema();
    const db = getDb();
    const inventory = await buildInventoryResponse(db, username);
    return json({ username, inventory });
  } catch (err) {
    console.error('GET /api/site-inventory/me', err);
    return json({ error: 'Inventar laden fehlgeschlagen' }, 500);
  }
}

export async function POST({ cookies, request }) {
  const username = await requireUser(cookies);
  if (!username) return json({ error: 'Nicht eingeloggt' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültiger JSON-Body' }, 400);
  }
  const action = String(body?.action || '').trim();

  try {
    await ensureDbSchema();
    const db = getDb();

    if (action === 'swap') {
      const from = String(body?.from || '');
      const to = String(body?.to || '');
      if (!isValidSlot(from) || !isValidSlot(to)) {
        return json({ error: 'Ungültige Slots' }, 400);
      }
      await swapInventorySlots(db, username, from, to);
      const inventory = await buildInventoryResponse(db, username);
      return json({ ok: true, inventory });
    }

    if (action === 'pickup') {
      const placedItemId = Number(body?.placedItemId);
      if (!Number.isInteger(placedItemId) || placedItemId <= 0) {
        return json({ error: 'placedItemId erforderlich' }, 400);
      }
      // Hand muss frei sein.
      const map = await loadInventoryMap(db, username);
      if (map.hand != null) {
        return json({ error: 'Hand ist nicht frei' }, 409);
      }
      // Item finden + entfernen + in die Hand legen.
      const placed = await db.execute({
        sql: 'SELECT id, item_id FROM site_placed_items WHERE id = ? LIMIT 1',
        args: [placedItemId],
      });
      const row = placed.rows?.[0];
      if (!row) return json({ error: 'Item liegt nicht (mehr) auf der Seite' }, 404);
      await db.execute({
        sql: 'DELETE FROM site_placed_items WHERE id = ?',
        args: [placedItemId],
      });
      await setInventorySlot(db, username, 'hand', String(row.item_id));
      const inventory = await buildInventoryResponse(db, username);
      return json({ ok: true, inventory });
    }

    if (action === 'drop') {
      const map = await loadInventoryMap(db, username);
      const handId = map.hand;
      if (!handId) return json({ error: 'Hand ist leer' }, 409);
      const pagePath = normalizePagePath(body?.pagePath);
      const x = clampDropCoord(body?.x);
      const y = clampDropCoord(body?.y);
      const insertResult = await db.execute({
        sql: `INSERT INTO site_placed_items (page_path, item_id, x, y, placed_by)
              VALUES (?, ?, ?, ?, ?)`,
        args: [pagePath, handId, x, y, username],
      });
      const placedItemId = Number(insertResult.lastInsertRowid ?? 0);
      await setInventorySlot(db, username, 'hand', null);
      const inventory = await buildInventoryResponse(db, username);
      return json({ ok: true, inventory, placedItemId });
    }

    return json({ error: `Unbekannte action: ${action}` }, 400);
  } catch (err) {
    console.error('POST /api/site-inventory/me', err);
    return json({ error: 'Aktion fehlgeschlagen' }, 500);
  }
}
