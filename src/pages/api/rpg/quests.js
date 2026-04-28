import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { EMPTY_RPG_GRAPH } from '../../../lib/rpg-quests-data.js';
import { graphNodes, makeRpgGraph, graphEdges } from '../../../lib/rpg-quests-data.js';
import { getRpgState, saveRpgState, deleteRpgState } from '../../../lib/rpg-state-db.js';
import { isValidGraphShape, validateNodeDone } from '../../../lib/rpg-quest-graph.js';
import {
  RPG_PAYLOAD_SCHEMA_VERSION,
  coerceRpgPayloadSchemaVersion,
} from '../../../lib/rpg-payload-schema.js';
import { migrateRpgGraphToV2 } from '../../../lib/rpg-quest-nodes.js';
import { normalizeRpgVitalsState } from '../../../lib/rpg-vitals.js';
import {
  collectAllItemIdsFromGraph,
  normalizeQuestmakerCatalogPayloadItem,
} from '../../../lib/rpg-questmaker-sync.js';
import { listRpgLocations, upsertRpgLocation } from '../../../lib/rpg-location-catalog-db.js';
import {
  normalizeRpgLocationCatalog,
  collectLocationEntriesFromGraph,
  normalizeRpgLocationState,
  normalizeRpgUserLocationRows,
  resolveRpgUserPickerLocations,
} from '../../../lib/rpg-location.js';
import { validateRpgGraphReferences } from '../../../lib/rpg-graph-validation.js';
import {
  listQuestmakerCatalogRows,
  upsertQuestmakerCatalogItems,
} from '../../../lib/rpg-questmaker-catalog-db.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/rpg/quests — Graph + addedIds + nodeDone (rpg_access), aus DB oder Default.
 */
export async function GET({ cookies }) {
  const username = await getUsernameFromCookies(cookies);
  const hasRpgAccess = username ? await hasPermission(username, 'rpg_access') : false;
  if (!username || !hasRpgAccess) {
    return forbidden();
  }

  await ensureDbSchema();
  const stored = await getRpgState(username);
  let graph = EMPTY_RPG_GRAPH;
  let addedIds = [];
  let nodeDone = {};
  let persisted = false;
  let vitals = normalizeRpgVitalsState(null);
  let location = normalizeRpgLocationState(null);
  let locationCatalog = normalizeRpgLocationCatalog(null);

  let schemaVersion = RPG_PAYLOAD_SCHEMA_VERSION;
  if (stored && isValidGraphShape(stored.graph)) {
    graph = /** @type {typeof EMPTY_RPG_GRAPH} */ (
      makeRpgGraph(graphNodes(stored.graph), graphEdges(stored.graph))
    );
    persisted = true;
    schemaVersion = coerceRpgPayloadSchemaVersion(stored.schemaVersion);
    if (Array.isArray(stored.addedIds)) addedIds = stored.addedIds.filter((x) => typeof x === 'string');
    const nodeDoneRaw = stored.nodeDone;
    if (nodeDoneRaw && typeof nodeDoneRaw === 'object') nodeDone = nodeDoneRaw;
    vitals = normalizeRpgVitalsState(stored.vitals);
    location = normalizeRpgLocationState(stored.location);
    locationCatalog = normalizeRpgLocationCatalog(stored.locationCatalog);
  }

  graph = migrateRpgGraphToV2(graph);
  schemaVersion = Math.max(schemaVersion, RPG_PAYLOAD_SCHEMA_VERSION);

  const questmakerItems = await listQuestmakerCatalogRows();
  const globalLocs = await listRpgLocations();
  const locations = resolveRpgUserPickerLocations(
    stored
      ? { locationCatalog: stored.locationCatalog, locations: stored.locations }
      : null,
    globalLocs
  );

  return new Response(
    JSON.stringify({
      graph: makeRpgGraph(graphNodes(graph), graphEdges(graph)),
      addedIds,
      nodeDone,
      vitals,
      location,
      locationCatalog,
      locations,
      persisted,
      schemaVersion,
      questmakerItems,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * PUT /api/rpg/quests — vollen RPG-State speichern oder auf Default zurücksetzen.
 * Body: { resetToDefault?: true } | { graph, addedIds, nodeDone, questmakerItems?: unknown[] }
 */
export async function PUT({ request, cookies }) {
  const username = await getUsernameFromCookies(cookies);
  const hasRpgAccess = username ? await hasPermission(username, 'rpg_access') : false;
  if (!username || !hasRpgAccess) {
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

  const nodes = graphNodes(body.graph);
  const questIds = nodes.map((/** @type {{ id?: unknown }} */ q) => q?.id);
  if (questIds.some((x) => typeof x !== 'string' || !x.trim())) {
    return new Response(JSON.stringify({ error: 'Jede Quest braucht eine nicht-leere id' }), { status: 400 });
  }
  const idSet = new Set(questIds);
  if (idSet.size !== questIds.length) {
    return new Response(JSON.stringify({ error: 'Doppelte Quest-IDs im Graph' }), { status: 400 });
  }
  const edges = graphEdges(body.graph);
  const refCheck = validateRpgGraphReferences(body.graph, edges);
  if (!refCheck.ok) {
    return new Response(JSON.stringify({ error: refCheck.reason }), { status: 400 });
  }
  if (!Array.isArray(body.addedIds)) {
    return new Response(JSON.stringify({ error: 'addedIds fehlt' }), { status: 400 });
  }
  const nodeDoneCheck = validateNodeDone(body.nodeDone);
  if (!nodeDoneCheck.ok) {
    return new Response(JSON.stringify({ error: nodeDoneCheck.reason }), { status: 400 });
  }
  const nodeDoneRaw = nodeDoneCheck.value;
  const vitals = normalizeRpgVitalsState(body.vitals);
  const location = normalizeRpgLocationState(body.location);
  let locationCatalog = normalizeRpgLocationCatalog(body.locationCatalog);

  const addedIds = body.addedIds.filter((/** @type {unknown} */ x) => typeof x === 'string');

  const existing = await getRpgState(username);
  const existingQuestCount = graphNodes(existing?.graph).length;
  const nextQuestCount = nodes.length;
  if (existingQuestCount > 0 && nextQuestCount === 0) {
    return new Response(
      JSON.stringify({
        error:
          'Sicherheitsabbruch: Leerer Graph würde bestehenden Quest-Baum überschreiben. Nutze resetToDefault für bewusstes Löschen.',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const normalizedGraph = makeRpgGraph(nodes, edges);
  const payload = {
    ...base,
    graph: {
      nodes: normalizedGraph.nodes,
      edges: normalizedGraph.edges,
    },
    addedIds,
    nodeDone: nodeDoneRaw,
    vitals,
    location,
    locationCatalog,
    locations: Array.isArray(body.locations)
      ? normalizeRpgUserLocationRows(body.locations)
      : normalizeRpgUserLocationRows(base.locations),
    schemaVersion: Math.max(
      RPG_PAYLOAD_SCHEMA_VERSION,
      coerceRpgPayloadSchemaVersion(base.schemaVersion)
    ),
  };

  const rawQm = Array.isArray(body.questmakerItems) ? body.questmakerItems : [];
  /** @type {Map<string, { id: string; category: string; title: string; description: string }>} */
  const proposedMap = new Map();
  for (const raw of rawQm) {
    const row = normalizeQuestmakerCatalogPayloadItem(raw);
    if (row) proposedMap.set(row.id, row);
  }

  const existingRows = await listQuestmakerCatalogRows();
  const existingIds = new Set(existingRows.map((r) => r.id));
  const needed = collectAllItemIdsFromGraph(normalizedGraph);
  /** @type {string[]} */
  const missing = [];
  for (const id of needed) {
    if (existingIds.has(id)) continue;
    if (!proposedMap.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({
        error:
          'Für im Graph referenzierte Item-IDs fehlen vollständige Katalog-Einträge (category, title, description).',
        missing,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const toUpsert = [...proposedMap.values()].filter((row) => needed.has(row.id));
  await upsertQuestmakerCatalogItems(toUpsert);

  const graphLocations = collectLocationEntriesFromGraph(normalizedGraph);
  for (const loc of graphLocations) {
    const row = await upsertRpgLocation(loc);
    if (!row) continue;
    if (row.kind === 'country') locationCatalog.countryIds.push(row.id);
    else if (row.kind === 'city') locationCatalog.cityIds.push(row.id);
    else locationCatalog.placeIds.push(row.id);
  }
  locationCatalog = normalizeRpgLocationCatalog(locationCatalog);
  payload.locationCatalog = locationCatalog;

  await saveRpgState(username, payload);

  const questmakerItems = await listQuestmakerCatalogRows();
  const globalLocsAfter = await listRpgLocations();
  const locations = resolveRpgUserPickerLocations(
    { locationCatalog: payload.locationCatalog, locations: payload.locations },
    globalLocsAfter
  );

  return new Response(JSON.stringify({ ok: true, questmakerItems, locations, locationCatalog }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
