/**
 * src/lib/user-id.js
 *
 * Helfer zum Erzeugen unique Login-IDs aus einem Display-Namen.
 *  - slugify(name): macht aus "Sarah B." -> "sarahb"
 *  - findFreeUserId(base): findet ID die in users.username noch nicht existiert.
 *    Erste Sarah bekommt "sarah", zweite "sarah0", dritte "sarah1", ...
 */

import { getDb, ensureDbSchema } from './db.js';

const MAX_ID_LEN = 24;

/**
 * Slug aus Anzeigenamen. Lowercase, nur a-z 0-9; alles andere weg.
 * Leerer Slug -> 'user'.
 */
export function slugifyForUserId(name) {
  const raw = String(name ?? '').toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]+/g, '');
  if (!cleaned) return 'user';
  return cleaned.slice(0, MAX_ID_LEN);
}

/**
 * Pruefen ob eine ID in users.username noch frei ist.
 */
export async function isUserIdFree(id) {
  if (!id) return false;
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT 1 FROM users WHERE username = ? LIMIT 1',
    args: [id],
  });
  return r.rows.length === 0;
}

/**
 * Findet die naechste freie ID basierend auf base.
 *  - base selbst frei -> base
 *  - sonst base + 0, base + 1, ... bis frei.
 *
 * Eine einzige Query: alle bestehenden IDs die mit dem Slug starten werden
 * geladen, der Rest wird lokal entschieden. Vorher: bis zu 10000 Roundtrips.
 */
export async function findFreeUserId(base) {
  const slug = slugifyForUserId(base);
  await ensureDbSchema();
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT username FROM users WHERE username = ? OR username LIKE ?',
    args: [slug, `${slug}%`],
  });
  const taken = new Set(r.rows.map((row) => String(row.username)));
  if (!taken.has(slug)) return slug;
  for (let i = 0; i < 10000; i += 1) {
    const candidate = `${slug}${i}`.slice(0, MAX_ID_LEN);
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}${Date.now().toString(36)}`.slice(0, MAX_ID_LEN);
}

/**
 * Validiert eine Login-ID-Eingabe vom User.
 * Returns null = ok, oder eine Fehlermeldung.
 */
export function validateUserIdShape(id) {
  if (typeof id !== 'string') return 'Login-ID muss ein String sein';
  const s = id.trim();
  if (!s) return 'Login-ID darf nicht leer sein';
  if (s.length > MAX_ID_LEN) return `Login-ID max. ${MAX_ID_LEN} Zeichen`;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) {
    return 'Login-ID nur Kleinbuchstaben, Ziffern, _ und - (Anfang Buchstabe/Ziffer)';
  }
  return null;
}
