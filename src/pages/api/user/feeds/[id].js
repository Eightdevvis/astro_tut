import { getUsernameFromCookies } from '../../../../lib/session.js';
import { updateUserFeed, deleteUserFeed, reorderUserFeeds } from '../../../../lib/feed-db.js';

/**
 * @param {string | undefined} raw
 * @returns {number | null}
 */
function parseId(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PATCH({ params, request, cookies }) {
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

  if (Array.isArray(body?.feed_order)) {
    await reorderUserFeeds(
      username,
      body.feed_order.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ok = await updateUserFeed(username, feedId, {
    title: body?.title,
    sort_order: body?.sort_order,
  });
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Nicht gefunden' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE({ params, cookies }) {
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
  const ok = await deleteUserFeed(username, feedId);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Nicht gefunden' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
