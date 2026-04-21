import { getUsernameFromCookies } from '../../../../../../lib/session.js';
import { deleteUserFeedPin } from '../../../../../../lib/feed-db.js';

function parseId(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const pinId = parseId(params.pinId);
  if (!feedId || !pinId) {
    return new Response(JSON.stringify({ error: 'Ungültige ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const ok = await deleteUserFeedPin(username, feedId, pinId);
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
