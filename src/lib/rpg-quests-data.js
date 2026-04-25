/**
 * Default-/Sample-Nodes und Kanon-Form für GET /api/rpg/quests.
 */

/** @typedef {import('./rpg-quest-nodes.js').RpgQuestStepNode} RpgNode */
/** @typedef {import('./rpg-quest-nodes.js').RpgQuestRewardEntry} RpgQuestRewardEntry */
/** @typedef {{ id: string; parentId: null; title: string; description: string; children: RpgNode[]; rewards?: string[] }} RpgQuest */
/** @typedef {{ main: RpgQuest[]; side: RpgQuest[] }} RpgQuestPayloadLegacy */
/** @typedef {{ id: string; parentId: null; title: string; description: string; cityLocation?: string; children: RpgNode[]; rewards?: string[]; questRewards?: RpgQuestRewardEntry[]; questmakerPrompt?: string }} RpgGraphNode */
/** @typedef {{ fromNodeId: string; toNodeId: string; relation: 'structure' | 'dependency'; from?: string; to?: string }} RpgGraphEdge */
/** @typedef {{ nodesById?: Record<string, RpgGraphNode>; nodes?: RpgGraphNode[]; quests?: RpgGraphNode[]; edges: RpgGraphEdge[] }} RpgGraph */

/**
 * @param {unknown} raw
 * @returns {RpgGraphEdge | null}
 */
function normalizeGraphEdge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const fromNodeId = String(o.fromNodeId ?? o.from ?? '').trim();
  const toNodeId = String(o.toNodeId ?? o.to ?? '').trim();
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return null;
  const relRaw = String(o.relation ?? '').trim().toLowerCase();
  const relation = relRaw === 'structure' ? 'structure' : 'dependency';
  return { fromNodeId, toNodeId, relation, from: fromNodeId, to: toNodeId };
}

/**
 * @param {RpgGraphNode[]} nodes
 * @param {Record<string, RpgGraphNode>} out
 */
function collectNodesById(nodes, out) {
  for (const n of nodes || []) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id.trim()) continue;
    const id = n.id.trim();
    const existing = out[id];
    if (!existing) out[id] = /** @type {RpgGraphNode} */ (n);
  }
}

/**
 * @param {RpgNode[]} nodes
 * @param {RpgGraphEdge[]} edges
 */
function collectStructureEdges(nodes, edges) {
  for (const n of nodes || []) {
    const pid = typeof n?.parentId === 'string' ? n.parentId.trim() : '';
    const id = typeof n?.id === 'string' ? n.id.trim() : '';
    if (pid && id) edges.push({ fromNodeId: pid, toNodeId: id, relation: 'structure', from: pid, to: id });
    if (Array.isArray(n?.children) && n.children.length > 0) collectStructureEdges(n.children, edges);
  }
}

/**
 * @param {Record<string, RpgGraphNode>} nodesById
 * @param {RpgGraphEdge[]} edges
 * @returns {RpgGraphNode[]}
 */
function materializeRootsFromNodeMap(nodesById, edges) {
  /** @type {Map<string, string[]>} */
  const childIdsByParent = new Map();
  /** @type {Set<string>} */
  const hasStructureParent = new Set();
  for (const e of edges) {
    if (e.relation !== 'structure') continue;
    if (!childIdsByParent.has(e.fromNodeId)) childIdsByParent.set(e.fromNodeId, []);
    childIdsByParent.get(e.fromNodeId).push(e.toNodeId);
    hasStructureParent.add(e.toNodeId);
  }
  /**
   * @param {string} id
   * @param {string | null} forcedParentId
   * @returns {RpgGraphNode | null}
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

/**
 * Einheitlicher Zugriff: nodes sind primär, quests ist Legacy-Alias.
 * @param {RpgGraph | null | undefined} graph
 * @returns {RpgGraphNode[]}
 */
export function graphNodes(graph) {
  if (!graph || typeof graph !== 'object') return [];
  if (Array.isArray(graph.nodes) && graph.nodes.length > 0) return graph.nodes;
  if (Array.isArray(graph.quests)) return graph.quests;
  if (Array.isArray(graph.nodes)) return graph.nodes;
  if (graph.nodesById && typeof graph.nodesById === 'object') {
    return materializeRootsFromNodeMap(
      /** @type {Record<string, RpgGraphNode>} */ (graph.nodesById),
      graphEdges(graph)
    );
  }
  return [];
}

/**
 * Globaler Zugriff: alle Node-Entities (inkl. bisheriger Unterknoten).
 * @param {RpgGraph | null | undefined} graph
 * @returns {Record<string, RpgGraphNode>}
 */
export function graphNodesById(graph) {
  /** @type {Record<string, RpgGraphNode>} */
  const out = {};
  if (!graph || typeof graph !== 'object') return out;
  if (graph.nodesById && typeof graph.nodesById === 'object') {
    for (const [id, n] of Object.entries(graph.nodesById)) {
      if (!id || !n || typeof n !== 'object') continue;
      if (n.parentId !== null) continue;
      out[id] = /** @type {RpgGraphNode} */ (n);
    }
    return out;
  }
  collectNodesById(graphNodes(graph), out);
  return out;
}

/**
 * Kanten im kanonischen Format inkl. Legacy-Alias (`from`/`to`).
 * @param {RpgGraph | null | undefined} graph
 * @returns {RpgGraphEdge[]}
 */
export function graphEdges(graph) {
  if (!graph || typeof graph !== 'object') return [];
  const raw = Array.isArray(graph.edges) ? graph.edges : [];
  const out = raw.map(normalizeGraphEdge).filter(Boolean);
  if (out.length > 0) return out;
  /** @type {RpgGraphEdge[]} */
  const collected = [];
  collectStructureEdges(graphNodes(graph), collected);
  return collected;
}

/**
 * Schreibt kanonischen Graph inkl. Legacy-Alias.
 * @param {RpgGraphNode[] | Record<string, RpgGraphNode>} nodesOrMap
 * @param {Array<RpgGraphEdge | Record<string, unknown>>} edges
 * @returns {{ nodesById: Record<string, RpgGraphNode>; nodes: RpgGraphNode[]; quests: RpgGraphNode[]; edges: RpgGraphEdge[] }}
 */
export function makeRpgGraph(nodesOrMap, edges) {
  /** @type {Record<string, RpgGraphNode>} */
  let nodesById = {};
  /** @type {RpgGraphNode[]} */
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
          /** @type {RpgGraphEdge[]} */
          const out = [];
          collectStructureEdges(roots, out);
          return out;
        })();
  if (!Array.isArray(nodesOrMap)) {
    roots = materializeRootsFromNodeMap(nodesById, finalEdges);
  }
  return { nodesById, nodes: roots, quests: roots, edges: finalEdges };
}

/** Leerer Graph: Initialzustand bis Server-Bootstrap (kein Sample-Flash beim Laden). */
export const EMPTY_RPG_GRAPH = /** @type {RpgGraph} */ (makeRpgGraph([], []));

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
        { id: 'm1', parentId: 'main-architect', label: 'Klarheit: ein Satz, wofür die nächsten Jahre da sind', children: [] },
        { id: 'm2', parentId: 'main-architect', label: 'Umgebung so trimmen, dass sie das Ziel trägt, nicht sabotiert', children: [] },
        { id: 'm3', parentId: 'main-architect', label: 'Ein Ritual, das wöchentlich Fortschritt sichtbar macht', children: [] },
        { id: 'm4', parentId: 'main-architect', label: 'Nein sagen zu einer großen Ablenkung', children: [] },
      ],
      questRewards: [{ text: '+2 Klarheit' }, { text: 'Titel: Architekt' }, { text: 'Cutscene: Morgenlicht' }],
    },
    {
      id: 'main-bridge',
      parentId: null,
      title: 'Brücke bauen',
      description:
        'Zwischen dem, der du warst, und dem, der du werden willst, fehlt eine Brücke aus konkreten Taten.',
      children: [
        { id: 'b1', parentId: 'main-bridge', label: 'Eine ehrliche Bilanz: was bleibt, was fliegt', children: [] },
        { id: 'b2', parentId: 'main-bridge', label: 'Ein Gespräch, das du seit Monaten vermeidest', children: [] },
      ],
      questRewards: [{ type: 'item', itemId: 'sample-toolbox', displayName: 'Werkzeugkasten' }],
    },
    {
      id: 'side-read',
      parentId: null,
      title: 'Seiten statt Scrollen',
      description:
        'Nebenquest: wieder mehr Tiefe statt Dauerfeuer. Ein Buch, ein Stift, keine Ausreden.',
      children: [
        { id: 's1', parentId: 'side-read', label: '30 Minuten ohne zweiten Bildschirm', children: [] },
        { id: 's2', parentId: 'side-read', label: 'Ein Kapitel zu Ende lesen', children: [] },
        { id: 's3', parentId: 'side-read', label: 'Eine Notiz, die du in einer Woche noch verstehst', children: [] },
      ],
      questRewards: [{ text: '+XP Lesen' }, { text: 'Cosmetic: Lesezeichen' }],
    },
    {
      id: 'side-walk',
      parentId: null,
      title: 'Draußen-Level',
      description: 'Kurz raus, Kopf leeren, Körper mitnehmen.',
      children: [{ id: 'w1', parentId: 'side-walk', label: '20 Minuten ohne Podcast', children: [] }],
      questRewards: [{ text: 'Buff: Sonnenlicht' }],
    },
    {
      id: 'side-cook',
      parentId: null,
      title: 'Quest: Küche',
      description: 'Etwas kochen, das nicht aus „schnell und müde“ heißt.',
      children: [
        { id: 'c1', parentId: 'side-cook', label: 'Einkaufsliste ohne Impulskauf', children: [] },
        { id: 'c2', parentId: 'side-cook', label: 'Gericht zu Ende gebracht', children: [] },
      ],
      questRewards: [{ text: 'Recipe drop' }],
    },
  ],
  edges: [
    { from: 'side-read', to: 'main-architect' },
    { from: 'side-walk', to: 'main-architect' },
    { from: 'main-architect', to: 'main-bridge' },
    { from: 'side-cook', to: 'main-bridge' },
  ],
};
SAMPLE_RPG_GRAPH.quests = SAMPLE_RPG_GRAPH.nodes;

/**
 * Legacy-Shape: leere Listen; aktive Quests kommen nur aus localStorage + graph.
 * @type {RpgQuestPayloadLegacy}
 */
export const SAMPLE_RPG_QUESTS = {
  main: [],
  side: [],
};
