/**
 * Graph-Operationen: Unlock-Pruefung, Fortschritt, Upsert, Zyklen-Erkennung.
 * Layout-Code liegt in rpg-sugiyama-layout.js (+ rpg-edge-routing-grid.js fuer Edges).
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

// ============================================================================
// Edge-Lock (Tree-View Subtree-Sperre, V3) — bidirektional ab 2026-05-04
//
// STRICT GETRENNT vom node-eigenen `isLock`-Flag (Lock-Sibling-Mechanik im
// Editor — andere Datenkante, andere Semantik).
//
// Modell: jede `parent_of`-Edge kann eine `locked`-Side tragen:
//   - 'child'  → der Child-Subtree (downstream) ist gesperrt
//   - 'parent' → der Parent-Branch  (upstream) ist gesperrt
//   - sonst    → kein Lock
//
// Legacy-Kompatibilitaet: `locked: true` aus der ersten Version wird beim
// Lesen automatisch als `'child'` interpretiert (siehe normalizeGraphEdge).
// Neue Schreiboperationen verwenden ausschliesslich die expliziten Strings.
//
// Subtree-Propagation: `computeLockedNodeIds` macht eine bidirektionale
// Fixpunkt-Iteration — siehe dortige Doku.
// ============================================================================

/**
 * Liest die Lock-Side einer Edge ab. Akzeptiert sowohl die explizite String-
 * Form als auch das Legacy-Boolean `true` (= 'child').
 *
 * @param {RpgEdge | null | undefined} edge
 * @returns {'child' | 'parent' | 'both' | null}
 */
export function readEdgeLockSide(edge) {
  if (!edge) return null;
  const v = /** @type {any} */ (edge).locked;
  if (v === 'both') return 'both';
  if (v === 'parent') return 'parent';
  if (v === 'child' || v === true) return 'child';
  return null;
}

/**
 * @param {'child' | 'parent' | 'both' | null} side
 * @returns {boolean}
 */
function hasChildSide(side) {
  return side === 'child' || side === 'both';
}

/**
 * @param {'child' | 'parent' | 'both' | null} side
 * @returns {boolean}
 */
function hasParentSide(side) {
  return side === 'parent' || side === 'both';
}

/**
 * Setzt oder entfernt das Lock-Flag auf einer parent_of-Edge mit expliziter
 * Side-Angabe.
 *
 * Idempotent: wenn die Ziel-Kante bereits den gewuenschten Zustand hat oder
 * gar nicht existiert, gibt die Funktion den unveraenderten Graph zurueck
 * (referenz-gleich) — vermeidet unnoetige Re-Renders.
 *
 * Nur structure-Edges werden modifiziert; dependency-Edges ignorieren das Flag.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @param {'child' | 'parent' | 'both' | null} side — null = Lock entfernen
 * @returns {RpgGraph}
 */
export function setEdgeLockSide(graph, parentId, childId, side) {
  if (!parentId || !childId) return graph;
  const wantSide = side === 'child' || side === 'parent' || side === 'both' ? side : null;
  const edges = graphEdges(graph);
  let changed = false;
  /** @type {RpgEdge[]} */
  const next = [];
  for (const e of edges) {
    if (
      isParentChildRelation(e)
      && e.from === parentId
      && e.to === childId
    ) {
      const currentSide = readEdgeLockSide(e);
      if (currentSide === wantSide) {
        // Schon im Soll-Zustand — Edge unveraendert weiterreichen.
        next.push(e);
      } else if (wantSide) {
        // Side setzen oder umschalten. Vorhandenes locked-Feld ueberschreiben.
        next.push({ ...e, locked: wantSide });
        changed = true;
      } else {
        // Unlock: locked-Feld komplett entfernen (Default-Edge ist kompakt).
        const { locked: _drop, ...rest } = /** @type {any} */ (e);
        next.push(/** @type {RpgEdge} */ (rest));
        changed = true;
      }
    } else {
      next.push(e);
    }
  }
  if (!changed) return graph;
  // Aus der flachen ID-Map + neuen Edges rebuilden — damit Compat-Materialisierung
  // (children/parentId) konsistent bleibt.
  const nodesById = Object.fromEntries(buildFlatNodeMap(graph));
  return makeRpgGraph(nodesById, next);
}

/**
 * Toggled die Lock-Side einer Edge:
 *   - Aktuelle Side === side → unlock (Klick auf gleiche Haelfte = entsperren)
 *   - Aktuelle Side !== side → setze auf side (Wechsel der Sperre)
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @param {'child' | 'parent'} side — Side aus dem Click-Position berechnet
 * @returns {RpgGraph}
 */
export function toggleEdgeLockSide(graph, parentId, childId, side) {
  if (side !== 'child' && side !== 'parent') return graph;
  const current = readEdgeLockSide(getParentChildEdge(graph, parentId, childId));
  /** @type {'child' | 'parent' | 'both' | null} */
  let wantSide = null;
  // Unabhaengiges Toggle beider Seiten:
  // parent + child koennen gleichzeitig aktiv sein (`both`), statt sich
  // gegenseitig zu ueberschreiben.
  if (side === 'parent') {
    if (current === 'parent') wantSide = null;
    else if (current === 'child') wantSide = 'both';
    else if (current === 'both') wantSide = 'child';
    else wantSide = 'parent';
  } else {
    if (current === 'child') wantSide = null;
    else if (current === 'parent') wantSide = 'both';
    else if (current === 'both') wantSide = 'parent';
    else wantSide = 'child';
  }
  return setEdgeLockSide(graph, parentId, childId, wantSide);
}

/**
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {RpgEdge | null}
 */
function getParentChildEdge(graph, parentId, childId) {
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (e.from === parentId && e.to === childId) return e;
  }
  return null;
}

/**
 * Liest die Lock-Side einer Edge aus dem Graph (per ID-Lookup).
 * Existiert die Edge nicht oder ist sie kein parent_of, returned null.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {'child' | 'parent' | 'both' | null}
 */
export function getEdgeLockSide(graph, parentId, childId) {
  if (!parentId || !childId) return null;
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (e.from !== parentId || e.to !== childId) continue;
    return readEdgeLockSide(e);
  }
  return null;
}

// --- Backward-Compat-Wrapper ------------------------------------------------

/**
 * Backward-Compat: setEdgeLocked(graph, p, c, true) → setEdgeLockSide(... 'child').
 * `false` → unlock. Neue Aufrufer sollten `setEdgeLockSide` verwenden.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @param {boolean} locked
 * @returns {RpgGraph}
 */
export function setEdgeLocked(graph, parentId, childId, locked) {
  return setEdgeLockSide(graph, parentId, childId, locked ? 'child' : null);
}

/**
 * Backward-Compat: toggled zwischen child-side-locked und unlocked.
 * Beachtet auch parent-side-Lock — der wird von dieser Funktion zu unlocked.
 * Neue Aufrufer sollten `toggleEdgeLockSide` mit expliziter Side verwenden.
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {RpgGraph}
 */
export function toggleEdgeLocked(graph, parentId, childId) {
  const current = getEdgeLockSide(graph, parentId, childId);
  // Wenn aktuell schon (irgendwie) gelockt → unlock; sonst → child-side locken.
  return setEdgeLockSide(graph, parentId, childId, current ? null : 'child');
}

/**
 * Liest "ist diese Edge ueberhaupt gelockt?" (egal in welche Richtung).
 *
 * @param {RpgGraph} graph
 * @param {string} parentId
 * @param {string} childId
 * @returns {boolean}
 */
export function isEdgeLocked(graph, parentId, childId) {
  return getEdgeLockSide(graph, parentId, childId) !== null;
}

/**
 * Direktes "ist dieser Node aufgrund eingehender Edges gelockt"-Check.
 * Beruecksichtigt NUR child-side-Locks (down-stream-Propagation).
 * Fuer die volle bidirektionale Logik siehe `computeLockedNodeIds`.
 *
 * Multi-Parent-konservativ: Node ist nur gelockt wenn ALLE eingehenden
 * Edges child-side-locked sind UND mind. eine eingehende existiert.
 *
 * @param {RpgGraph} graph
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isNodeLockedInGraph(graph, nodeId) {
  if (!nodeId || typeof nodeId !== 'string') return false;
  let total = 0;
  let blocked = 0;
  for (const e of graphEdges(graph)) {
    if (!isParentChildRelation(e)) continue;
    if (e.to !== nodeId) continue;
    total += 1;
    if (hasChildSide(readEdgeLockSide(e))) blocked += 1;
  }
  return total > 0 && blocked === total;
}

/**
 * Berechnet die Menge aller Node-IDs, die als "gelockt" gelten —
 * **bidirektional** propagiert (down- und up-stream) PLUS Sibling-Lock via
 * `node.isLock`.
 *
 * Down-stream (child-side-Lock auf Edge P→C):
 *   Ein Knoten N ist down-stream-gelockt, wenn EINE eingehende parent_of-Edge
 *   selbst child-side-locked ist ODER ihr Parent transitiv gelockt ist.
 *
 * Up-stream (parent-side-Lock auf Edge P→C):
 *   Ein Knoten N ist up-stream-gelockt, wenn EINE ausgehende parent_of-Edge
 *   selbst parent-side-locked ist ODER ihr Child transitiv gelockt ist.
 *
 * Sibling-Lock (`node.isLock`, ab 2026-05-04 ueber computeLockedNodeIds vereinheitlicht):
 *   Eine als `isLock: true` markierte (= "Lock-Sibling") Node sperrt visuell
 *   alle ihre Geschwister (= Children der gleichen Parents). Die Lock-Node
 *   selbst NICHT, andere Lock-Nodes auf gleicher Ebene auch NICHT.
 *   nodeDone-aware: ist die Lock-Node selbst done, sind die Geschwister frei
 *   (konsistent mit der bestehenden `canSetNodeDoneInGraph`-Logik).
 *   Multi-Parent: Geschwister sind die Children ALLER Parents von L.
 *   Die so markierten Geschwister landen im downLocked-Seed-Set, sodass die
 *   Fixpunkt-Iteration ihre Subtrees automatisch mit dimmt.
 *
 * Algorithmus: Fixpunkt-Iteration. Konvergiert in O(V * (V+E)) im Worst Case,
 * in der Praxis (kleine Trees) vernachlaessigbar.
 *
 * @param {RpgGraph} graph
 * @param {Record<string, unknown>} [nodeDone] — flach (V3) oder verschachtelt (V2-Compat).
 *   Wird nur fuer die Sibling-Lock-Awareness gelesen; ist die Lock-Node done,
 *   wird sie als "frei" behandelt und sperrt ihre Geschwister NICHT.
 * @returns {Set<string>}
 */
export function computeLockedNodeIds(graph, nodeDone) {
  /** @type {Set<string>} */
  const locked = new Set();
  const allNodesMap = buildFlatNodeMap(graph);
  const allIds = [...allNodesMap.keys()];
  const parentEdges = graphEdges(graph).filter(isParentChildRelation);

  /**
   * Adjazenz-Maps mit per-Edge-Lock-Side. Eine Edge taucht zweimal auf:
   * einmal als incoming beim Child, einmal als outgoing beim Parent.
   * @type {Map<string, Array<{ neighbor: string; lockSide: 'child' | 'parent' | 'both' | null }>>}
   */
  const incoming = new Map(); // child → [{ parent, lockSide }]
  /** @type {typeof incoming} */
  const outgoing = new Map(); // parent → [{ child, lockSide }]
  for (const id of allIds) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of parentEdges) {
    const lockSide = readEdgeLockSide(e);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push({ neighbor: e.from, lockSide });
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push({ neighbor: e.to, lockSide });
  }

  // Hilfssets: pro Knoten getrennt "down-stream-locked" und "up-stream-locked"
  // tracken. Ein Knoten landet im finalen `locked`-Set, wenn er in einer der
  // beiden Richtungen gelockt ist (Vereinigung).
  //
  // Trennung ist wichtig fuer korrekte Propagation: eine Edge mit lockSide
  // 'parent' SCHUETZT die Down-stream-Richtung (sagt: "von hier nach unten
  // ist NICHTS gesperrt, die Sperre liegt auf Parent-Seite"). Analog fuer
  // 'child'. Wenn wir nicht trennen wuerden, wuerde ein down-locked Subtree
  // sich faelschlich auch nach oben "anstecken", obwohl die Edge eindeutig
  // sagt "der Lock-Effekt geht in die andere Richtung".
  /** @type {Set<string>} */
  const downLocked = new Set();
  /** @type {Set<string>} */
  const upLocked = new Set();

  // ── Phase 0: Sibling-Lock-Seed via node.isLock ─────────────────────
  // Vor dem Fixpunkt: jede aktive (=nicht done) Lock-Sibling-Node fuegt
  // ihre Geschwister ins downLocked-Set ein. Die Fixpunkt-Iteration
  // unten propagiert die Sperre dann automatisch in deren Subtrees.
  //
  // Wir nutzen die schon aufgebauten incoming/outgoing-Maps fuer die
  // Geschwister-Suche: Geschwister(L) = Vereinigung aller Children der
  // Parents von L, ohne L selbst und ohne andere isLock-Nodes auf der
  // gleichen Ebene.
  const flatDone = flattenIfNested(/** @type {any} */ (nodeDone) || {});
  for (const lockId of allIds) {
    const lockNode = allNodesMap.get(lockId);
    if (!lockNode || !isLockNode(lockNode)) continue;
    if (flatDone[lockId] === true) continue; // Lock-Node selbst ist done → Schwestern frei
    const parents = (incoming.get(lockId) || []).map((e) => e.neighbor);
    for (const pid of parents) {
      const sibs = (outgoing.get(pid) || []).map((e) => e.neighbor);
      for (const sibId of sibs) {
        if (sibId === lockId) continue;
        const sib = allNodesMap.get(sibId);
        if (sib && isLockNode(sib)) continue; // andere Lock-Geschwister selbst nicht dimmen
        downLocked.add(sibId);
      }
    }
  }

  // Fixpunkt-Iteration: pro Runde alle Knoten pruefen, bis keiner mehr neu
  // hinzukommt.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of allIds) {
      // ── Down-stream-Check (eingehende Edges) ──────────────────────────
      // Eine eingehende Edge "blockiert" Down-stream, wenn:
      //   - sie selbst lockSide 'child' oder 'both' traegt (= Sperre zwischen Parent und N
      //     mit Wirkrichtung Child-Seite), ODER
      //   - sie traegt KEIN 'parent'-Lock (parent-Lock schuetzt Down) UND
      //     der Parent ist selbst down-stream-gelockt (transitiv).
      // Eine 'parent'-Edge ist NIEMALS Down-stream-blockierend — die Sperre
      // wirkt auf die andere Seite der Edge.
      //
      // Branch-orientierte Semantik (wie im UI erwartet): EIN blockierter
      // eingehender Pfad reicht, damit der Child-Branch ab dieser Edge im
      // Schatten liegt. Das vermeidet "nur gestrichelt, nicht dunkel" bei
      // Multi-Parent-Children.
      if (!downLocked.has(id)) {
        const inEdges = incoming.get(id) || [];
        if (inEdges.length > 0) {
          const anyBlocked = inEdges.some((e) => {
            if (hasChildSide(e.lockSide)) return true;
            if (e.lockSide === 'parent') return false;
            return downLocked.has(e.neighbor);
          });
          if (anyBlocked) {
            downLocked.add(id);
            changed = true;
          }
        }
      }

      // ── Up-stream-Check (ausgehende Edges) ────────────────────────────
      // Eine ausgehende Edge "blockiert" Up-stream, wenn:
      //   - sie selbst lockSide 'parent' oder 'both' traegt, ODER
      //   - sie traegt KEIN 'child'-Lock UND der Child ist up-stream-gelockt.
      // Fuer Parent-Branch-Locks gilt absichtlich OR-Semantik: ein einziger
      // blockierter Child-Pfad reicht, um den Parent-Zweig nach oben zu
      // verschatten. Sonst wirken parent-side-Locks nur bei Single-Child-
      // Knoten und "verschwinden" bei Nodes mit mehreren Children.
      if (!upLocked.has(id)) {
        const outEdges = outgoing.get(id) || [];
        if (outEdges.length > 0) {
          const anyBlocked = outEdges.some((e) => {
            if (hasParentSide(e.lockSide)) return true;
            if (e.lockSide === 'child') return false;
            return upLocked.has(e.neighbor);
          });
          if (anyBlocked) {
            upLocked.add(id);
            changed = true;
          }
        }
      }
    }
  }

  // Vereinigung: ein Knoten gilt als "gelockt" wenn er in einer der beiden
  // Richtungen blockiert ist.
  for (const id of downLocked) locked.add(id);
  for (const id of upLocked) locked.add(id);
  return locked;
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
