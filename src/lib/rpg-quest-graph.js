/**
 * Graph-Operationen: Unlock-Pruefung, Fortschritt, Upsert, Zyklen-Erkennung.
 * Layout-Code liegt in rpg-graph-layout.js.
 */
import {
  questProgressFromNodes,
  isQuestCompletedFromNodes,
  walkNodesPreOrder,
  nodeIsLeaf,
  questLeafProgressRatio,
} from './rpg-quest-nodes.js';
import { graphNodes, makeRpgGraph, graphEdges } from './rpg-quests-data.js';

/** @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode */
/** @typedef {import('./rpg-quests-data.js').RpgEdge} RpgEdge */
/** @typedef {import('./rpg-quests-data.js').RpgGraph} RpgGraph */

const RPG_GRAPH_WARNED_KEYS = new Set();
function warnGraphOnce(key, message, details) {
  if (RPG_GRAPH_WARNED_KEYS.has(key)) return;
  RPG_GRAPH_WARNED_KEYS.add(key);
  console.warn(`[rpg:graph] ${message}`, details);
}

/**
 * Prueft ob ein Objekt die Grundform eines Graphen hat.
 * Akzeptiert auch Legacy-Formate (quests, nodesById).
 * @param {unknown} g
 * @returns {g is RpgGraph}
 */
export function isValidGraphShape(g) {
  return (
    !!g &&
    typeof g === 'object' &&
    (Array.isArray(/** @type {any} */ (g).nodes) ||
      Array.isArray(/** @type {any} */ (g).quests) ||
      (!!/** @type {any} */ (g).nodesById && typeof /** @type {any} */ (g).nodesById === 'object')) &&
    Array.isArray(/** @type {any} */ (g).edges)
  );
}

/**
 * Sammelt alle transitiv verbundenen Node-IDs fuer aggregierten Fortschritt.
 * @param {RpgGraph} graph
 * @param {string} questId
 * @returns {string[]}
 */
function collectQuestIdsForAggregatedProgress(graph, questId) {
  const incoming = buildIncomingMap(graph);
  /** @type {Set<string>} */
  const out = new Set();

  // Aufwaerts: alle Vorgaenger
  const up = [questId];
  const seenUp = new Set([questId]);
  while (up.length) {
    const id = up.pop();
    if (typeof id !== 'string') continue;
    out.add(id);
    for (const pred of incoming.get(id) || []) {
      if (!seenUp.has(pred)) {
        seenUp.add(pred);
        up.push(pred);
      }
    }
  }

  // Abwaerts: alle Nachfolger
  const down = [questId];
  const seenDown = new Set([questId]);
  while (down.length) {
    const id = down.pop();
    if (typeof id !== 'string') continue;
    out.add(id);
    for (const e of graphEdges(graph)) {
      if (e.relation === 'structure') continue;
      if (e.from === id && !seenDown.has(e.to)) {
        seenDown.add(e.to);
        down.push(e.to);
      }
    }
  }

  return [...out];
}

/**
 * Aggregierter Fortschritt ueber alle transitiv verbundenen Nodes.
 * @param {RpgGraph} graph
 * @param {RpgNode} quest
 * @param {Record<string, Record<string, boolean>>} nodeDone
 */
export function questLeafProgressRatioAggregated(graph, quest, nodeDone) {
  const ids = collectQuestIdsForAggregatedProgress(graph, quest.id);
  const qmap = questMap(graph);
  let total = 0;
  let done = 0;
  for (const qid of ids) {
    const q = qmap.get(qid);
    if (!q) continue;
    const r = questLeafProgressRatio(q, nodeDone);
    total += r.total;
    done += r.done;
  }
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * Fortschritt: mit Graph = aggregiert, ohne = nur lokale Children.
 * @param {RpgNode} quest
 * @param {Record<string, Record<string, boolean>>} nodeDone
 * @param {RpgGraph | null | undefined} [graph]
 */
export function questProgress(quest, nodeDone, graph) {
  if (!graph || graphNodes(graph).length === 0) return questProgressFromNodes(quest, nodeDone);
  return questLeafProgressRatioAggregated(graph, quest, nodeDone).percent;
}

/**
 * @param {RpgNode} quest
 * @param {Record<string, Record<string, boolean>>} nodeDone
 */
export function isQuestCompleted(quest, nodeDone) {
  return isQuestCompletedFromNodes(quest, nodeDone);
}

/**
 * Baut eine Map: Node-ID -> Liste eingehender Node-IDs (nur dependency-Kanten).
 * @param {RpgGraph} graph
 * @returns {Map<string, string[]>}
 */
export function buildIncomingMap(graph) {
  /** @type {Map<string, string[]>} */
  const incoming = new Map();
  const knownIds = new Set();
  for (const q of graphNodes(graph)) {
    incoming.set(q.id, []);
    knownIds.add(q.id);
  }
  for (const e of graphEdges(graph)) {
    if (e.relation === 'structure') continue;
    if (!knownIds.has(e.from) || !knownIds.has(e.to)) {
      warnGraphOnce(`danglingEdge.${e.from}->${e.to}`, 'Dangling edge references missing node id', e);
    }
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }
  return incoming;
}

/**
 * Prueft ob ein Node freigeschaltet ist (alle Vorgaenger erledigt).
 * @param {string} questId
 * @param {RpgGraph} graph
 * @param {Record<string, Record<string, boolean>>} nodeDone
 * @param {Map<string, RpgNode>} byId
 */
export function isQuestUnlocked(questId, graph, nodeDone, byId) {
  const incoming = buildIncomingMap(graph);
  const preds = incoming.get(questId) || [];
  if (preds.length === 0) return true;
  for (const p of preds) {
    const pq = byId.get(p);
    if (!pq || !isQuestCompleted(pq, nodeDone)) return false;
  }
  return true;
}

/**
 * Filtert added-IDs: nur behalten wenn unlocked und nicht completed.
 * @param {Set<string>} added
 * @param {RpgGraph} graph
 * @param {Record<string, Record<string, boolean>>} nodeDone
 */
export function sanitizeAddedIds(added, graph, nodeDone) {
  const byId = questMap(graph);
  const next = new Set();
  for (const id of added) {
    const q = byId.get(id);
    if (!q) continue;
    if (isQuestCompleted(q, nodeDone)) continue;
    if (!isQuestUnlocked(id, graph, nodeDone, byId)) continue;
    next.add(id);
  }
  return next;
}

/**
 * Alle Root-Nodes als Map (id -> Node).
 * @param {RpgGraph} graph
 * @returns {Map<string, RpgNode>}
 */
export function questMap(graph) {
  /** @type {Map<string, RpgNode>} */
  const m = new Map();
  for (const q of graphNodes(graph)) m.set(q.id, q);
  return m;
}

/**
 * Fuegt einen Node in den Graph ein oder aktualisiert ihn.
 * @param {RpgGraph} graph
 * @param {RpgNode} node
 * @param {string[]} prerequisiteIds — Dependency-Kanten from -> node.id
 */
export function upsertQuestInGraph(graph, node, prerequisiteIds) {
  const ids = new Set((prerequisiteIds || []).filter((x) => typeof x === 'string'));
  ids.delete(node.id);
  const prev = graphNodes(graph).find((q) => q.id === node.id);
  const mergedNode =
    prev && typeof prev === 'object' ? { ...prev, ...node } : node;
  // Legacy-Feld 'questRewards' entfernen wenn neues 'rewards' vorhanden
  if (Array.isArray(mergedNode.rewards)) {
    delete /** @type {any} */ (mergedNode).questRewards;
  }
  const nodes = graphNodes(graph).filter((q) => q.id !== node.id);
  nodes.push(mergedNode);
  const edges = graphEdges(graph).filter((e) => e.relation === 'structure' || e.to !== node.id);
  for (const from of ids) {
    if (nodes.some((q) => q.id === from)) {
      edges.push({ from, to: node.id, relation: 'dependency' });
    }
  }
  return makeRpgGraph(nodes, edges);
}

/**
 * Entfernt einen Node und alle seine Kanten aus dem Graph.
 * @param {RpgGraph} graph
 * @param {string} questId
 */
export function removeQuestFromGraph(graph, questId) {
  const nodes = graphNodes(graph).filter((q) => q.id !== questId);
  const edges = graphEdges(graph).filter((e) => e.from !== questId && e.to !== questId);
  return makeRpgGraph(nodes, edges);
}

/**
 * Baut die initiale nodeDone-Map aus dem Graph (Blaetter mit done: true).
 * @param {RpgGraph} graph
 */
export function buildInitialNodeMapFromGraph(graph) {
  /** @type {Record<string, Record<string, boolean>>} */
  const m = {};
  for (const q of graphNodes(graph)) {
    m[q.id] = {};
    walkNodesPreOrder(q.children || [], (s) => {
      if (nodeIsLeaf(s) && s.done) m[q.id][s.id] = true;
    });
  }
  return m;
}

/**
 * Merged server-base nodeDone mit lokal persistierten Aenderungen.
 * @param {Record<string, Record<string, boolean>>} serverBase
 * @param {Record<string, Record<string, boolean>>} persisted
 */
export function mergeNodeDoneBase(serverBase, persisted) {
  const out = { ...serverBase };
  for (const qid of Object.keys(persisted)) {
    out[qid] = { ...(out[qid] || {}), ...persisted[qid] };
  }
  return out;
}

/**
 * Prueft ob ein nodeDone-Objekt die erwartete Form hat:
 * Record<string, Record<string, boolean>>.
 * Akzeptiert leere Objekte und ignoriert unbekannte Keys,
 * aber lehnt nicht-Object/nicht-boolean Werte ab.
 * @param {unknown} raw
 * @returns {{ ok: true; value: Record<string, Record<string, boolean>> } | { ok: false; reason: string }}
 */
export function validateNodeDone(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'nodeDone muss ein Objekt sein' };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  for (const qid of Object.keys(obj)) {
    const inner = obj[qid];
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      return { ok: false, reason: `nodeDone["${qid}"] muss ein Objekt sein` };
    }
    const innerObj = /** @type {Record<string, unknown>} */ (inner);
    for (const nid of Object.keys(innerObj)) {
      if (typeof innerObj[nid] !== 'boolean') {
        return { ok: false, reason: `nodeDone["${qid}"]["${nid}"] muss boolean sein` };
      }
    }
  }
  return { ok: true, value: /** @type {Record<string, Record<string, boolean>>} */ (raw) };
}

/**
 * Prueft ob der Graph einen Zyklus hat (nur dependency-Kanten).
 * @param {RpgGraph} graph
 */
export function graphHasCycle(graph) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const q of graphNodes(graph)) out.set(q.id, []);
  for (const e of graphEdges(graph)) {
    if (e.relation === 'structure') continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const visiting = new Set();
  const done = new Set();
  /** @param {string} id */
  function dfs(id) {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const v of out.get(id) || []) {
      if (dfs(v)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  }
  for (const id of out.keys()) {
    if (dfs(id)) return true;
  }
  return false;
}
