import { getUsernameFromCookies } from '../../../lib/session.js';
import { SUPERUSER } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { isValidGraphShape } from '../../../lib/rpg-quest-graph.js';
import { saveRpgState } from '../../../lib/rpg-state-db.js';
import {
  RPG_PAYLOAD_SCHEMA_VERSION,
  coerceRpgPayloadSchemaVersion,
} from '../../../lib/rpg-payload-schema.js';
import { normalizeRpgVitalsState } from '../../../lib/rpg-vitals.js';
import { normalizeRpgLocationCatalog, normalizeRpgLocationState } from '../../../lib/rpg-location.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/rpg/quests-import
 * Superuser-only Restore-Endpoint: schreibt einen vollständigen RPG-Payload
 * für einen Zieluser in rpg_user_state.
 *
 * Body:
 * {
 *   "username"?: "optional-target-user",
 *   "payload": {
 *     "graph": { "quests": [...], "edges": [...] },
 *     "addedIds": [...],
 *     "stepDone": { ... },
 *     ...weitere optionale Felder
 *   }
 * }
 */
export async function POST({ request, cookies }) {
  const actor = await getUsernameFromCookies(cookies);
  if (!actor || actor !== SUPERUSER) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetUsername =
    typeof body?.username === 'string' && body.username.trim() ? body.username.trim() : actor;
  const incoming = body?.payload;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return new Response(JSON.stringify({ error: 'payload fehlt oder ist ungültig' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!isValidGraphShape(incoming.graph)) {
    return new Response(JSON.stringify({ error: 'payload.graph ist ungültig' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!Array.isArray(incoming.addedIds)) {
    return new Response(JSON.stringify({ error: 'payload.addedIds fehlt oder ist ungültig' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!incoming.stepDone || typeof incoming.stepDone !== 'object' || Array.isArray(incoming.stepDone)) {
    return new Response(JSON.stringify({ error: 'payload.stepDone fehlt oder ist ungültig' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = {
    ...incoming,
    graph: {
      ...incoming.graph,
      quests: incoming.graph.quests,
      edges: incoming.graph.edges,
    },
    addedIds: incoming.addedIds.filter((x) => typeof x === 'string'),
    stepDone: incoming.stepDone,
    vitals: normalizeRpgVitalsState(incoming.vitals),
    location: normalizeRpgLocationState(incoming.location),
    locationCatalog: normalizeRpgLocationCatalog(incoming.locationCatalog),
    schemaVersion: Math.max(
      RPG_PAYLOAD_SCHEMA_VERSION,
      coerceRpgPayloadSchemaVersion(incoming.schemaVersion)
    ),
  };

  await ensureDbSchema();
  await saveRpgState(targetUsername, payload);

  return new Response(
    JSON.stringify({
      ok: true,
      username: targetUsername,
      questCount: Array.isArray(payload.graph.quests) ? payload.graph.quests.length : 0,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
