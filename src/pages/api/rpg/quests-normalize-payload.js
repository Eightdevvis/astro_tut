import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { listAllRpgStates, saveRpgState } from '../../../lib/rpg-state-db.js';
import { isValidGraphShape } from '../../../lib/rpg-quest-graph.js';
import {
  RPG_PAYLOAD_SCHEMA_VERSION,
  coerceRpgPayloadSchemaVersion,
} from '../../../lib/rpg-payload-schema.js';
import { migrateRpgGraphToV2 } from '../../../lib/rpg-quest-steps.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/rpg/quests-normalize-payload — alle Zeilen in `rpg_user_state` auf kanonisches Graph-v2-Format schreiben
 * (`migrateRpgGraphToV2`: Steps, questRewards inkl. optional unlockAtPercent, ohne Legacy rewards).
 * Nur super_access. Idempotent wenn schon normalisiert.
 */
export async function POST({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  if (!username || !(await hasPermission(username, 'super_access'))) {
    return forbidden();
  }

  await ensureDbSchema();
  const rows = await listAllRpgStates();
  let rowsChecked = 0;
  let rowsUpdated = 0;

  for (const { username: rowUser, payload } of rows) {
    if (!payload || !isValidGraphShape(payload.graph)) continue;
    rowsChecked += 1;
    const before = JSON.stringify(payload.graph);
    const graph = migrateRpgGraphToV2(/** @type {import('../../../lib/rpg-quests-data.js').RpgGraph} */ (payload.graph));
    const after = JSON.stringify(graph);
    if (before === after) continue;
    const schemaVersion = Math.max(
      RPG_PAYLOAD_SCHEMA_VERSION,
      coerceRpgPayloadSchemaVersion(payload.schemaVersion)
    );
    await saveRpgState(rowUser, {
      ...payload,
      graph,
      schemaVersion,
    });
    rowsUpdated += 1;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      rowsChecked,
      rowsUpdated,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
