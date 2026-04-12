import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import {
  listQuestmakerCatalogRows,
  replaceQuestmakerCatalog,
} from '../../../lib/rpg-questmaker-catalog-db.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/rpg/questmaker-items — Katalog (Superuser).
 */
export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) return forbidden();

  await ensureDbSchema();
  const items = await listQuestmakerCatalogRows();
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * PUT /api/rpg/questmaker-items — Katalog ersetzen (Superuser).
 * Body: { items: { id, category?, title, description? }[] }
 */
export async function PUT({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body || !Array.isArray(body.items)) {
    return new Response(JSON.stringify({ error: 'items[] erforderlich' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ensureDbSchema();
  await replaceQuestmakerCatalog(body.items);
  const items = await listQuestmakerCatalogRows();

  return new Response(JSON.stringify({ ok: true, items }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
