const ADDED_KEY = 'rpg-quest-added-ids';
const NODE_DONE_KEY = 'rpg-node-done';
const LEGACY_STEP_DONE_KEY = 'rpg-quest-node-done';
const GRAPH_CUSTOM_KEY = 'rpg-quest-graph-custom';

/** @param {unknown} v */
function parseJson(v, fallback) {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** @returns {Set<string>} */
export function loadAddedIds() {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = parseJson(localStorage.getItem(ADDED_KEY), []);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x) => typeof x === 'string'));
}

/** @param {Set<string> | string[]} ids */
export function saveAddedIds(ids) {
  if (typeof localStorage === 'undefined') return;
  const arr = ids instanceof Set ? [...ids] : [...ids];
  localStorage.setItem(ADDED_KEY, JSON.stringify(arr));
}

/** @returns {Record<string, Record<string, boolean>>} */
export function loadNodeDone() {
  if (typeof localStorage === 'undefined') return {};
  const raw = parseJson(
    localStorage.getItem(NODE_DONE_KEY) ?? localStorage.getItem(LEGACY_STEP_DONE_KEY),
    {}
  );
  if (!raw || typeof raw !== 'object') return {};
  /** @type {Record<string, Record<string, boolean>>} */
  const out = {};
  for (const [qid, nodeMap] of Object.entries(raw)) {
    if (!nodeMap || typeof nodeMap !== 'object') continue;
    out[qid] = {};
    for (const [sid, done] of Object.entries(nodeMap)) {
      if (done === true) out[qid][sid] = true;
    }
  }
  return out;
}

/** @param {Record<string, Record<string, boolean>>} nodeDone */
export function saveNodeDone(nodeDone) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(NODE_DONE_KEY, JSON.stringify(nodeDone));
  localStorage.removeItem(LEGACY_STEP_DONE_KEY);
}

/**
 * @returns {{ nodes: unknown[]; edges: unknown[] } | null}
 */
export function loadCustomGraph() {
  if (typeof localStorage === 'undefined') return null;
  const raw = parseJson(localStorage.getItem(GRAPH_CUSTOM_KEY), null);
  if (!raw || typeof raw !== 'object') return null;
  // Akzeptiert neues 'nodes' und Legacy 'quests' Format
  const nodes = raw.nodes ?? raw.quests;
  const edges = raw.edges;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  if (!Array.isArray(edges)) return null;
  return { nodes, edges };
}

/** @param {{ nodes: unknown[]; edges: unknown[] }} graph */
export function saveCustomGraph(graph) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GRAPH_CUSTOM_KEY, JSON.stringify({ nodes: graph.nodes, edges: graph.edges }));
  } catch {
    /* quota */
  }
}

export function clearCustomGraph() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(GRAPH_CUSTOM_KEY);
}

/** Entfernt alle RPG-localStorage-Keys (nach Migration auf Server-Persistenz). */
export function clearAllRpgLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(GRAPH_CUSTOM_KEY);
  localStorage.removeItem(ADDED_KEY);
  localStorage.removeItem(NODE_DONE_KEY);
  localStorage.removeItem(LEGACY_STEP_DONE_KEY);
}
