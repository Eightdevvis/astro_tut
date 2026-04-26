import { getUsernameFromCookies } from '../../../../lib/session.js';
import { hasPermission } from '../../../../lib/permissions.js';
import { ensureDbSchema, getDb } from '../../../../lib/db.js';
import {
  listUserFeeds,
  createUserFeed,
  MAX_SOURCES_PER_FEED,
} from '../../../../lib/feed-db.js';
import { classifyRssUrl, parseHttpsUrl } from '../../../../lib/feed-policy.js';
import { ingestOneFeed } from '../../../../lib/feed-ingest.js';
import { maybeGenerateFeedSummary } from '../../../../lib/feed-summary-ai.js';

export async function GET({ cookies, url }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!(await hasPermission(username, 'feed_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung für Feed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const preview = url.searchParams.get('preview') === '1' || url.searchParams.get('preview') === 'true';
  const feeds = await listUserFeeds(username, { preview });
  return new Response(JSON.stringify({ feeds }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!(await hasPermission(username, 'feed_access'))) {
    return new Response(JSON.stringify({ error: 'Keine Berechtigung für Feed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Ungültiger JSON-Body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ensureDbSchema();
  const db = getDb();

  const sourcesRaw = Array.isArray(body?.sources) ? body.sources : [];
  if (sourcesRaw.length === 0) {
    return new Response(JSON.stringify({ error: 'Mindestens eine RSS-Quelle.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (sourcesRaw.length > MAX_SOURCES_PER_FEED) {
    return new Response(JSON.stringify({ error: `Maximal ${MAX_SOURCES_PER_FEED} Quellen.` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** @type {{ url: string; added_by: string; user_confirmed: boolean }[]} */
  const normalized = [];
  for (const s of sourcesRaw) {
    const rawUrl = String(s?.url || '').trim();
    const u = parseHttpsUrl(rawUrl);
    if (!u) {
      return new Response(JSON.stringify({ error: `Ungültige URL: ${rawUrl.slice(0, 80)}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const urlStr = u.toString();
    const added_by = String(s?.added_by || 'user').slice(0, 32);
    const user_confirmed = Boolean(s?.user_confirmed);
    const cl = await classifyRssUrl(db, urlStr);
    if (!cl.autoIngest && !user_confirmed) {
      return new Response(
        JSON.stringify({
          error: `Quelle nicht auf der Vertrauensliste: ${urlStr}. Bitte im Modal bestätigen oder entfernen.`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    normalized.push({ url: urlStr, added_by, user_confirmed });
  }

  try {
    const feedId = await createUserFeed(username, {
      title: body.title,
      user_prompt: body.user_prompt,
      ai_plan_json: body.ai_plan_json,
      sources: normalized,
    });
    try {
      await ingestOneFeed(feedId);
    } catch {
      /* erste Ingestion optional fehlgeschlagen */
    }
    try {
      await maybeGenerateFeedSummary(username, feedId, { force: true });
    } catch {
      /* optional */
    }
    return new Response(JSON.stringify({ ok: true, id: feedId }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
