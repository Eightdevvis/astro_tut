import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { SAMPLE_RPG_QUESTS, SAMPLE_RPG_GRAPH } from '../../../lib/rpg-quests-data.js';
import { getRpgState, saveRpgState, deleteRpgState } from '../../../lib/rpg-state-db.js';
import { isValidGraphShape } from '../../../lib/rpg-quest-graph.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/rpg/quests — Graph + addedIds + stepDone (Superuser), aus DB oder Default.
 */
export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return forbidden();
  }

  await ensureDbSchema();
  const stored = await getRpgState(username);
  let graph = SAMPLE_RPG_GRAPH;
  let addedIds = [];
  let stepDone = {};
  let persisted = false;

  if (stored && isValidGraphShape(stored.graph)) {
    graph = /** @type {typeof SAMPLE_RPG_GRAPH} */ (stored.graph);
    persisted = true;
    if (Array.isArray(stored.addedIds)) addedIds = stored.addedIds.filter((x) => typeof x === 'string');
    if (stored.stepDone && typeof stored.stepDone === 'object') stepDone = stored.stepDone;
  }

  return new Response(
    JSON.stringify({
      ...SAMPLE_RPG_QUESTS,
      graph,
      addedIds,
      stepDone,
      persisted,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * PUT /api/rpg/quests — vollen RPG-State speichern oder auf Default zurücksetzen.
 * Body: { resetToDefault?: true } | { graph, addedIds, stepDone }
 */
export async function PUT({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || username !== SUPERUSER) {
    return forbidden();
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  await ensureDbSchema();

  if (body?.resetToDefault === true) {
    await deleteRpgState(username);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isValidGraphShape(body?.graph)) {
    return new Response(JSON.stringify({ error: 'Ungültiger graph' }), { status: 400 });
  }
  if (!Array.isArray(body.addedIds)) {
    return new Response(JSON.stringify({ error: 'addedIds fehlt' }), { status: 400 });
  }
  if (!body.stepDone || typeof body.stepDone !== 'object') {
    return new Response(JSON.stringify({ error: 'stepDone fehlt' }), { status: 400 });
  }

  const addedIds = body.addedIds.filter((/** @type {unknown} */ x) => typeof x === 'string');
  const payload = {
    graph: {
      quests: body.graph.quests,
      edges: body.graph.edges,
    },
    addedIds,
    stepDone: body.stepDone,
  };

  await saveRpgState(username, payload);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
