import { getUsernameFromCookies } from '../../../../../lib/session.js';
import { addUserFeedPin, getFeedDetailBundle } from '../../../../../lib/feed-db.js';
import { parseHttpsUrl, classifyRssUrl } from '../../../../../lib/feed-policy.js';
import { ensureDbSchema, getDb } from '../../../../../lib/db.js';

function parseId(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET({ params, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const feedId = parseId(params.id);
  if (!feedId) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const bundle = await getFeedDetailBundle(username, feedId);
  if (!bundle) {
    return new Response(JSON.stringify({ error: 'Nicht gefunden' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ pins: bundle.pins }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ params, request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username) {
    return new Response(JSON.stringify({ error: 'Nicht eingeloggt' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const feedId = parseId(params.id);
  if (!feedId) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), {
      status: 400,
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

  const rawUrl = String(body?.url || '').trim();
  const u = parseHttpsUrl(rawUrl);
  if (!u) {
    return new Response(JSON.stringify({ error: 'Nur gültige https-URLs.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const urlStr = u.toString();

  await ensureDbSchema();
  const db = getDb();
  const cl = await classifyRssUrl(db, urlStr);
  if (!cl.autoIngest && !body?.acknowledge_untrusted) {
    return new Response(
      JSON.stringify({
        error: 'Domain nicht auf der Vertrauensliste.',
        detail: 'Mit acknowledge_untrusted: true bestätigen, dass du die Quelle selbst verantwortest.',
        needs_ack: true,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const pinId = await addUserFeedPin(username, feedId, {
      url: urlStr,
      title_override: body?.title_override,
      note: body?.note,
    });
    return new Response(JSON.stringify({ ok: true, pinId }), {
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
