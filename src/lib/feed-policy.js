/**
 * RSS-URL-Validierung, Allowlist / Blocklist (DB).
 */

import { DEFAULT_FEED_ALLOWLIST, DEFAULT_FEED_BLOCKLIST } from './feed-seed-defaults.js';

/** @param {string} raw */
export function parseHttpsUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!host || host === 'localhost') return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    if (host.startsWith('[')) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {string} hostname lowercased
 */
export async function isHostBlockedDb(db, hostname) {
  const h = hostname.toLowerCase();
  const res = await db.execute({ sql: 'SELECT host_pattern FROM feed_blocklist', args: [] });
  for (const row of res.rows || []) {
    const p = String((/** @type {any} */ (row)).host_pattern || '').toLowerCase();
    if (!p) continue;
    if (h === p || h.includes(p)) return true;
  }
  return false;
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {string} url normalized https url string
 * @returns {Promise<{ autoIngest: boolean; trustTier: number; reason?: string }>}
 */
export async function classifyRssUrl(db, url) {
  const u = parseHttpsUrl(url);
  if (!u) return { autoIngest: false, trustTier: 0, reason: 'Ungültige URL (nur https).' };
  const host = u.hostname.toLowerCase();
  if (await isHostBlockedDb(db, host)) {
    return { autoIngest: false, trustTier: 0, reason: 'Domain blockiert.' };
  }

  const exact = await db.execute({
    sql: `SELECT trust_tier FROM feed_allowlist WHERE kind = 'rss_url' AND lower(trim(value)) = lower(trim(?)) LIMIT 1`,
    args: [url],
  });
  if (exact.rows[0]) {
    const tier = Number((/** @type {any} */ (exact.rows[0])).trust_tier) || 2;
    return { autoIngest: true, trustTier: tier };
  }

  const hosts = await db.execute({
    sql: `SELECT value, trust_tier FROM feed_allowlist WHERE kind = 'host_suffix'`,
    args: [],
  });
  let bestTier = 0;
  for (const row of hosts.rows || []) {
    const r = /** @type {any} */ (row);
    const suffix = String(r.value || '').toLowerCase().trim();
    if (!suffix) continue;
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      const tier = Number(r.trust_tier) || 2;
      if (tier > bestTier) bestTier = tier;
    }
  }
  if (bestTier > 0) return { autoIngest: true, trustTier: bestTier };
  return { autoIngest: false, trustTier: 0, reason: 'Nicht auf der Vertrauensliste — Bestätigung nötig.' };
}

/**
 * Lädt Allowlist-Einträge für KI-Prompt (kompakte Liste).
 * @param {import('@libsql/client').Client} db
 */
export async function listAllowlistForAiContext(db) {
  const res = await db.execute({
    sql: `SELECT kind, value, category, trust_tier FROM feed_allowlist ORDER BY trust_tier DESC, value ASC LIMIT 200`,
    args: [],
  });
  return (res.rows || []).map((row) => {
    const r = /** @type {any} */ (row);
    return {
      kind: String(r.kind),
      value: String(r.value),
      category: String(r.category || ''),
      trust_tier: Number(r.trust_tier) || 2,
    };
  });
}

/**
 * Idempotent: fügt Standard-Zeilen ein, wenn Tabellen leer sind.
 * @param {import('@libsql/client').Client} db
 */
export async function seedFeedPolicyDefaults(db) {
  const c = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM feed_allowlist', args: [] });
  const n = Number((/** @type {any} */ (c.rows?.[0]))?.n) || 0;
  if (n === 0) {
    for (const row of DEFAULT_FEED_ALLOWLIST) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO feed_allowlist (kind, value, category, trust_tier) VALUES (?, ?, ?, ?)`,
        args: [row.kind, row.value, row.category, row.trust_tier],
      });
    }
  }
  const cb = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM feed_blocklist', args: [] });
  const nb = Number((/** @type {any} */ (cb.rows?.[0]))?.n) || 0;
  if (nb === 0) {
    for (const row of DEFAULT_FEED_BLOCKLIST) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO feed_blocklist (host_pattern) VALUES (?)`,
        args: [row.host_pattern],
      });
    }
  }
}

/**
 * @param {import('@libsql/client').Client} db
 */
export async function adminListAllowlist(db) {
  const res = await db.execute({
    sql: `SELECT id, kind, value, category, trust_tier FROM feed_allowlist ORDER BY trust_tier DESC, value ASC`,
    args: [],
  });
  return (res.rows || []).map((row) => {
    const r = /** @type {any} */ (row);
    return {
      id: Number(r.id),
      kind: String(r.kind),
      value: String(r.value),
      category: String(r.category || ''),
      trust_tier: Number(r.trust_tier) || 2,
    };
  });
}

/**
 * @param {import('@libsql/client').Client} db
 */
export async function adminListBlocklist(db) {
  const res = await db.execute({
    sql: `SELECT id, host_pattern FROM feed_blocklist ORDER BY host_pattern ASC`,
    args: [],
  });
  return (res.rows || []).map((row) => {
    const r = /** @type {any} */ (row);
    return { id: Number(r.id), host_pattern: String(r.host_pattern) };
  });
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {{ kind: string; value: string; category?: string; trust_tier?: number }} p
 */
export async function adminAddAllowlist(db, p) {
  const kind = String(p.kind || '').trim();
  const value = String(p.value || '').trim();
  if (kind !== 'rss_url' && kind !== 'host_suffix') throw new Error('kind muss rss_url oder host_suffix sein.');
  if (!value) throw new Error('value fehlt.');
  const category = String(p.category ?? '').trim().slice(0, 80);
  const trust_tier = Number.isFinite(Number(p.trust_tier)) ? Number(p.trust_tier) : 2;
  await db.execute({
    sql: `INSERT OR IGNORE INTO feed_allowlist (kind, value, category, trust_tier) VALUES (?, ?, ?, ?)`,
    args: [kind, value, category, trust_tier],
  });
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 */
export async function adminRemoveAllowlist(db, id) {
  await db.execute({ sql: 'DELETE FROM feed_allowlist WHERE id = ?', args: [id] });
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {string} host_pattern
 */
export async function adminAddBlocklist(db, host_pattern) {
  const h = String(host_pattern || '').trim().toLowerCase();
  if (!h) throw new Error('host_pattern fehlt.');
  await db.execute({ sql: `INSERT INTO feed_blocklist (host_pattern) VALUES (?)`, args: [h] });
}

/**
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 */
export async function adminRemoveBlocklist(db, id) {
  await db.execute({ sql: 'DELETE FROM feed_blocklist WHERE id = ?', args: [id] });
}
