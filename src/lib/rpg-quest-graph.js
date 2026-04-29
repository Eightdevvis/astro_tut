/**
 * Graph-Operationen: Unlock-Pruefung, Fortschritt, Upsert, Zyklen-Erkennung.
 * Layout-Code liegt in rpg-graph-layout.js.
 *
 * Phase 2 (DAG): Done-Status liest sich aus dem flachen `Record<nodeId, boolean>`
 * (RpgFlatNodeDone). Helper wie `nodeProgress`, `leafProgressRatio`,
 * `isNodeComplete`, `walkDescendants`, `findNodeAncestors` operieren direkt
 * auf `graph.edges` via parent_of-Relationen — sie kennen kein Quest-Konzept
 * mehr, jeder Node ist nur ein Node.
 */
import {
  questProgressFromNodes,
  isQuestCompletedFromNodes,
  walkNodesPreOrder,
  nodeIsLeaf,
  isLockNode,
  isNodeCompleteInQuest,
  questLeafProgressRatio,
  findNodeById,
  findNodeWithAncestors,
} from './rpg-quest-nodes.js';
import { graphNodes, makeRpgGraph, graphEdges, isParentChildRelation } from './rpg-quests-data.js';

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
  return ensureStructureEdgesFromNodes(makeRpgGraph(nodes, edges));
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
 * Baut die initiale flache nodeDone-Map aus dem Graph (Blaetter mit done: true).
 *
 * Phase 2: Output ist FLACH (Record<nodeId, boolean>) statt verschachtelt
 * pro Quest. Zur Erinnerung: Done-Flags haengen jetzt am Node selbst, nicht
 * am Quest-Kontext.
 *
 * @param {RpgGraph} graph
 * @returns {Record<string, boolean>}
 */
export function buildInitialNodeMapFromGraph(graph) {
  /** @type {Record<string, boolean>} */
  const m = {};
  for (const q of graphNodes(graph)) {
    walkNodesPreOrder(q.children || [], (s) => {
      if (nodeIsLeaf(s) && s.done) m[s.id] = true;
    });
  }
  return m;
}

/**
 * Merged server-base nodeDone mit lokal persistierten Aenderungen.
 *
 * Phase 2: arbeitet auf flachen Records. Akzeptiert auch verschachtelte
 * Eingaben (V2-Compat) — sie werden vorab via `migrateNodeDoneToFlat` flach
 * gemacht. Lokal gewinnt vor Server-Base.
 *
 * @param {Record<string, unknown>} serverBase
 * @param {Record<string, unknown>} persisted
 * @returns {Record<string, boolean>}
 */
export function mergeNodeDoneBase(serverBase, persisted) {
  // Defensive: koennte verschachtelt sein wenn ein Caller noch alte Daten reicht.
  const flatBase = flattenIfNested(serverBase);
  const flatLocal = flattenIfNested(persisted);
  return { ...flatBase, ...flatLocal };
}

/**
 * Flacht eingehendes nodeDone aus, falls es verschachtelt ist.
 * Idempotent: ein bereits flaches Objekt bleibt unveraendert.
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {Record<string, boolean>}
 */
function flattenIfNested(raw) {
  if (!raw || typeof raw !== 'object') return {};
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === true) {
      out[k] = true;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Verschachtelt: untere Ebene durchgehen
      for (const [innerK, innerV] of Object.entries(v)) {
        if (innerV === true) out[innerK] = true;
      }
    }
  }
  return out;
}

/**
 * Prueft ob ein nodeDone-Objekt die erwartete (flache) Form hat:
 * Record<string, boolean>.
 *
 * Phase 2: Server akzeptiert nur noch flach. V2-verschachtelte Eingaben
 * muessen VOR dem Validate via `migrateNodeDoneToFlat` migriert werden.
 *
 * @param {unknown} raw
 * @returns {{ ok: true; value: Record<string, boolean> } | { ok: false; reason: string }}
 */
export function validateNodeDone(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'nodeDone muss ein Objekt sein' };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v !== 'boolean') {
      return { ok: false, reason: `nodeDone["${k}"] muss boolean sein` };
    }
    if (v === true) out[k] = true;
  }
  return { ok: true, value: out };
}

// ============================================================================
// DAG-Helpers (V3, Phase 1)
//
// Pure Edge-basierte Operationen über parent_of-Relationen. Diese ersetzen in
// Phase 2 die bisherigen Tree-Walks über `node.children` / `node.parentId`.
// Sie operieren direkt auf `graph.edges` und dem flachen `graph.nodes`-Array,
// damit Multi-Parent-Knoten (DAG) korrekt behandelt werden.
// ============================================================================

/**
 * Baut eine Map ID→Node und sammelt dabei rekursiv alle Nodes (auch
 * nested children, falls die Compat-View im Spiel ist).
 *
 * In V3-canonical sind alle Nodes ohnehin im Top-Level. In der Compat-View
 * sind sie sowohl Top-Level als auch nested unter parents — wir müssen
 * beide Pfade abdecken, damit DAG-Helper auch in der State-Sicht funktionieren.
 *
 * @param {RpgGraph} graph
 * @returns {Map<string, RpgNode>}
 */
function buildFlatNodeMap(graph) {
  /** @type {Map<string, RpgNode>} */
  const m = new Map();
  /** @param {RpgNode | null | undefined} n */
  function add(n) {
    if (!n || typeof n.id !== 'string' || !n.id) return;
    if (!m.has(n.id)) m.set(n.id, n);
    if (Array.isArray(n.children)) {
      for (const c of n.children) add(c);
    }
  }
  for (const n of graphNodes(graph)) add(n);
  return m;
}

/**
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {string[]} IDs aller direkten Children via parent_of-Edges (Edge-Reihenfolge)
 */
export function getChildIds(graph, nodeId) {
  if (!nodeId || typeof nodeId !== 'string') return [];
  /** @type {string[]} */
  const out = [];
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (e.from === nodeId) out.push(e.to);
  }
  return out;
}

/**
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {string[]} IDs aller direkten Parents via parent_of-Edges
 */
export function getParentIds(graph, nodeId) {
  if (!nodeId || typeof nodeId !== 'string') return [];
  /** @type {string[]} */
  const out = [];
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (e.to === nodeId) out.push(e.from);
  }
  return out;
}

/**
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {RpgNode[]} voll aufgelöste Children (overwrite-fähig)
 */
export function getChildNodes(graph, nodeId) {
  const map = buildFlatNodeMap(graph);
  return getChildIds(graph, nodeId).map((id) => map.get(id)).filter(Boolean);
}

/**
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {RpgNode[]} voll aufgelöste Parents
 */
export function getParentNodes(graph, nodeId) {
  const map = buildFlatNodeMap(graph);
  return getParentIds(graph, nodeId).map((id) => map.get(id)).filter(Boolean);
}

/**
 * Liefert die IDs aller Nodes, die KEINE eingehende parent_of-Kante haben.
 * In V3 sind das die echten Roots.
 *
 * @param {RpgGraph} graph
 * @returns {string[]}
 */
export function getRootNodeIds(graph) {
  const allIds = new Set(buildFlatNodeMap(graph).keys());
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    allIds.delete(e.to);
  }
  return [...allIds];
}

/**
 * Fügt eine parent_of-Edge hinzu. Idempotent: existiert die Edge bereits,
 * wird der Graph unverändert zurückgegeben (gleiche Referenz). Self-Edges
 * (parentId === childId) werden abgelehnt — gibt unveränderten Graph zurück.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {RpgGraph}
 */
export function addParentChildEdge(graph, parentId, childId) {
  if (!parentId || !childId || parentId === childId) return graph;
  // Zuerst vorhandene nested children in structure-Edges spiegeln, damit beim
  // anschliessenden Rebuild keine bestehenden Subtrees verloren gehen.
  const seeded = ensureStructureEdgesFromNodes(graph);
  const edges = graphEdges(seeded);
  for (const e of edges) {
    if (isParentChildRelation(e) && e.from === parentId && e.to === childId) {
      return graph; // bereits da
    }
  }
  const nodesById = Object.fromEntries(buildFlatNodeMap(seeded));
  return ensureStructureEdgesFromNodes(
    makeRpgGraph(nodesById, [...edges, { from: parentId, to: childId, relation: 'structure' }])
  );
}

/**
 * Entfernt EINE parent_of-Edge. Falls keine solche Edge existiert: unveränderter Graph.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {RpgGraph}
 */
export function removeParentChildEdge(graph, parentId, childId) {
  if (!parentId || !childId) return graph;
  const edges = graphEdges(graph);
  const filtered = edges.filter((e) => {
    if (!isParentChildRelation(e)) return true;
    return !(e.from === parentId && e.to === childId);
  });
  if (filtered.length === edges.length) return graph; // nichts zu tun
  const nodesById = Object.fromEntries(buildFlatNodeMap(graph));
  const removedKey = `${parentId}->${childId}`;
  return ensureStructureEdgesFromNodes(
    makeRpgGraph(nodesById, filtered),
    new Set([removedKey])
  );
}

/**
 * Ergänzt fehlende structure-Edges aus dem aktuellen nested children-Baum.
 * Wichtig für Compat-Inputs: Wenn ein Node Children trägt, müssen passende
 * parent->child-Kanten existieren, sonst können Rebuilds Child-Subtrees
 * versehentlich als eigene Roots materialisieren.
 *
 * @param {RpgGraph} graph
 * @param {Set<string>} [excludedStructureKeys]
 * @returns {RpgGraph}
 */
function ensureStructureEdgesFromNodes(graph, excludedStructureKeys) {
  /** @type {Set<string>} */
  const seen = new Set(
    (graphEdges(graph) || [])
      .filter((e) => isParentChildRelation(e))
      .map((e) => `${e.from}->${e.to}`)
  );
  /** @type {RpgEdge[]} */
  const merged = [...graphEdges(graph)];
  /** @param {RpgNode[]} nodes */
  function walk(nodes) {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object') continue;
      for (const c of n.children || []) {
        if (!c || typeof c !== 'object' || !n.id || !c.id || n.id === c.id) continue;
        const k = `${n.id}->${c.id}`;
        if (excludedStructureKeys?.has(k)) continue;
        if (!seen.has(k)) {
          seen.add(k);
          merged.push({ from: n.id, to: c.id, relation: 'structure' });
        }
      }
      if (Array.isArray(n.children) && n.children.length > 0) walk(n.children);
    }
  }
  walk(graphNodes(graph));
  if (merged.length === graphEdges(graph).length) return graph;
  // Wichtig: aus flacher ID-Map rematerialisieren, damit graph.nodes direkt
  // die aktuelle Root-Struktur aus den Edges widerspiegelt (kein Reload nötig).
  return makeRpgGraph(Object.fromEntries(buildFlatNodeMap(graph)), merged);
}

/**
 * DAG-Cycle-Erkennung über parent_of-Edges (V3). Zyklen sind in einem DAG
 * verboten — genau diese Funktion sichert die Invariante. Erkennt direkte
 * (A→B→A) und indirekte Zyklen (A→B→C→A).
 *
 * Algorithmus: Standard-DFS mit drei Farben (white/gray/black). Eine
 * Back-Edge auf einen `gray`-Knoten markiert den Zyklus.
 *
 * @param {RpgGraph} graph
 * @returns {boolean} true wenn ein Zyklus existiert
 */
export function hasDagCycle(graph) {
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const id of buildFlatNodeMap(graph).keys()) {
    adj.set(id, []);
  }
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  /** @type {Set<string>} */
  const visiting = new Set();
  /** @type {Set<string>} */
  const done = new Set();

  /**
   * @param {string} id
   * @returns {boolean} true wenn cycle gefunden
   */
  function dfs(id) {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true; // Back-Edge → Cycle
    visiting.add(id);
    for (const next of adj.get(id) || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  }
  for (const id of adj.keys()) {
    if (dfs(id)) return true;
  }
  return false;
}

// ============================================================================
// Phase-2 DAG-Helper: walkDescendants, findNodeAncestors, nodeProgress,
// leafProgressRatio, isNodeComplete, canSetNodeDoneInGraph
//
// Diese Funktionen ersetzen die alten Tree-basierten Pendants und sind
// Multi-Parent-aware. Sie operieren auf graph.edges (parent_of-Relationen)
// statt auf nested children, sodass DAG-Knoten korrekt behandelt werden.
// ============================================================================

/**
 * Pre-Order-Walk ueber alle Descendants eines Nodes via parent_of-Edges.
 * Multi-Parent-aware: jeder Node wird hoechstens EINMAL besucht (Visited-Set),
 * auch wenn er ueber mehrere Pfade erreichbar ist.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {(nodeId: string, depth: number) => void} fn — Callback fuer jeden besuchten Descendant
 */
export function walkDescendants(graph, nodeId, fn) {
  if (!nodeId || typeof nodeId !== 'string') return;
  /** @type {Set<string>} */
  const visited = new Set();
  /** @param {string} id @param {number} depth */
  function walk(id, depth) {
    for (const childId of getChildIds(graph, id)) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      fn(childId, depth);
      walk(childId, depth + 1);
    }
  }
  walk(nodeId, 0);
}

/**
 * Liefert alle Vorfahren eines Nodes via parent_of-Edges.
 * Multi-Parent-aware: alle Pfade werden gesammelt, IDs dedupliziert.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {string[]} Liste der Ancestor-IDs (dedupliziert, BFS-Reihenfolge)
 */
export function findNodeAncestors(graph, nodeId) {
  if (!nodeId || typeof nodeId !== 'string') return [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const queue = getParentIds(graph, nodeId).slice();
  for (const p of queue) seen.add(p);
  while (queue.length) {
    const id = queue.shift();
    if (typeof id !== 'string') continue;
    out.push(id);
    for (const p of getParentIds(graph, id)) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  return out;
}

/**
 * Prueft ob ein Node komplett erledigt ist — DAG-aware Version.
 *
 * Logik:
 *   - Ist der Node selbst in nodeDone[nodeId] === true? → done
 *   - ODER: hat der Node Children und sind alle non-optional/non-lock Children
 *     komplett? → done
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {Set<string>} [visiting] — Cycle-Guard
 * @returns {boolean}
 */
export function isNodeComplete(graph, nodeId, nodeDone, visiting) {
  if (!nodeId || typeof nodeId !== 'string') return false;
  const flat = flattenIfNested(nodeDone);
  // Direkt auf flat[nodeId] schauen
  if (flat[nodeId] === true) {
    // Auch wenn flagged: Dependencies pruefen
    return _depsSatisfied(graph, nodeId, flat, visiting ?? new Set());
  }
  const childIds = getChildIds(graph, nodeId);
  if (childIds.length === 0) {
    // Leaf ohne flag: nicht done
    return false;
  }
  // Container: alle non-optional/non-lock Children komplett?
  const vis = visiting ?? new Set();
  if (vis.has(nodeId)) return false;
  vis.add(nodeId);
  if (!_depsSatisfied(graph, nodeId, flat, vis)) {
    vis.delete(nodeId);
    return false;
  }
  const flatMap = buildFlatNodeMap(graph);
  for (const cid of childIds) {
    const child = flatMap.get(cid);
    if (!child) continue;
    if (isLockNode(child)) continue;
    if (child.optional) continue;
    if (!isNodeComplete(graph, cid, flat, vis)) {
      vis.delete(nodeId);
      return false;
    }
  }
  vis.delete(nodeId);
  return true;
}

/**
 * Hilfsfunktion: pruefe ob alle dependsOn-IDs erfuellt sind.
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {Record<string, boolean>} flat
 * @param {Set<string>} visiting
 */
function _depsSatisfied(graph, nodeId, flat, visiting) {
  const node = buildFlatNodeMap(graph).get(nodeId);
  if (!node) return true;
  for (const d of node.dependsOn || []) {
    if (visiting.has(d)) return false; // Zyklus
    if (!isNodeComplete(graph, d, flat, visiting)) return false;
  }
  return true;
}

/**
 * Fortschritt {total, done, percent} fuer einen Node und seinen DAG-Subtree.
 *
 * Zaehlt alle non-optional, non-lock Leaf-Descendants. In Phase 2 erlauben
 * wir Doppel-Counting bei Multi-Parent — derselbe Leaf kann ueber mehrere
 * Pfade erreichbar sein. Phase 4 wird das via Visited-Set deduplizieren.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone
 * @returns {{ total: number; done: number; percent: number }}
 */
export function leafProgressRatio(graph, nodeId, nodeDone) {
  if (!nodeId || typeof nodeId !== 'string') return { total: 0, done: 0, percent: 100 };
  const flat = flattenIfNested(nodeDone);
  const flatMap = buildFlatNodeMap(graph);
  let total = 0;
  let done = 0;
  walkDescendants(graph, nodeId, (id) => {
    const node = flatMap.get(id);
    if (!node) return;
    if (isLockNode(node)) return;
    if (getChildIds(graph, id).length > 0) return; // nicht-Leaf
    if (node.optional) return;
    total += 1;
    if (isNodeComplete(graph, id, flat)) done += 1;
  });
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * Fortschritt als Prozentzahl (0-100) — graph-aware.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone
 * @returns {number}
 */
export function nodeProgress(graph, nodeId, nodeDone) {
  return leafProgressRatio(graph, nodeId, nodeDone).percent;
}

/**
 * DAG-aware Variante von canSetNodeDone.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @param {Record<string, unknown>} nodeDone
 * @returns {boolean}
 */
export function canSetNodeDoneInGraph(graph, nodeId, nodeDone) {
  if (!nodeId) return false;
  const flat = flattenIfNested(nodeDone);
  const flatMap = buildFlatNodeMap(graph);
  const node = flatMap.get(nodeId);
  if (!node) return false;
  // Lock-Geschwister: alle Lock-Siblings unter jedem Parent muessen done sein
  if (!isLockNode(node)) {
    for (const parentId of getParentIds(graph, nodeId)) {
      const lockSibIds = getChildIds(graph, parentId)
        .map((id) => flatMap.get(id))
        .filter((n) => n && isLockNode(n))
        .map((n) => n.id);
      for (const lid of lockSibIds) {
        if (!isNodeComplete(graph, lid, flat)) return false;
      }
    }
  }
  // Dependencies erfuellt?
  for (const d of node.dependsOn || []) {
    if (!isNodeComplete(graph, d, flat)) return false;
  }
  return true;
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
