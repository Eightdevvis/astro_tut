/**
 * Vorschaubilder für Feed-Items: primär RSS-Felder, optional ein strikt geprüftes og:image.
 * Kein Scraping beliebiger <img> im Artikel-HTML (zu hohes Werbe-Risiko).
 */

import { classifyRssUrl, isHostBlockedDb, parseHttpsUrl } from './feed-policy.js';

const OG_FETCH_TIMEOUT_MS = 7000;
const OG_HTML_MAX_CHARS = 140_000;
/** Max. og:image-Zusatz-Fetches pro Feed pro Ingest-Lauf (Serverless/Last). */
export const MAX_OG_IMAGE_FETCHES_PER_FEED = 10;

const AD_HOST_MARKERS = [
  'doubleclick',
  'googlesyndication',
  'googleadservices',
  'adnxs',
  'outbrain',
  'taboola',
  'criteo',
  '2mdn.net',
  'adsafeprotected',
  'scorecardresearch',
  'facebook.com/tr',
];

/**
 * Bild-URL aus RSS/Atom-Item (enclosure, itunes, media:*), nur https.
 * @param {any} it rss-parser item
 * @param {string} baseUrl Artikel-URL für relative Pfade
 */
export function extractRssItemImage(it, baseUrl) {
  const base = String(baseUrl || '').trim();
  /** @param {string | undefined} raw */
  const norm = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    try {
      const u = new URL(s, base || undefined);
      if (u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  };

  const enc = it?.enclosure;
  if (enc) {
    const arr = Array.isArray(enc) ? enc : [enc];
    for (const e of arr) {
      const u = e?.url || e?.href;
      const type = String(e?.type || '').toLowerCase();
      if (!u) continue;
      if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(String(u))) {
        const n = norm(u);
        if (n) return n;
      }
    }
  }

  const itunes = it?.itunes;
  if (itunes?.image) {
    const im = itunes.image;
    const href = typeof im === 'string' ? im : im?.href || im?.$?.href;
    const n = norm(href);
    if (n) return n;
  }

  const mc = it?.['media:content'];
  if (mc) {
    const arr = Array.isArray(mc) ? mc : [mc];
    for (const m of arr) {
      const medium = String(m?.$?.medium || m?.medium || '').toLowerCase();
      const u = m?.$?.url || m?.url;
      if (medium === 'image' && u) {
        const n = norm(u);
        if (n) return n;
      }
    }
  }

  const mt = it?.['media:thumbnail'];
  if (mt) {
    const arr = Array.isArray(mt) ? mt : [mt];
    for (const m of arr) {
      const u = m?.$?.url || m?.url;
      const n = norm(u);
      if (n) return n;
    }
  }

  return null;
}

/**
 * og:image / twitter:image Host darf nicht wie Werbenetzwerk aussehen und soll zur Artikel-Site passen.
 * @param {string} articleUrl
 * @param {string} imageUrl
 */
export function isSafePreviewImageForArticle(articleUrl, imageUrl) {
  const a = parseHttpsUrl(articleUrl);
  const i = parseHttpsUrl(imageUrl);
  if (!a || !i) return false;
  const ah = a.hostname.toLowerCase();
  const ih = i.hostname.toLowerCase();
  if (AD_HOST_MARKERS.some((m) => ih.includes(m))) return false;
  if (ih === ah) return true;
  if (ih.endsWith(`.${ah}`)) return true;
  return false;
}

/**
 * @param {string} html
 */
function extractOgImageFromHtml(html) {
  const h = String(html || '').slice(0, OG_HTML_MAX_CHARS);
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = h.match(re);
    if (m?.[1]) {
      const raw = m[1].trim().replace(/&amp;/g, '&');
      if (raw) return raw;
    }
  }
  return null;
}

/**
 * Nur wenn Artikel-URL auf der Feed-Allowlist liegt (wie RSS-Quellen): minimales HTML holen und og:image lesen.
 * @param {import('@libsql/client').Client} db
 * @param {string} articleUrl
 */
export async function fetchOgPreviewImage(db, articleUrl) {
  const u = parseHttpsUrl(articleUrl);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (await isHostBlockedDb(db, host)) return null;
  const cl = await classifyRssUrl(db, articleUrl);
  if (!cl.autoIngest) return null;

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), OG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(articleUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': 'SaShBlogTopicFeed/1.0 (+https://github.com)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
    });
    if (!res.ok) return null;
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    const text = await res.text();
    const rawOg = extractOgImageFromHtml(text);
    if (!rawOg) return null;
    let imgUrl;
    try {
      imgUrl = new URL(rawOg, articleUrl).href;
    } catch {
      return null;
    }
    const img = parseHttpsUrl(imgUrl);
    if (!img) return null;
    if (!isSafePreviewImageForArticle(articleUrl, img.toString())) return null;
    if (await isHostBlockedDb(db, img.hostname)) return null;
    return img.toString();
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}
