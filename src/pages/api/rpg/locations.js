import { ensureDbSchema } from '../../../lib/db.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { upsertRpgLocation } from '../../../lib/rpg-location-catalog-db.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) return forbidden();
  await ensureDbSchema();
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const kind = body?.kind === 'place' ? 'place' : 'city';
  const row = await upsertRpgLocation({
    kind,
    name: body?.name,
    description: body?.description,
    city: body?.city,
    country: body?.country,
  });
  if (!row) {
    return new Response(JSON.stringify({ error: 'Name fehlt' }), { status: 400 });
  }
  return new Response(JSON.stringify({ ok: true, location: row }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
