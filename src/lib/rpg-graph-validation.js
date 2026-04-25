import { graphNodes } from './rpg-quests-data.js';

/**
 * @param {import('./rpg-quests-data.js').RpgGraphNode[]} quests
 * @returns {Set<string>}
 */
function collectGraphEntityIds(quests) {
  const ids = new Set();
  for (const quest of quests) {
    if (!quest || typeof quest.id !== 'string') continue;
    ids.add(quest.id);
    /** @type {Array<import('./rpg-quest-nodes.js').RpgQuestNode>} */
    const stack = Array.isArray(quest.children) ? [...quest.children] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const nodeId = typeof node.id === 'string' ? node.id.trim() : '';
      if (nodeId) ids.add(nodeId);
      if (Array.isArray(node.children) && node.children.length) stack.push(...node.children);
    }
  }
  return ids;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphNode[]} quests
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function validateQuestNodeDependencies(quests) {
  for (const quest of quests) {
    const ids = new Set();
    /** @type {string[]} */
    const badDepends = [];
    /** @type {string[]} */
    const duplicateIds = [];
    /** @type {Array<import('./rpg-quest-nodes.js').RpgQuestNode>} */
    const stack = Array.isArray(quest.children) ? [...quest.children] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (typeof node.id !== 'string' || !node.id.trim()) continue;
      const nodeId = node.id.trim();
      if (ids.has(nodeId)) duplicateIds.push(nodeId);
      ids.add(nodeId);
      if (Array.isArray(node.children) && node.children.length) stack.push(...node.children);
    }
    stack.push(...(Array.isArray(quest.children) ? quest.children : []));
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const rawDeps = Array.isArray(node.dependsOn) ? node.dependsOn : [];
      for (const dep of rawDeps) {
        const depId = typeof dep === 'string' ? dep.trim() : '';
        if (!depId) continue;
        if (!ids.has(depId)) badDepends.push(depId);
      }
      if (Array.isArray(node.children) && node.children.length) stack.push(...node.children);
    }
    if (duplicateIds.length) {
      return {
        ok: false,
        reason: `Quest "${quest.id}" enthält doppelte Node-IDs: ${[...new Set(duplicateIds)].join(', ')}`,
      };
    }
    if (badDepends.length) {
      return {
        ok: false,
        reason: `Quest "${quest.id}" enthält ungültige dependsOn-Referenzen: ${[...new Set(badDepends)].join(', ')}`,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphNode[]} quests
 * @param {Array<{ from?: unknown; to?: unknown }>} edges
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function validateGraphEdges(quests, edges) {
  const idSet = collectGraphEntityIds(quests);
  for (const edge of edges) {
    const from = typeof edge?.fromNodeId === 'string' ? edge.fromNodeId.trim() : '';
    const to = typeof edge?.toNodeId === 'string' ? edge.toNodeId.trim() : '';
    const relation = typeof edge?.relation === 'string' ? edge.relation.trim() : '';
    if (!from || !to) return { ok: false, reason: 'Jede Kante braucht from/to als String' };
    if (!idSet.has(from) || !idSet.has(to)) {
      return { ok: false, reason: `Ungültige Kante ${from || '?'} -> ${to || '?'}: Quest-ID fehlt im Graph` };
    }
    if (relation !== 'structure' && relation !== 'dependency') {
      return { ok: false, reason: `Ungültige Kanten-Relation bei ${from} -> ${to}` };
    }
  }
  return { ok: true };
}

/**
 * Subtree-Ansichten dürfen die Guard-Checks nie gegen pseudo-Quest-IDs ausführen.
 * @template T
 * @param {T | null | undefined} visibleNode
 * @param {T | null | undefined} guardQuest
 * @returns {T | null}
 */
export function resolveNodeGuardQuest(visibleNode, guardQuest) {
  return guardQuest || visibleNode || null;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph | null | undefined} graph
 * @param {Array<{ from?: unknown; to?: unknown }>} edges
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function validateRpgGraphReferences(graph, edges) {
  const edgeCheck = validateGraphEdges(graphNodes(graph), edges);
  if (!edgeCheck.ok) return edgeCheck;
  return validateQuestNodeDependencies(graphNodes(graph));
}
