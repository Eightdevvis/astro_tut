import { getUsernameFromCookies } from '../../../lib/session.js';
import { hasPermission } from '../../../lib/permissions.js';
import { ensureDbSchema } from '../../../lib/db.js';
import { getRpgState } from '../../../lib/rpg-state-db.js';
import { isValidGraphShape } from '../../../lib/rpg-quest-graph.js';
import { graphNodes, graphEdges, makeRpgGraph } from '../../../lib/rpg-quests-data.js';
import { migrateRpgGraphToV2 } from '../../../lib/rpg-quest-nodes.js';
import { migrateRpgGraphToV3 } from '../../../lib/rpg-payload-schema.js';
import { validateRpgGraphReferences } from '../../../lib/rpg-graph-validation.js';

function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * @param {import('../../../lib/rpg-quests-data.js').RpgNode[]} roots
 * @returns {Map<string, string>}
 */
function collectNodeTitles(roots) {
  /** @type {Map<string, string>} */
  const byId = new Map();
  /** @type {Array<import('../../../lib/rpg-quests-data.js').RpgNode>} */
  const stack = Array.isArray(roots) ? [...roots] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    if (id && !byId.has(id)) byId.set(id, typeof node.title === 'string' ? node.title.trim() : '');
    if (Array.isArray(node.children) && node.children.length > 0) stack.push(...node.children);
  }
  return byId;
}

/**
 * GET /api/rpg/quests-validate
 * Prüft den gespeicherten Quest-Graph auf strukturelle Rückstände:
 * - verwaiste Kanten (from/to ohne existierende Node)
 * - Nodes ohne Titel
 * - optionale Textsuche im Roh-Payload (needle)
 *
 * Query:
 * - username?: string (nur mit super_access, sonst eigener User)
 * - needle?: string (optional, default: "drivers license")
 */
export async function GET({ cookies, url }) {
  const actor = await getUsernameFromCookies(cookies);
  const hasRpgAccess = actor ? await hasPermission(actor, 'rpg_access') : false;
  if (!actor || !hasRpgAccess) return forbidden();

  const requestedUser = typeof url?.searchParams?.get('username') === 'string'
    ? url.searchParams.get('username').trim()
    : '';
  const targetUsername = requestedUser || actor;
  if (targetUsername !== actor) {
    const hasSuper = await hasPermission(actor, 'super_access');
    if (!hasSuper) return forbidden();
  }

  const needleRaw = typeof url?.searchParams?.get('needle') === 'string'
    ? url.searchParams.get('needle')
    : '';
  const needle = String(needleRaw || 'drivers license').trim().toLowerCase();

  await ensureDbSchema();
  const stored = await getRpgState(targetUsername);
  if (!stored) {
    return new Response(
      JSON.stringify({
        ok: true,
        username: targetUsername,
        persisted: false,
        message: 'Kein gespeicherter RPG-State für diesen User.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawGraph = stored.graph;
  if (!isValidGraphShape(rawGraph)) {
    return new Response(
      JSON.stringify({
        ok: false,
        username: targetUsername,
        persisted: true,
        issues: [{ type: 'invalid_graph_shape', detail: 'payload.graph ist ungültig.' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const migrated = migrateRpgGraphToV3(migrateRpgGraphToV2(rawGraph));
  const graph = makeRpgGraph(graphNodes(migrated), graphEdges(migrated));
  const nodes = graphNodes(graph);
  const edges = graphEdges(graph);
  const titleByNodeId = collectNodeTitles(nodes);
  const nodeIds = new Set(titleByNodeId.keys());

  const orphanEdges = edges.filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));
  const missingTitleNodeIds = [...titleByNodeId.entries()]
    .filter(([, title]) => !title)
    .map(([id]) => id);
  const refCheck = validateRpgGraphReferences(graph, edges);

  /** @type {Array<{ type: string; detail: string; count?: number; sample?: unknown[] }>} */
  const issues = [];
  if (orphanEdges.length > 0) {
    issues.push({
      type: 'orphan_edges',
      detail: 'Kanten referenzieren fehlende Nodes.',
      count: orphanEdges.length,
      sample: orphanEdges.slice(0, 20),
    });
  }
  if (missingTitleNodeIds.length > 0) {
    issues.push({
      type: 'missing_titles',
      detail: 'Nodes ohne gültigen title.',
      count: missingTitleNodeIds.length,
      sample: missingTitleNodeIds.slice(0, 20),
    });
  }
  if (!refCheck.ok) {
    issues.push({
      type: 'reference_validation_failed',
      detail: refCheck.reason,
    });
  }

  const payloadText = JSON.stringify(stored);
  const payloadLower = payloadText.toLowerCase();
  const needleFound = Boolean(needle) && payloadLower.includes(needle);
  const legacyLabelFound = payloadText.includes('"label":');

  return new Response(
    JSON.stringify({
      ok: issues.length === 0,
      username: targetUsername,
      persisted: true,
      stats: {
        rootCount: nodes.length,
        edgeCount: edges.length,
        uniqueNodeCount: nodeIds.size,
      },
      searches: {
        needle,
        needleFound,
        legacyLabelFound,
      },
      issues,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
