import { ensureDbSchema } from '../../../lib/db.js';
import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import {
  getRpgStateBackupPayload,
  listRpgStateBackups,
  saveRpgState,
} from '../../../lib/rpg-state-db.js';
import { isValidGraphShape } from '../../../lib/rpg-quest-graph.js';
import { migrateNodeDoneToFlat } from '../../../lib/rpg-quests-data.js';
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

export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  const hasRpgAccess = username ? await hasPermission(username, 'rpg_access') : false;
  if (!username || !hasRpgAccess) return forbidden();
  await ensureDbSchema();
  const backups = await listRpgStateBackups(username, 40);
  return new Response(JSON.stringify({ backups }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  const hasRpgAccess = username ? await hasPermission(username, 'rpg_access') : false;
  if (!username || !hasRpgAccess) return forbidden();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const backupId = Math.trunc(Number(body?.backupId));
  if (!Number.isFinite(backupId) || backupId <= 0) {
    return new Response(JSON.stringify({ error: 'backupId fehlt oder ist ungültig' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ensureDbSchema();
  const payload = await getRpgStateBackupPayload(username, backupId);
  if (!payload || !isValidGraphShape(payload.graph)) {
    return new Response(JSON.stringify({ error: 'Backup nicht gefunden oder ungültig' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const restored = {
    ...payload,
    graph: { nodes: (payload.graph.nodes || payload.graph.quests || []), edges: (payload.graph.edges || []) },
    addedIds: Array.isArray(payload.addedIds) ? payload.addedIds.filter((x) => typeof x === 'string') : [],
    // Phase 2: Backup-Payload kann V2-verschachtelt sein. Beim Restore flach machen.
    nodeDone: migrateNodeDoneToFlat(payload.nodeDone),
    vitals: normalizeRpgVitalsState(payload.vitals),
    location: normalizeRpgLocationState(payload.location),
    locationCatalog: normalizeRpgLocationCatalog(payload.locationCatalog),
    schemaVersion: Math.max(
      RPG_PAYLOAD_SCHEMA_VERSION,
      coerceRpgPayloadSchemaVersion(payload.schemaVersion)
    ),
  };
  await saveRpgState(username, restored);
  return new Response(JSON.stringify({ ok: true, backupId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
