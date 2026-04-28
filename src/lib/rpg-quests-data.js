/**
 * Kanonische Typen und Graph-Konstruktion fuer das RPG-Nodesystem.
 *
 * Zentrales Konzept: ALLES ist ein Node. Ob ein Node ein "Quest" (Root),
 * "Kapitel" (Gruppe mit Kindern) oder "Schritt" (Blatt) ist, ergibt sich
 * ausschliesslich aus seiner Position im Baum (parentId, children).
 */

// --- Einheitliche Typen (Single Source of Truth) ---

/**
 * Reward-Varianten: Text, Item oder Punkte (heart/mana).
 * @typedef {{ type: 'text'; text: string }} RpgRewardText
 * @typedef {{ type: 'item'; itemId: string; displayName?: string }} RpgRewardItem
 * @typedef {{ type: 'points'; pointKind: 'heart' | 'mana'; amount: number }} RpgRewardPoints
 * @typedef {RpgRewardText | RpgRewardItem | RpgRewardPoints} RpgRewardEntry
 */

/**
 * Einheitlicher Node — Position im Baum bestimmt die Rolle:
 * - parentId === null, children.length > 0 → Root ("Quest")
 * - parentId !== null, children.length > 0 → Gruppe ("Kapitel")
 * - children.length === 0 → Blatt ("Schritt")
 *
 * @typedef {{
 *   id: string;
 *   parentId: string | null;
 *   title: string;
 *   description?: string;
 *   optional?: boolean;
 *   children: RpgNode[];
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
 * @typedef {{ from: string; to: string; relation: 'structure' | 'dependency' }} RpgEdge
 */

/**
 * Der Quest-Graph: Nodes + Kanten.
 * @typedef {{ nodes: RpgNode[]; edges: RpgEdge[] }} RpgGraph
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
  const relation = relRaw === 'structure' ? 'structure' : 'dependency';
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
function collectStructureEdges(nodes, edges) {
  for (const n of nodes || []) {
    const pid = typeof n?.parentId === 'string' ? n.parentId.trim() : '';
    const id = typeof n?.id === 'string' ? n.id.trim() : '';
    if (pid && id) edges.push({ from: pid, to: id, relation: 'structure' });
    if (Array.isArray(n?.children) && n.children.length > 0) collectStructureEdges(n.children, edges);
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
 * Root-Nodes als Map (id -> Node).
 * @param {RpgGraph | null | undefined} graph
 * @returns {Record<string, RpgNode>}
 */
export function graphNodesById(graph) {
  /** @type {Record<string, RpgNode>} */
  const out = {};
  if (!graph || typeof graph !== 'object') return out;
  const g = /** @type {Record<string, unknown>} */ (graph);
  // Legacy: nodesById direkt auf dem Graph-Objekt
  if (g.nodesById && typeof g.nodesById === 'object') {
    for (const [id, n] of Object.entries(/** @type {Record<string, RpgNode>} */ (g.nodesById))) {
      if (!id || !n || typeof n !== 'object') continue;
      if (n.parentId !== null) continue;
      out[id] = n;
    }
    return out;
  }
  collectNodesById(graphNodes(graph), out);
  return out;
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

// --- Konstanten ---

/** Leerer Graph: Initialzustand bis Server-Bootstrap (kein Flash). */
export const EMPTY_RPG_GRAPH = /** @type {RpgGraph} */ (makeRpgGraph([], []));

/** Sample-Graph fuer Erstbenutzer / Demo. */
/** @type {RpgGraph} */
export const SAMPLE_RPG_GRAPH = {
  nodes: [
    {
      id: 'main-architect',
      parentId: null,
      title: 'Der rote Faden',
      description:
        'Du strukturierst dein Leben um ein langfristiges Ziel: weniger reagieren, mehr bauen. Jeder Schritt ist eine bewusste Entscheidung, nicht ein Zufallstreffer.',
      children: [
        { id: 'm1', parentId: 'main-architect', title: 'Klarheit: ein Satz, wof\u00fcr die n\u00e4chsten Jahre da sind', children: [] },
        { id: 'm2', parentId: 'main-architect', title: 'Umgebung so trimmen, dass sie das Ziel tr\u00e4gt, nicht sabotiert', children: [] },
        { id: 'm3', parentId: 'main-architect', title: 'Ein Ritual, das w\u00f6chentlich Fortschritt sichtbar macht', children: [] },
        { id: 'm4', parentId: 'main-architect', title: 'Nein sagen zu einer gro\u00dfen Ablenkung', children: [] },
      ],
      rewards: [{ type: 'text', text: '+2 Klarheit' }, { type: 'text', text: 'Titel: Architekt' }, { type: 'text', text: 'Cutscene: Morgenlicht' }],
    },
    {
      id: 'main-bridge',
      parentId: null,
      title: 'Br\u00fccke bauen',
      description:
        'Zwischen dem, der du warst, und dem, der du werden willst, fehlt eine Br\u00fccke aus konkreten Taten.',
      children: [
        { id: 'b1', parentId: 'main-bridge', title: 'Eine ehrliche Bilanz: was bleibt, was fliegt', children: [] },
        { id: 'b2', parentId: 'main-bridge', title: 'Ein Gespr\u00e4ch, das du seit Monaten vermeidest', children: [] },
      ],
      rewards: [{ type: 'item', itemId: 'sample-toolbox', displayName: 'Werkzeugkasten' }],
    },
    {
      id: 'side-read',
      parentId: null,
      title: 'Seiten statt Scrollen',
      description:
        'Nebenquest: wieder mehr Tiefe statt Dauerfeuer. Ein Buch, ein Stift, keine Ausreden.',
      children: [
        { id: 's1', parentId: 'side-read', title: '30 Minuten ohne zweiten Bildschirm', children: [] },
        { id: 's2', parentId: 'side-read', title: 'Ein Kapitel zu Ende lesen', children: [] },
        { id: 's3', parentId: 'side-read', title: 'Eine Notiz, die du in einer Woche noch verstehst', children: [] },
      ],
      rewards: [{ type: 'text', text: '+XP Lesen' }, { type: 'text', text: 'Cosmetic: Lesezeichen' }],
    },
    {
      id: 'side-walk',
      parentId: null,
      title: 'Drau\u00dfen-Level',
      description: 'Kurz raus, Kopf leeren, K\u00f6rper mitnehmen.',
      children: [{ id: 'w1', parentId: 'side-walk', title: '20 Minuten ohne Podcast', children: [] }],
      rewards: [{ type: 'text', text: 'Buff: Sonnenlicht' }],
    },
    {
      id: 'side-cook',
      parentId: null,
      title: 'Quest: K\u00fcche',
      description: 'Etwas kochen, das nicht aus \u201eschnell und m\u00fcde\u201c hei\u00dft.',
      children: [
        { id: 'c1', parentId: 'side-cook', title: 'Einkaufsliste ohne Impulskauf', children: [] },
        { id: 'c2', parentId: 'side-cook', title: 'Gericht zu Ende gebracht', children: [] },
      ],
      rewards: [{ type: 'text', text: 'Recipe drop' }],
    },
  ],
  edges: [
    { from: 'side-read', to: 'main-architect', relation: 'dependency' },
    { from: 'side-walk', to: 'main-architect', relation: 'dependency' },
    { from: 'main-architect', to: 'main-bridge', relation: 'dependency' },
    { from: 'side-cook', to: 'main-bridge', relation: 'dependency' },
  ],
};

/**
 * Legacy-Shape: leere Listen; aktive Daten kommen aus localStorage + Graph.
 * @type {RpgQuestPayloadLegacy}
 */
export const SAMPLE_RPG_QUESTS = {
  main: [],
  side: [],
};
