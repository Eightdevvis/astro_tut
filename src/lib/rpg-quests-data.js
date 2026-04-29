/**
 * Kanonische Typen und Graph-Konstruktion fuer das RPG-Nodesystem.
 *
 * Zentrales Konzept: ALLES ist ein Node. Ob ein Node ein "Quest" (Root),
 * "Kapitel" (Gruppe mit Kindern) oder "Schritt" (Blatt) ist, ergibt sich
 * ausschliesslich aus seiner Position im Baum (parentId, children).
 */

// --- Ebene 1: Narrative Struktur (der Baum) ---
// RpgNode / RpgEdge / RpgGraph — weiter unten definiert.

// --- Ebene 2: Welt-Objekte (was in der narrativen Umgebung eingesetzt wird) ---

/**
 * Reward-Varianten — was ein Node als Belohnung vergeben kann.
 * @typedef {{ type: 'text'; text: string }} RpgRewardText
 * @typedef {{ type: 'item'; itemId: string; displayName?: string }} RpgRewardItem
 *   — Referenz auf rpg_questmaker_items (Katalog, DB-backed).
 * @typedef {{ type: 'points'; pointKind: 'heart' | 'mana'; amount: number }} RpgRewardPoints
 *   — Vitals: heart = körperliche Energie, mana = geistige Energie; Betrag kann negativ sein.
 * @typedef {{ type: 'achievement'; achievementId: string; displayName?: string }} RpgRewardAchievement
 *   — Referenz auf rpg_achievements (globale Liste, dynamisch wachsend).
 * @typedef {RpgRewardText | RpgRewardItem | RpgRewardPoints | RpgRewardAchievement} RpgRewardEntry
 */

/**
 * Katalogeintrag für ein Achievement (Welt-Objekt, DB-backed in rpg_achievements).
 * @typedef {{ id: string; title: string; description: string; updatedAt: string }} RpgAchievement
 */

/**
 * Einheitlicher Node — Position im Baum bestimmt die Rolle:
 * - parentId === null, children.length > 0 → Root ("Quest")
 * - parentId !== null, children.length > 0 → Gruppe ("Kapitel")
 * - children.length === 0 → Blatt ("Schritt")
 *
 * Phase 1 (V3): `children` und `parentId` sind in V3-canonical Daten NICHT
 * vorhanden — die Hierarchie lebt ausschliesslich in `graph.edges` als
 * structure-Relation. Beide Felder werden nur in der Compat-View
 * (`denormalizeGraphForCompat`) wieder aufgebaut, damit bestehende Aufrufer
 * weiter funktionieren. Phase 2 stellt die Aufrufer auf neue Edge-Helper um,
 * Phase 3+4 entfernen die Compat-Schicht.
 *
 * @typedef {{
 *   id: string;
 *   parentId?: string | null;
 *   title: string;
 *   description?: string;
 *   optional?: boolean;
 *   children?: RpgNode[];
 *   dependsOn?: string[];
 *   rewards?: RpgRewardEntry[];
 *   timeDueAt?: string;
 *   cityLocation?: string;
 *   placeLocation?: string;
 *   done?: boolean;
 *   orderLinked?: boolean;
 *   isLock?: boolean;
 *   orderInLayer?: number;
 *   questmakerPrompt?: string;
 * }} RpgNode
 */

/**
 * Kante: Struktur (Parent->Child) oder Abhaengigkeit (Node->Node).
 *
 * `relation` Werte
 * ────────────────
 * - `'structure'` — kanonischer Wert für parent-of-Hierarchie (V2 + V3)
 * - `'parent_of'` — V3-Alias, wird beim Einlesen auf `'structure'` gemappt
 * - `'dependency'` — Vorbedingung (Quest A muss vor Quest B fertig sein)
 *
 * @typedef {{ from: string; to: string; relation: 'structure' | 'parent_of' | 'dependency' }} RpgEdge
 */

/**
 * Der Quest-Graph: Nodes + Kanten.
 * @typedef {{ nodes: RpgNode[]; edges: RpgEdge[] }} RpgGraph
 */

/**
 * Compat-View über einem V3-Graph: Nodes haben zusätzlich `children` (rekursiv
 * aufgelöst) und `parentId` (erster Parent oder null) — siehe
 * `denormalizeGraphForCompat`. Multi-Parent-Nodes erscheinen als kopierte
 * Sub-Trees unter jedem Parent (Phase-1-Kompromiss).
 *
 * @typedef {{ nodes: RpgNode[]; edges: RpgEdge[] }} RpgGraphView
 */

// Legacy-Typ fuer altes { main, side } Format
/** @typedef {{ main: RpgNode[]; side: RpgNode[] }} RpgQuestPayloadLegacy */

// --- Edge-Normalisierung ---

/**
 * Normalisiert eine Kante aus beliebigen Rohdaten.
 * Akzeptiert sowohl neues {from, to} als auch Legacy {fromNodeId, toNodeId}.
 * @param {unknown} raw
 * @returns {RpgEdge | null}
 */
function normalizeGraphEdge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  // Neues Format bevorzugt, Legacy als Fallback
  const from = String(o.from ?? o.fromNodeId ?? '').trim();
  const to = String(o.to ?? o.toNodeId ?? '').trim();
  if (!from || !to || from === to) return null;
  const relRaw = String(o.relation ?? '').trim().toLowerCase();
  // V3-Alias 'parent_of' wird auf den kanonischen Wert 'structure' gemappt,
  // damit alle bestehenden Filter (e.relation === 'structure') in Phase 1
  // unverändert weiter funktionieren. Phase 2+ kann den kanonischen Namen
  // umbenennen, die Datenform bleibt gleich.
  const isStructure = relRaw === 'structure' || relRaw === 'parent_of';
  const relation = isStructure ? 'structure' : 'dependency';
  return { from, to, relation };
}

// --- Interne Hilfs-Funktionen ---

/**
 * Sammelt Root-Nodes (parentId === null) in ein {id -> Node} Dictionary.
 * @param {RpgNode[]} nodes
 * @param {Record<string, RpgNode>} out
 */
function collectNodesById(nodes, out) {
  for (const n of nodes || []) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id.trim()) continue;
    const id = n.id.trim();
    if (!out[id]) out[id] = /** @type {RpgNode} */ (n);
  }
}

/**
 * Erzeugt structure-Kanten aus der parent-child Hierarchie.
 * @param {RpgNode[]} nodes
 * @param {RpgEdge[]} edges
 */
function collectStructureEdges(nodes, edges, visited = new Set()) {
  for (const n of nodes || []) {
    const id = typeof n?.id === 'string' ? n.id.trim() : '';
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const pid = typeof n?.parentId === 'string' ? n.parentId.trim() : '';
    if (pid) edges.push({ from: pid, to: id, relation: 'structure' });
    if (Array.isArray(n?.children) && n.children.length > 0) collectStructureEdges(n.children, edges, visited);
  }
}

/**
 * Baut einen Baum aus einer flachen nodesById-Map + structure-Kanten.
 * @param {Record<string, RpgNode>} nodesById
 * @param {RpgEdge[]} edges
 * @returns {RpgNode[]}
 */
function materializeRootsFromNodeMap(nodesById, edges) {
  /** @type {Map<string, string[]>} */
  const childIdsByParent = new Map();
  /** @type {Set<string>} */
  const hasStructureParent = new Set();
  for (const e of edges) {
    if (e.relation !== 'structure') continue;
    if (!childIdsByParent.has(e.from)) childIdsByParent.set(e.from, []);
    childIdsByParent.get(e.from).push(e.to);
    hasStructureParent.add(e.to);
  }
  /**
   * @param {string} id
   * @param {string | null} forcedParentId
   * @returns {RpgNode | null}
   */
  const hydrateNode = (id, forcedParentId) => {
    const src = nodesById[id];
    if (!src) return null;
    const childIds = childIdsByParent.get(id) || [];
    const children = childIds
      .map((cid) => hydrateNode(cid, id))
      .filter(Boolean);
    return {
      ...src,
      parentId: forcedParentId,
      children,
    };
  };
  const rootIds = Object.keys(nodesById).filter((id) => !hasStructureParent.has(id));
  return rootIds
    .map((id) => hydrateNode(id, null))
    .filter(Boolean);
}

// --- Oeffentliche Accessoren ---

/**
 * Einheitlicher Zugriff auf Root-Nodes: akzeptiert nodes, quests (Legacy) oder nodesById.
 * @param {RpgGraph | Record<string, unknown> | null | undefined} graph
 * @returns {RpgNode[]}
 */
export function graphNodes(graph) {
  if (!graph || typeof graph !== 'object') return [];
  const g = /** @type {Record<string, unknown>} */ (graph);
  if (Array.isArray(g.nodes) && g.nodes.length > 0) return g.nodes;
  // Legacy: manche gespeicherte Graphen nutzen 'quests' statt 'nodes'
  if (Array.isArray(g.quests)) return g.quests;
  if (Array.isArray(g.nodes)) return g.nodes;
  if (g.nodesById && typeof g.nodesById === 'object') {
    return materializeRootsFromNodeMap(
      /** @type {Record<string, RpgNode>} */ (g.nodesById),
      graphEdges(/** @type {RpgGraph} */ (graph))
    );
  }
  return [];
}

/**
 * Kanten im kanonischen {from, to, relation} Format.
 * Akzeptiert Legacy-Formate (fromNodeId/toNodeId) und normalisiert.
 * @param {RpgGraph | Record<string, unknown> | null | undefined} graph
 * @returns {RpgEdge[]}
 */
export function graphEdges(graph) {
  if (!graph || typeof graph !== 'object') return [];
  const raw = Array.isArray(/** @type {any} */ (graph).edges) ? /** @type {any} */ (graph).edges : [];
  const out = raw.map(normalizeGraphEdge).filter(Boolean);
  if (out.length > 0) return out;
  /** @type {RpgEdge[]} */
  const collected = [];
  collectStructureEdges(graphNodes(/** @type {RpgGraph} */ (graph)), collected);
  return collected;
}

/**
 * Baut einen kanonischen Graph aus Nodes + Edges.
 * Gibt immer { nodes: RpgNode[], edges: RpgEdge[] } zurueck.
 * @param {RpgNode[] | Record<string, RpgNode>} nodesOrMap
 * @param {Array<RpgEdge | Record<string, unknown>>} edges
 * @returns {RpgGraph}
 */
export function makeRpgGraph(nodesOrMap, edges) {
  /** @type {Record<string, RpgNode>} */
  let nodesById = {};
  /** @type {RpgNode[]} */
  let roots = [];
  if (Array.isArray(nodesOrMap)) {
    roots = nodesOrMap;
    collectNodesById(nodesOrMap, nodesById);
  } else if (nodesOrMap && typeof nodesOrMap === 'object') {
    nodesById = { ...nodesOrMap };
    roots = materializeRootsFromNodeMap(nodesById, []);
  }
  const normalizedEdges = (Array.isArray(edges) ? edges : [])
    .map(normalizeGraphEdge)
    .filter(Boolean);
  const finalEdges =
    normalizedEdges.length > 0
      ? normalizedEdges
      : (() => {
          /** @type {RpgEdge[]} */
          const out = [];
          collectStructureEdges(roots, out);
          return out;
        })();
  if (!Array.isArray(nodesOrMap)) {
    roots = materializeRootsFromNodeMap(nodesById, finalEdges);
  }
  return { nodes: roots, edges: finalEdges };
}

// --- V3 Compat-View ---

/**
 * Prüft, ob eine Edge-Relation eine Parent→Child-Hierarchie-Kante darstellt.
 * Nach Normalisierung ist intern immer `'structure'`, aber das Eingabe-Format
 * V3 erlaubt `'parent_of'` als Alias. Konsumenten sollen über diesen Helper
 * filtern, damit der Wechsel des kanonischen Namens (Phase 2+) zentralisiert
 * bleibt.
 *
 * @param {RpgEdge | null | undefined} edge
 * @returns {boolean}
 */
export function isParentChildRelation(edge) {
  if (!edge) return false;
  return edge.relation === 'structure' || edge.relation === 'parent_of';
}

/**
 * Baut über einem V3-Graph (flache Nodes, Hierarchie nur in edges) eine
 * Compat-View, in der jede Node zusätzlich enthält:
 *   - `children: RpgNode[]` — rekursiv aus structure-Edges aufgelöst
 *   - `parentId: string | null` — ID des ersten Parents (oder null wenn root)
 *
 * Multi-Parent-Behandlung
 * ───────────────────────
 * Wenn eine Node mehrere parent_of-Edges einkommend hat, erscheint sie unter
 * JEDEM Parent als kopierter Sub-Tree (shallow-Copy mit eigenen children).
 * `parentId` wird auf den ersten Parent in Edge-Reihenfolge gesetzt — das ist
 * konsistent mit der V2-Sicht aus Sicht des Top-Down-Walks. Diese Duplizierung
 * ist NICHT-DAG aber für die Phase-1-Compat legitim: bestehende Aufrufer
 * sehen weiter einen Tree.
 *
 * Cycle-Schutz
 * ────────────
 * Pro Walk-Pfad wird ein `visited`-Set geführt, sodass Edges, die einen Zyklus
 * erzeugen würden, beim Aufbau übersprungen werden (verhindert Stack-Overflow).
 * Echte DAG-Cycle-Erkennung läuft separat über `hasDagCycle`.
 *
 * @param {RpgGraph | Record<string, unknown> | null | undefined} graph
 * @returns {RpgGraphView}
 */
export function denormalizeGraphForCompat(graph) {
  const nodes = graphNodes(graph);
  const edges = graphEdges(graph);

  /** @type {Map<string, RpgNode>} — flache ID→Node-Map (canonical Form). */
  const byId = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string' && n.id) byId.set(n.id, n);
  }

  /** @type {Map<string, string[]>} — parent → child-IDs (Reihenfolge wie in edges). */
  const childIdsByParent = new Map();
  /** @type {Map<string, string[]>} — child → parent-IDs (für parentId-Wahl). */
  const parentIdsByChild = new Map();
  for (const e of edges) {
    if (!isParentChildRelation(e)) continue;
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (!childIdsByParent.has(e.from)) childIdsByParent.set(e.from, []);
    childIdsByParent.get(e.from).push(e.to);
    if (!parentIdsByChild.has(e.to)) parentIdsByChild.set(e.to, []);
    parentIdsByChild.get(e.to).push(e.from);
  }

  /**
   * Baut den Compat-Node mit `children`/`parentId`.
   * @param {string} id
   * @param {string | null} parentId — vom Caller bestimmt (für Multi-Parent-Kopien)
   * @param {Set<string>} ancestors — Pfad-Cycle-Guard
   * @returns {RpgNode | null}
   */
  function build(id, parentId, ancestors) {
    const src = byId.get(id);
    if (!src) return null;
    if (ancestors.has(id)) return null; // Cycle — nicht erneut ausrollen
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const childIds = childIdsByParent.get(id) || [];
    /** @type {RpgNode[]} */
    const children = [];
    for (const cid of childIds) {
      const built = build(cid, id, nextAncestors);
      if (built) children.push(built);
    }
    // Shallow-Copy + Compat-Felder. parentId wird vom Caller bestimmt
    // (= der konkrete Parent-Eintrag in dieser Sub-Tree-Kopie). Bei Roots
    // (kein Parent-Edge) wird der erste verfügbare Parent verwendet — bei
    // genuinen Roots ist das null.
    const resolvedParentId = parentId
      ?? (parentIdsByChild.get(id)?.[0] ?? null);
    return {
      ...src,
      parentId: resolvedParentId,
      children,
    };
  }

  // Root-Nodes: alle, die KEINE eingehende structure-Edge haben.
  /** @type {RpgNode[]} */
  const roots = [];
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) continue;
    if (parentIdsByChild.has(n.id) && (parentIdsByChild.get(n.id)?.length ?? 0) > 0) {
      // Hat Parents → kein Root
      continue;
    }
    const built = build(n.id, null, new Set());
    if (built) roots.push(built);
  }

  return { nodes: roots, edges };
}

// --- Konstanten ---

/** Leerer Graph: Initialzustand bis Server-Bootstrap (kein Flash). */
export const EMPTY_RPG_GRAPH = /** @type {RpgGraph} */ (makeRpgGraph([], []));

// ============================================================================
// Flat nodeDone (Phase 2)
//
// Daten-Modell-Wechsel: nodeDone ist jetzt flach pro Node-ID, NICHT mehr nach
// Quest gruppiert. Hintergrund: im DAG (Phase 1+) kann eine Node mehrere
// Parents haben — die alte Verschachtelung `nodeDone[questId][nodeId]` war
// daran nicht mehr sauber abbildbar (eine Node wäre in mehreren Quest-Maps
// dupliziert). Phase-2-Entscheidung: Done-Status ist global pro Node-ID.
//
// Format:
//   - Alt (V2): Record<questId, Record<nodeId, boolean>>
//   - Neu (V3): Record<nodeId, boolean>
// ============================================================================

/**
 * @typedef {Record<string, boolean>} RpgFlatNodeDone
 * Flache Map: nodeId → done-Flag.
 */

/**
 * Migriert einen verschachtelten nodeDone-State (V2) zu flachem Format (V3).
 *
 * Regel: ein Node ist done wenn er in IRGENDEINEM Quest done war (Union über
 * alle Quests). Bei Multi-Parent-Knoten ist das die natürliche Semantik —
 * derselbe Node soll überall denselben Done-Status zeigen.
 *
 * Idempotent: ein bereits flaches Objekt wird unverändert akzeptiert (jedes
 * top-level boolean-true bleibt erhalten).
 *
 * @param {unknown} oldNodeDone — kann V2 (verschachtelt) oder V3 (flach) sein
 * @returns {RpgFlatNodeDone}
 */
export function migrateNodeDoneToFlat(oldNodeDone) {
  if (!oldNodeDone || typeof oldNodeDone !== 'object' || Array.isArray(oldNodeDone)) return {};
  /** @type {RpgFlatNodeDone} */
  const out = {};
  for (const [k, v] of Object.entries(oldNodeDone)) {
    if (v === true) {
      // Bereits flach: top-level boolean
      out[k] = true;
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // V2: zweite Ebene durchgehen, jeden true-Eintrag flach übernehmen
      for (const [innerK, innerV] of Object.entries(v)) {
        if (innerV === true) out[innerK] = true;
      }
    }
    // false und alle anderen Werte werden ignoriert (kein expliziter false-Eintrag)
  }
  return out;
}

/**
 * Validiert das flache nodeDone-Format. Akzeptiert leere Objekte und
 * `boolean: true`-Werte. Lehnt non-Object und nicht-true-Werte ab.
 *
 * @param {unknown} raw
 * @returns {{ ok: true; value: RpgFlatNodeDone } | { ok: false; reason: string }}
 */
export function validateFlatNodeDone(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'nodeDone muss ein Objekt sein' };
  }
  /** @type {RpgFlatNodeDone} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'boolean') {
      return { ok: false, reason: `nodeDone["${k}"] muss boolean sein` };
    }
    if (v === true) out[k] = true;
  }
  return { ok: true, value: out };
}
