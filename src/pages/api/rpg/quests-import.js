import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { isValidGraphShape, validateNodeDone } from '../../../lib/rpg-quest-graph.js';
import { migrateNodeDoneToFlat } from '../../../lib/rpg-quests-data.js';
import { validateRpgGraphReferences } from '../../../lib/rpg-graph-validation.js';
import { saveRpgState } from '../../../lib/rpg-state-db.js';
import {
  RPG_PAYLOAD_SCHEMA_VERSION,
  coerceRpgPayloadSchemaVersion,
} from '../../../lib/rpg-payload-schema.js';
import { normalizeRpgVitalsState } from '../../../lib/rpg-vitals.js';
import { normalizeRpgLocationCatalog, normalizeRpgLocationState } from '../../../lib/rpg-location.js';
import { graphNodes, graphEdges } from '../../../lib/rpg-quests-data.js';

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
 *     "graph": { "nodes": [...], "edges": [...] },
 *     "addedIds": [...],
 *     "nodeDone": { ... },
 *     ...weitere optionale Felder
 *   }
 * }
 */
export async function POST({ request, cookies }) {
  const actor = await getUsernameFromCookies(cookies);
  if (!actor || !(await hasPermission(actor, 'super_access'))) return forbidden();

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
  // Graph-Referenzen pruefen: Edges muessen auf existierende Nodes zeigen,
  // dependsOn-IDs muessen innerhalb des jeweiligen Quests existieren.
  const refCheck = validateRpgGraphReferences(incoming.graph, graphEdges(incoming.graph));
  if (!refCheck.ok) {
    return new Response(JSON.stringify({ error: refCheck.reason }), {
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
  // Phase 2: Alt-Backups koennten verschachtelten nodeDone-State enthalten.
  // Vor Validate flach machen (idempotent fuer V3).
  const flattenedIncoming = migrateNodeDoneToFlat(incoming.nodeDone);
  const nodeDoneCheck = validateNodeDone(flattenedIncoming);
  if (!nodeDoneCheck.ok) {
    return new Response(JSON.stringify({ error: nodeDoneCheck.reason }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const nodeDoneRaw = nodeDoneCheck.value;

  const payload = {
    ...incoming,
    graph: {
      nodes: graphNodes(incoming.graph),
      edges: graphEdges(incoming.graph),
    },
    addedIds: incoming.addedIds.filter((x) => typeof x === 'string'),
    nodeDone: nodeDoneRaw,
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
      questCount: graphNodes(payload.graph).length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
