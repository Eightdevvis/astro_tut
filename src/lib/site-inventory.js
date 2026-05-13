/**
 * src/lib/site-inventory.js
 *
 * Pure Helper rund um das Hand-Inventar und die "liegenden Items" auf Seiten.
 * STRIKT getrennt vom RPG-Inventar (kein Import aus rpg-*).
 *
 * Slot-Konvention: 'hand' für das, was der User in der Hand trägt,
 * 'slot0'..'slot5' für die ausklappbaren Fächer.
 */

export const INVENTORY_SLOT_COUNT = 6;
export const INVENTORY_SLOTS = ['hand', ...Array.from({ length: INVENTORY_SLOT_COUNT }, (_, i) => `slot${i}`)];

export function isValidSlot(slot) {
  return INVENTORY_SLOTS.includes(String(slot || ''));
}

/** Normalisiert einen Page-Path so wie graffiti-tiles.js es tut. */
export function normalizePagePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  return raw.slice(0, 250);
}

/** Klemmt Drop-Koordinaten auf einen vernünftigen Bereich. */
export function clampDropCoord(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Negative Koordinaten lassen wir zu (kann durch Layout-Verschiebungen
  // entstehen), aber wir cappen extrem große Werte gegen Page-Overflows.
  return Math.max(-10000, Math.min(100000, Math.round(n)));
}

/**
 * Liefert das User-Inventar in Map-Form { 'hand': itemId | null, 'slot0': ... }.
 * Slots ohne Eintrag in der DB werden als null zurückgegeben.
 */
export async function loadInventoryMap(db, username) {
  const res = await db.execute({
    sql: 'SELECT slot, item_id FROM site_user_inventory WHERE username = ?',
    args: [username],
  });
  /** @type {Record<string, string | null>} */
  const map = {};
  for (const slot of INVENTORY_SLOTS) map[slot] = null;
  for (const row of res.rows || []) {
    const s = String(row.slot || '');
    if (isValidSlot(s)) map[s] = String(row.item_id || '');
  }
  return map;
}

/** Schreibt einen Slot. itemId === null löscht den Slot. */
export async function setInventorySlot(db, username, slot, itemId) {
  if (!isValidSlot(slot)) throw new Error(`invalid slot: ${slot}`);
  if (itemId == null) {
    await db.execute({
      sql: 'DELETE FROM site_user_inventory WHERE username = ? AND slot = ?',
      args: [username, slot],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO site_user_inventory (username, slot, item_id, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(username, slot) DO UPDATE SET
            item_id = excluded.item_id,
            updated_at = excluded.updated_at`,
    args: [username, slot, itemId],
  });
}

/** Vertauscht den Inhalt zweier Slots in einer Transaktion-light. */
export async function swapInventorySlots(db, username, from, to) {
  if (from === to) return;
  if (!isValidSlot(from) || !isValidSlot(to)) {
    throw new Error('invalid swap');
  }
  const map = await loadInventoryMap(db, username);
  const a = map[from];
  const b = map[to];
  // Erst beide leeren (sonst PK-Konflikt theoretisch), dann neu setzen.
  await setInventorySlot(db, username, from, null);
  await setInventorySlot(db, username, to, null);
  if (b != null) await setInventorySlot(db, username, from, b);
  if (a != null) await setInventorySlot(db, username, to, a);
}

/** Liefert den ersten Slot der null ist, oder null wenn alle voll. */
export function firstEmptySlot(invMap) {
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i += 1) {
    const key = `slot${i}`;
    if (invMap[key] == null) return key;
  }
  return null;
}

/**
 * Holt die Catalog-Daten für alle item_ids in einem Rutsch. Liefert
 * Map<itemId, publicForm>.
 */
export async function fetchCatalogMap(db, itemIds) {
  const list = [...new Set(itemIds.filter((x) => typeof x === 'string' && x))];
  if (list.length === 0) return new Map();
  // Dynamic IN-Liste sicher bauen (libsql akzeptiert keine Array-Parameter
  // für IN — also Placeholders manuell).
  const placeholders = list.map(() => '?').join(',');
  const res = await db.execute({
    sql: `SELECT id, kind, variant, name, description, behavior, config_json, enabled
          FROM site_item_catalog
          WHERE id IN (${placeholders})`,
    args: list,
  });
  const map = new Map();
  for (const row of res.rows || []) {
    let config = {};
    try {
      const parsed = JSON.parse(String(row.config_json || '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
    } catch {
      // kaputtes JSON → leeres config
    }
    map.set(String(row.id), {
      id: String(row.id),
      kind: String(row.kind || ''),
      variant: String(row.variant || ''),
      name: String(row.name || ''),
      description: String(row.description || ''),
      behavior: String(row.behavior || 'none'),
      config,
      enabled: Number(row.enabled ?? 1) ? 1 : 0,
    });
  }
  return map;
}
