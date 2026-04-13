import { getDb } from './db.js';
import { buildRpgLocationId } from './rpg-location.js';

/**
 * @typedef {{
 *   id: string;
 *   kind: 'city' | 'place';
 *   name: string;
 *   description: string;
 *   city: string;
 *   country: string;
 *   updatedAt: string;
 * }} RpgLocationRow
 */

/**
 * @param {unknown} raw
 * @returns {string}
 */
function clean(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * @returns {Promise<RpgLocationRow[]>}
 */
export async function listRpgLocations() {
  const db = getDb();
  const r = await db.execute(
    `SELECT id, kind, name, description, city, country, updated_at
     FROM rpg_locations
     ORDER BY kind, name, city, country`
  );
  /** @type {RpgLocationRow[]} */
  const out = [];
  for (const row of r.rows) {
    const o = /** @type {Record<string, unknown>} */ (row);
    const id = clean(o.id);
    const kind = clean(o.kind) === 'place' ? 'place' : 'city';
    const name = clean(o.name);
    if (!id || !name) continue;
    out.push({
      id,
      kind,
      name,
      description: clean(o.description),
      city: clean(o.city),
      country: clean(o.country),
      updatedAt: clean(o.updated_at),
    });
  }
  return out;
}

/**
 * @param {{ kind: 'city' | 'place'; name: string; description?: string; city?: string; country?: string }} input
 * @returns {Promise<RpgLocationRow | null>}
 */
export async function upsertRpgLocation(input) {
  const kind = input.kind === 'place' ? 'place' : 'city';
  const name = clean(input.name);
  if (!name) return null;
  const city = clean(input.city) || (kind === 'city' ? name : '');
  const country = clean(input.country);
  const description = clean(input.description);
  const id = buildRpgLocationId(kind, name, city, country);
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO rpg_locations (id, kind, name, description, city, country, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            description = excluded.description,
            city = excluded.city,
            country = excluded.country,
            updated_at = datetime('now')`,
    args: [id, kind, name, description, city, country],
  });
  return { id, kind, name, description, city, country, updatedAt: '' };
}
