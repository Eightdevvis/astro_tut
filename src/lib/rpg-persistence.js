const ADDED_KEY = 'rpg-quest-added-ids';
const STEPS_KEY = 'rpg-quest-step-done';
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
export function loadStepDone() {
  if (typeof localStorage === 'undefined') return {};
  const raw = parseJson(localStorage.getItem(STEPS_KEY), {});
  if (!raw || typeof raw !== 'object') return {};
  /** @type {Record<string, Record<string, boolean>>} */
  const out = {};
  for (const [qid, steps] of Object.entries(raw)) {
    if (!steps || typeof steps !== 'object') continue;
    out[qid] = {};
    for (const [sid, done] of Object.entries(steps)) {
      if (done === true) out[qid][sid] = true;
    }
  }
  return out;
}

/** @param {Record<string, Record<string, boolean>>} stepDone */
export function saveStepDone(stepDone) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STEPS_KEY, JSON.stringify(stepDone));
}

/**
 * @returns {{ quests: unknown[]; edges: unknown[] } | null}
 */
export function loadCustomGraph() {
  if (typeof localStorage === 'undefined') return null;
  const raw = parseJson(localStorage.getItem(GRAPH_CUSTOM_KEY), null);
  if (!raw || typeof raw !== 'object') return null;
  const quests = raw.quests;
  const edges = raw.edges;
  if (!Array.isArray(quests) || quests.length === 0) return null;
  if (!Array.isArray(edges)) return null;
  return { quests, edges };
}

/** @param {{ quests: unknown[]; edges: unknown[] }} graph */
export function saveCustomGraph(graph) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GRAPH_CUSTOM_KEY, JSON.stringify({ quests: graph.quests, edges: graph.edges }));
  } catch {
    /* quota */
  }
}

export function clearCustomGraph() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(GRAPH_CUSTOM_KEY);
}
