/**
 * Pro-User-Defaults fuer Privacy + Backup-Webhook.
 *
 * Tabelle `user_privacy_defaults` (PK username):
 *   default_visibility  — wird bei neuen Posts vorbelegt
 *   default_flags       — JSON-Bag, Defaults fuer privacy_flags
 *   hub_excluded        — 0/1: Posts dieses Users tauchen nicht im Hub auf
 *   full_hidden         — 0/1: Posts werden aus *jedem* Listing entfernt
 *                         (Hub + /blog + Home + Sitemap; Direkt-URL bleibt
 *                         erreichbar abhaengig von visibility)
 *   block_all_ai        — 0/1: erzwingt uaGateBlock {ai,archive} fuer alle
 *                         Posts dieses Users, auch wenn Post als public
 *                         eingestellt ist
 *   backup_webhook_url  — optionale externe URL fuer A7-Mirror
 */

import { ensureDbSchema, getDb } from './db.js';
import { normalizeVisibility } from './blog-privacy.js';

export const DEFAULTS = Object.freeze({
  default_visibility: 'public',
  default_flags: '{}',
  hub_excluded: 0,
  full_hidden: 0,
  block_all_ai: 0,
  backup_webhook_url: '',
});

function normalizeFlagsJson(v) {
  if (v == null || v === '') return '{}';
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '{}';
    const clean = {};
    for (const [k, val] of Object.entries(obj)) {
      if (typeof val === 'boolean') clean[k] = val;
    }
    return JSON.stringify(clean);
  } catch {
    return '{}';
  }
}

export async function getUserPrivacyDefaults(username) {
  if (!username) return { ...DEFAULTS };
  await ensureDbSchema();
  const r = await getDb().execute({
    sql: `SELECT default_visibility, default_flags, hub_excluded, full_hidden,
                 block_all_ai, backup_webhook_url
            FROM user_privacy_defaults
           WHERE username = ?
           LIMIT 1`,
    args: [username],
  });
  const row = r.rows?.[0];
  if (!row) return { ...DEFAULTS };
  return {
    default_visibility: normalizeVisibility(row.default_visibility),
    default_flags: String(row.default_flags || '{}'),
    hub_excluded: Number(row.hub_excluded) ? 1 : 0,
    full_hidden: Number(row.full_hidden) ? 1 : 0,
    block_all_ai: Number(row.block_all_ai) ? 1 : 0,
    backup_webhook_url: String(row.backup_webhook_url || ''),
  };
}

export async function upsertUserPrivacyDefaults(username, patch) {
  if (!username) return;
  await ensureDbSchema();
  const current = await getUserPrivacyDefaults(username);
  const next = {
    default_visibility: patch?.default_visibility !== undefined
      ? normalizeVisibility(patch.default_visibility)
      : current.default_visibility,
    default_flags: patch?.default_flags !== undefined
      ? normalizeFlagsJson(patch.default_flags)
      : current.default_flags,
    hub_excluded: patch?.hub_excluded !== undefined
      ? (patch.hub_excluded ? 1 : 0)
      : current.hub_excluded,
    full_hidden: patch?.full_hidden !== undefined
      ? (patch.full_hidden ? 1 : 0)
      : current.full_hidden,
    block_all_ai: patch?.block_all_ai !== undefined
      ? (patch.block_all_ai ? 1 : 0)
      : current.block_all_ai,
    backup_webhook_url: patch?.backup_webhook_url !== undefined
      ? String(patch.backup_webhook_url || '').slice(0, 1024)
      : current.backup_webhook_url,
  };
  await getDb().execute({
    sql: `INSERT INTO user_privacy_defaults
            (username, default_visibility, default_flags, hub_excluded,
             full_hidden, block_all_ai, backup_webhook_url, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(username) DO UPDATE SET
            default_visibility = excluded.default_visibility,
            default_flags = excluded.default_flags,
            hub_excluded = excluded.hub_excluded,
            full_hidden = excluded.full_hidden,
            block_all_ai = excluded.block_all_ai,
            backup_webhook_url = excluded.backup_webhook_url,
            updated_at = excluded.updated_at`,
    args: [
      username,
      next.default_visibility,
      next.default_flags,
      next.hub_excluded,
      next.full_hidden,
      next.block_all_ai,
      next.backup_webhook_url,
    ],
  });
  return next;
}

/**
 * Liefert ein Set aller Usernames, die `full_hidden=1` haben.
 * Wird von Listings (Hub/Blog/Index/Sitemap/robots.txt) abgefragt,
 * um diese Autoren aus Listen zu streichen.
 *
 * Cache moeglich, falls Performance ein Problem wird — derzeit nicht
 * noetig, weil Listings nur einmal pro Page-Render ausgefuehrt werden.
 */
export async function getFullHiddenUsernames() {
  await ensureDbSchema();
  const r = await getDb().execute(
    `SELECT username FROM user_privacy_defaults WHERE full_hidden = 1`
  );
  return new Set((r.rows || []).map((row) => String(row.username || '')));
}

export async function getHubExcludedUsernames() {
  await ensureDbSchema();
  const r = await getDb().execute(
    `SELECT username FROM user_privacy_defaults WHERE hub_excluded = 1 OR full_hidden = 1`
  );
  return new Set((r.rows || []).map((row) => String(row.username || '')));
}

export async function isAuthorBlockAllAi(username) {
  if (!username) return false;
  const d = await getUserPrivacyDefaults(username);
  return d.block_all_ai === 1;
}
