import { graphNodes } from './rpg-quests-data.js';

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
  const idSet = new Set(quests.map((q) => q.id));
  for (const edge of edges) {
    const from = typeof edge?.from === 'string' ? edge.from.trim() : '';
    const to = typeof edge?.to === 'string' ? edge.to.trim() : '';
    if (!from || !to) return { ok: false, reason: 'Jede Kante braucht from/to als String' };
    if (!idSet.has(from) || !idSet.has(to)) {
      return { ok: false, reason: `Ungültige Kante ${from || '?'} -> ${to || '?'}: Quest-ID fehlt im Graph` };
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
  const quests = graphNodes(graph);
  const edgeCheck = validateGraphEdges(quests, edges);
  if (!edgeCheck.ok) return edgeCheck;
  return validateQuestNodeDependencies(quests);
}
