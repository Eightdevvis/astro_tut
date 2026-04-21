/**
 * Topic-Feeds: CRUD und Abfragen für user_feeds, sources, items, pins, summaries.
 */

import { createHash } from 'node:crypto';
import { ensureDbSchema, getDb } from './db.js';
import { seedFeedPolicyDefaults } from './feed-policy.js';

export const MAX_FEEDS_PER_USER = 15;
export const MAX_SOURCES_PER_FEED = 25;
export const MAX_PREVIEW_HEADLINES = 5;
export const MAX_ITEMS_DETAIL = 120;

/** @param {string | undefined} guid @param {string | undefined} link */
export function stableFeedItemId(guid, link) {
  const g = String(guid || '').trim();
  const l = String(link || '').trim();
  const raw = g ? `guid:${g}` : `link:${l}`;
  if (!raw || raw === 'link:') return createHash('sha256').update(`empty:${Date.now()}`).digest('hex').slice(0, 40);
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/** @param {string} url */
export function domainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {string} username
 * @param {{ preview?: boolean }} [opts]
 */
export async function listUserFeeds(username, opts = {}) {
  await ensureDbSchema();
  const db = getDb();
  const preview = Boolean(opts.preview);
  const feedsRes = await db.execute({
    sql: `SELECT id, title, user_prompt, sort_order, created_at, updated_at, last_ingest_at
          FROM user_feeds WHERE username = ? ORDER BY sort_order ASC, id ASC`,
    args: [username],
  });
  /** @type {any[]} */
  const out = [];
  for (const row of feedsRes.rows || []) {
    const r = /** @type {any} */ (row);
    const id = Number(r.id);
    /** @type {any} */
    const entry = {
      id,
      title: String(r.title),
      user_prompt: String(r.user_prompt || ''),
      sort_order: Number(r.sort_order) || 0,
      created_at: String(r.created_at || ''),
      updated_at: String(r.updated_at || ''),
      last_ingest_at: r.last_ingest_at == null ? null : String(r.last_ingest_at),
    };
    if (preview) {
      const items = await db.execute({
        sql: `SELECT title, url, published_at, image_url FROM user_feed_items
              WHERE feed_id = ? ORDER BY datetime(COALESCE(published_at, fetched_at)) DESC LIMIT ?`,
        args: [id, MAX_PREVIEW_HEADLINES],
      });
      entry.preview = (items.rows || []).map((x) => {
        const t = /** @type {any} */ (x);
        return {
          title: String(t.title || ''),
          url: String(t.url || ''),
          published_at: t.published_at == null ? null : String(t.published_at),
          image_url: t.image_url == null || t.image_url === '' ? null : String(t.image_url),
        };
      });
    }
    out.push(entry);
  }
  return out;
}

/**
 * @param {string} username
 * @param {number} feedId
 */
export async function getFeedByIdForOwner(username, feedId) {
  await ensureDbSchema();
  const db = getDb();
  const fr = await db.execute({
    sql: `SELECT id, title, user_prompt, ai_plan_json, sort_order, created_at, updated_at, last_ingest_at
          FROM user_feeds WHERE id = ? AND username = ? LIMIT 1`,
    args: [feedId, username],
  });
  const row = fr.rows?.[0];
  if (!row) return null;
  const r = /** @type {any} */ (row);
  return {
    id: Number(r.id),
    title: String(r.title),
    user_prompt: String(r.user_prompt || ''),
    ai_plan_json: String(r.ai_plan_json || '{}'),
    sort_order: Number(r.sort_order) || 0,
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
    last_ingest_at: r.last_ingest_at == null ? null : String(r.last_ingest_at),
  };
}

/**
 * @param {string} username
 * @param {number} feedId
 */
export async function getFeedDetailBundle(username, feedId) {
  const meta = await getFeedByIdForOwner(username, feedId);
  if (!meta) return null;
  await ensureDbSchema();
  const db = getDb();

  const itemsRes = await db.execute({
    sql: `SELECT id, title, url, summary, published_at, fetched_at, source_feed_url, domain, image_url
          FROM user_feed_items WHERE feed_id = ?
          ORDER BY datetime(COALESCE(published_at, fetched_at)) DESC LIMIT ?`,
    args: [feedId, MAX_ITEMS_DETAIL],
  });
  const items = (itemsRes.rows || []).map((x) => {
    const t = /** @type {any} */ (x);
    return {
      id: Number(t.id),
      title: String(t.title || ''),
      url: String(t.url || ''),
      summary: t.summary == null ? null : String(t.summary),
      published_at: t.published_at == null ? null : String(t.published_at),
      fetched_at: String(t.fetched_at || ''),
      source_feed_url: t.source_feed_url == null ? null : String(t.source_feed_url),
      domain: String(t.domain || ''),
      image_url: t.image_url == null || t.image_url === '' ? null : String(t.image_url),
    };
  });

  const pinsRes = await db.execute({
    sql: `SELECT id, url, title_override, note, sort_order FROM user_feed_pins WHERE feed_id = ? ORDER BY sort_order ASC, id ASC`,
    args: [feedId],
  });
  const pins = (pinsRes.rows || []).map((x) => {
    const t = /** @type {any} */ (x);
    return {
      id: Number(t.id),
      url: String(t.url || ''),
      title_override: t.title_override == null ? '' : String(t.title_override),
      note: String(t.note || ''),
      sort_order: Number(t.sort_order) || 0,
    };
  });

  const sumRes = await db.execute({
    sql: `SELECT body_md, covers_through, generated_at, model FROM user_feed_summaries
          WHERE feed_id = ? ORDER BY datetime(generated_at) DESC LIMIT 1`,
    args: [feedId],
  });
  const srow = sumRes.rows?.[0];
  const summary = srow
    ? (() => {
        const t = /** @type {any} */ (srow);
        return {
          body_md: String(t.body_md || ''),
          covers_through: t.covers_through == null ? null : String(t.covers_through),
          generated_at: String(t.generated_at || ''),
          model: String(t.model || ''),
        };
      })()
    : null;

  const srcRes = await db.execute({
    sql: `SELECT id, url, enabled, added_by, user_confirmed, last_fetch_at, last_error FROM user_feed_sources WHERE feed_id = ? ORDER BY id ASC`,
    args: [feedId],
  });
  const sources = (srcRes.rows || []).map((x) => {
    const t = /** @type {any} */ (x);
    return {
      id: Number(t.id),
      url: String(t.url || ''),
      enabled: Boolean(Number(t.enabled)),
      added_by: String(t.added_by || ''),
      user_confirmed: Boolean(Number(t.user_confirmed)),
      last_fetch_at: t.last_fetch_at == null ? null : String(t.last_fetch_at),
      last_error: t.last_error == null ? null : String(t.last_error),
    };
  });

  return { meta, items, pins, summary, sources };
}

/**
 * @param {string} username
 * @param {{ title: string; user_prompt: string; ai_plan_json: object; sources: { url: string; added_by: string; user_confirmed?: boolean }[] }} body
 */
export async function createUserFeed(username, body) {
  await ensureDbSchema();
  const db = getDb();
  await seedFeedPolicyDefaults(db);

  const cnt = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM user_feeds WHERE username = ?',
    args: [username],
  });
  const n = Number((/** @type {any} */ (cnt.rows?.[0]))?.n) || 0;
  if (n >= MAX_FEEDS_PER_USER) {
    throw new Error(`Maximal ${MAX_FEEDS_PER_USER} Feeds.`);
  }

  const title = String(body.title || '').trim().slice(0, 200);
  const user_prompt = String(body.user_prompt || '').trim().slice(0, 8000);
  if (!title) throw new Error('Titel fehlt.');
  if (!user_prompt) throw new Error('Themenbeschreibung fehlt.');
  if (!Array.isArray(body.sources) || body.sources.length === 0) throw new Error('Mindestens eine Quelle (RSS).');
  if (body.sources.length > MAX_SOURCES_PER_FEED) throw new Error(`Maximal ${MAX_SOURCES_PER_FEED} Quellen.`);

  const planJson = JSON.stringify(body.ai_plan_json && typeof body.ai_plan_json === 'object' ? body.ai_plan_json : {});

  const maxSort = await db.execute({
    sql: 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_feeds WHERE username = ?',
    args: [username],
  });
  const sortOrder = Number((/** @type {any} */ (maxSort.rows?.[0]))?.m) + 1;

  const ins = await db.execute({
    sql: `INSERT INTO user_feeds (username, title, user_prompt, ai_plan_json, sort_order)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [username, title, user_prompt, planJson, sortOrder],
  });
  const feedId = Number((/** @type {any} */ (ins.rows?.[0]))?.id);
  if (!Number.isFinite(feedId)) throw new Error('Feed konnte nicht angelegt werden.');

  for (const s of body.sources) {
    const url = String(s.url || '').trim();
    const added_by = String(s.added_by || 'user');
    const user_confirmed = s.user_confirmed ? 1 : 0;
    await db.execute({
      sql: `INSERT INTO user_feed_sources (feed_id, kind, url, enabled, added_by, user_confirmed)
            VALUES (?, 'rss', ?, 1, ?, ?)`,
      args: [feedId, url, added_by.slice(0, 32), user_confirmed],
    });
  }

  return feedId;
}

/**
 * @param {string} username
 * @param {number} feedId
 * @param {{ title?: string; sort_order?: number }} patch
 */
export async function updateUserFeed(username, feedId, patch) {
  await ensureDbSchema();
  const db = getDb();
  const ex = await getFeedByIdForOwner(username, feedId);
  if (!ex) return false;
  if (patch.title != null) {
    const t = String(patch.title).trim().slice(0, 200);
    if (t)
      await db.execute({
        sql: `UPDATE user_feeds SET title = ?, updated_at = datetime('now') WHERE id = ? AND username = ?`,
        args: [t, feedId, username],
      });
  }
  if (patch.sort_order != null && Number.isFinite(Number(patch.sort_order))) {
    await db.execute({
      sql: `UPDATE user_feeds SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND username = ?`,
      args: [Number(patch.sort_order), feedId, username],
    });
  }
  return true;
}

/**
 * @param {string} username
 * @param {number[]} orderedIds
 */
export async function reorderUserFeeds(username, orderedIds) {
  await ensureDbSchema();
  const db = getDb();
  let ord = 0;
  for (const id of orderedIds) {
    const fid = Number(id);
    if (!Number.isFinite(fid)) continue;
    await db.execute({
      sql: `UPDATE user_feeds SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND username = ?`,
      args: [ord++, fid, username],
    });
  }
}

/**
 * @param {string} username
 * @param {number} feedId
 */
export async function deleteUserFeed(username, feedId) {
  await ensureDbSchema();
  const db = getDb();
  const ex = await getFeedByIdForOwner(username, feedId);
  if (!ex) return false;
  await db.execute({ sql: 'DELETE FROM user_feed_pins WHERE feed_id = ?', args: [feedId] });
  await db.execute({ sql: 'DELETE FROM user_feed_summaries WHERE feed_id = ?', args: [feedId] });
  await db.execute({ sql: 'DELETE FROM user_feed_items WHERE feed_id = ?', args: [feedId] });
  await db.execute({ sql: 'DELETE FROM user_feed_sources WHERE feed_id = ?', args: [feedId] });
  const r = await db.execute({
    sql: 'DELETE FROM user_feeds WHERE id = ? AND username = ?',
    args: [feedId, username],
  });
  return (/** @type {any} */ (r)).rowsAffected > 0 || (/** @type {any} */ (r)).affectedRows > 0;
}

/**
 * @param {string} username
 * @param {number} feedId
 * @param {{ url: string; title_override?: string; note?: string }} p
 */
export async function addUserFeedPin(username, feedId, p) {
  await ensureDbSchema();
  const db = getDb();
  if (!(await getFeedByIdForOwner(username, feedId))) return null;
  const url = String(p.url || '').trim();
  if (!url) throw new Error('URL fehlt.');
  const title_override = p.title_override != null ? String(p.title_override).trim().slice(0, 300) : '';
  const note = p.note != null ? String(p.note).trim().slice(0, 500) : '';
  const mx = await db.execute({
    sql: 'SELECT COALESCE(MAX(sort_order), -1) AS m FROM user_feed_pins WHERE feed_id = ?',
    args: [feedId],
  });
  const sort = Number((/** @type {any} */ (mx.rows?.[0]))?.m) + 1;
  const ins = await db.execute({
    sql: `INSERT INTO user_feed_pins (feed_id, url, title_override, note, sort_order)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [feedId, url.slice(0, 2000), title_override, note, sort],
  });
  return Number((/** @type {any} */ (ins.rows?.[0]))?.id);
}

/**
 * @param {string} username
 * @param {number} feedId
 * @param {number} pinId
 */
export async function deleteUserFeedPin(username, feedId, pinId) {
  await ensureDbSchema();
  const db = getDb();
  if (!(await getFeedByIdForOwner(username, feedId))) return false;
  const r = await db.execute({
    sql: 'DELETE FROM user_feed_pins WHERE id = ? AND feed_id = ?',
    args: [pinId, feedId],
  });
  return (/** @type {any} */ (r)).rowsAffected > 0 || (/** @type {any} */ (r)).affectedRows > 0;
}

/**
 * @param {number} feedId
 * @param {{ body_md: string; covers_through: string | null; model: string }} s
 */
export async function insertFeedSummary(feedId, s) {
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO user_feed_summaries (feed_id, body_md, covers_through, model) VALUES (?, ?, ?, ?)`,
    args: [feedId, s.body_md, s.covers_through, s.model],
  });
}

/**
 * @param {number} feedId
 */
export async function setFeedLastIngest(feedId) {
  await ensureDbSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE user_feeds SET last_ingest_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    args: [feedId],
  });
}

/**
 * @param {number} sourceId
 * @param {{ ok: boolean; error?: string | null }} st
 */
export async function updateSourceFetchStatus(sourceId, st) {
  await ensureDbSchema();
  const db = getDb();
  if (st.ok) {
    await db.execute({
      sql: `UPDATE user_feed_sources SET last_fetch_at = datetime('now'), last_error = NULL WHERE id = ?`,
      args: [sourceId],
    });
  } else {
    const err = (st.error || 'fetch failed').slice(0, 500);
    await db.execute({
      sql: `UPDATE user_feed_sources SET last_error = ? WHERE id = ?`,
      args: [err, sourceId],
    });
  }
}
