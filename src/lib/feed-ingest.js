/**
 * RSS-Ingestion für Topic-Feeds.
 */

import Parser from 'rss-parser';
import { ensureDbSchema, getDb } from './db.js';
import { domainFromUrl, stableFeedItemId, setFeedLastIngest, updateSourceFetchStatus } from './feed-db.js';
import { isHostBlockedDb } from './feed-policy.js';

const FETCH_TIMEOUT_MS = 12000;
const MAX_ITEMS_PER_SOURCE = 40;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    'User-Agent': 'SaShBlogTopicFeed/1.0 (+https://github.com)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  },
});

/**
 * @param {number} feedId
 */
export async function ingestOneFeed(feedId) {
  await ensureDbSchema();
  const db = getDb();
  const srcRes = await db.execute({
    sql: `SELECT id, url FROM user_feed_sources WHERE feed_id = ? AND enabled = 1`,
    args: [feedId],
  });
  const sources = srcRes.rows || [];
  for (const row of sources) {
    const r = /** @type {any} */ (row);
    const sourceId = Number(r.id);
    const url = String(r.url || '');
    try {
      const feed = await parser.parseURL(url);
      const items = Array.isArray(feed.items) ? feed.items.slice(0, MAX_ITEMS_PER_SOURCE) : [];
      for (const it of items) {
        const link = String(it.link || it.guid || '').trim();
        if (!link || !/^https?:\/\//i.test(link)) continue;
        const useLink = link.startsWith('http://') ? link.replace(/^http:/i, 'https:') : link;
        const guid = typeof it.guid === 'string' ? it.guid : it.guid?.['#text'] || it.id || '';
        const sid = stableFeedItemId(guid, useLink);
        const title = String(it.title || 'Ohne Titel').trim().slice(0, 500) || 'Ohne Titel';
        const summary =
          it.contentSnippet != null
            ? String(it.contentSnippet).trim().slice(0, 600)
            : it.summary != null
              ? String(it.summary)
                  .replace(/<[^>]+>/g, ' ')
                  .trim()
                  .slice(0, 600)
              : null;
        let published_at = null;
        if (it.pubDate) {
          const t = Date.parse(String(it.pubDate));
          if (!Number.isNaN(t)) published_at = new Date(t).toISOString();
        } else if (it.isoDate) {
          const t = Date.parse(String(it.isoDate));
          if (!Number.isNaN(t)) published_at = new Date(t).toISOString();
        }
        const dom = domainFromUrl(useLink);
        if (dom && (await isHostBlockedDb(db, dom))) continue;
        await db.execute({
          sql: `INSERT INTO user_feed_items (feed_id, stable_id, title, url, summary, published_at, fetched_at, source_feed_url, domain)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
                ON CONFLICT(feed_id, stable_id) DO UPDATE SET
                  title = excluded.title,
                  url = excluded.url,
                  summary = excluded.summary,
                  published_at = COALESCE(excluded.published_at, user_feed_items.published_at),
                  fetched_at = excluded.fetched_at,
                  domain = excluded.domain`,
          args: [feedId, sid, title, useLink, summary, published_at, url, dom],
        });
      }
      await updateSourceFetchStatus(sourceId, { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateSourceFetchStatus(sourceId, { ok: false, error: msg });
    }
  }
  await setFeedLastIngest(feedId);
}

/**
 * Ingest all feeds (cron): round-robin by oldest last_ingest_at.
 * @param {{ maxFeeds?: number }} opts
 */
export async function ingestAllFeedsRoundRobin(opts = {}) {
  await ensureDbSchema();
  const db = getDb();
  const maxFeeds = Math.min(50, Math.max(1, Number(opts.maxFeeds) || 20));
  const res = await db.execute({
    sql: `SELECT id FROM user_feeds
          ORDER BY datetime(COALESCE(last_ingest_at, '1970-01-01')) ASC, id ASC
          LIMIT ?`,
    args: [maxFeeds],
  });
  for (const row of res.rows || []) {
    const id = Number((/** @type {any} */ (row)).id);
    if (Number.isFinite(id)) await ingestOneFeed(id);
  }
}
