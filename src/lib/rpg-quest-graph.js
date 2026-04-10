/** @typedef {{ id: string; label: string; done?: boolean }} RpgQuestStep */
/** @typedef {{ id: string; kind: 'main' | 'side'; title: string; description: string; steps: RpgQuestStep[]; rewards: string[] }} RpgGraphQuest */
/** @typedef {{ from: string; to: string }} RpgGraphEdge */
/** @typedef {{ quests: RpgGraphQuest[]; edges: RpgGraphEdge[] }} RpgGraph */

/**
 * @param {RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questProgress(quest, stepDone) {
  const steps = quest.steps || [];
  if (steps.length === 0) return 0;
  let n = 0;
  const map = stepDone[quest.id] || {};
  for (const s of steps) {
    const done = map[s.id] ?? !!s.done;
    if (done) n += 1;
  }
  return Math.round((n / steps.length) * 100);
}

/**
 * @param {RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function isQuestCompleted(quest, stepDone) {
  return questProgress(quest, stepDone) >= 100;
}

/**
 * @param {RpgGraph} graph
 * @returns {Map<string, string[]>}
 */
export function buildIncomingMap(graph) {
  /** @type {Map<string, string[]>} */
  const incoming = new Map();
  for (const q of graph.quests) {
    incoming.set(q.id, []);
  }
  for (const e of graph.edges || []) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }
  return incoming;
}

/**
 * @param {string} questId
 * @param {RpgGraph} graph
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {Map<string, RpgGraphQuest>} byId
 */
export function isQuestUnlocked(questId, graph, stepDone, byId) {
  const incoming = buildIncomingMap(graph);
  const preds = incoming.get(questId) || [];
  if (preds.length === 0) return true;
  for (const p of preds) {
    const pq = byId.get(p);
    if (!pq || !isQuestCompleted(pq, stepDone)) return false;
  }
  return true;
}

/**
 * Nur hinzugefügte IDs, die weiterhin unlocked und nicht completed sind.
 * @param {Set<string>} added
 * @param {RpgGraph} graph
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function sanitizeAddedIds(added, graph, stepDone) {
  const byId = questMap(graph);
  const next = new Set();
  for (const id of added) {
    const q = byId.get(id);
    if (!q) continue;
    if (isQuestCompleted(q, stepDone)) continue;
    if (!isQuestUnlocked(id, graph, stepDone, byId)) continue;
    next.add(id);
  }
  return next;
}

/** @param {RpgGraph} graph */
export function questMap(graph) {
  /** @type {Map<string, RpgGraphQuest>} */
  const m = new Map();
  for (const q of graph.quests || []) m.set(q.id, q);
  return m;
}

/**
 * Layer0 = keine eingehenden Kanten (unten). Höhere Layer = weiter oben.
 * @param {RpgGraph} graph
 * @param {{ rowGap?: number; colGap?: number; padding?: number }} [opts]
 */
export function computeLayeredLayout(graph, opts = {}) {
  const rowGap = opts.rowGap ?? 108;
  const colGap = opts.colGap ?? 128;
  const padding = opts.padding ?? 72;

  const quests = graph.quests || [];
  const ids = quests.map((q) => q.id);
  const incoming = buildIncomingMap(graph);

  /** @type {Map<string, number>} */
  const level = new Map();

  function levelOf(id) {
    if (level.has(id)) return level.get(id);
    const preds = incoming.get(id) || [];
    if (preds.length === 0) {
      level.set(id, 0);
      return 0;
    }
    const L = Math.max(...preds.map((p) => levelOf(p))) + 1;
    level.set(id, L);
    return L;
  }

  for (const id of ids) levelOf(id);
  const maxL = ids.length ? Math.max(...ids.map((id) => level.get(id) ?? 0)) : 0;

  /** @type {Map<number, string[]>} */
  const byLevel = new Map();
  for (const id of ids) {
    const L = level.get(id) ?? 0;
    if (!byLevel.has(L)) byLevel.set(L, []);
    byLevel.get(L).push(id);
  }
  for (const row of byLevel.values()) row.sort((a, b) => a.localeCompare(b));

  let maxRowW = 0;
  for (let L = 0; L <= maxL; L++) {
    const row = byLevel.get(L) || [];
    const rowW = row.length > 0 ? (row.length - 1) * colGap : 0;
    maxRowW = Math.max(maxRowW, rowW);
  }

  const centerX = padding + maxRowW / 2;
  /** @type {Record<string, { x: number; y: number }>} */
  const positions = {};

  for (let L = 0; L <= maxL; L++) {
    const row = byLevel.get(L) || [];
    const rowW = row.length > 0 ? (row.length - 1) * colGap : 0;
    const startX = centerX - rowW / 2;
    row.forEach((id, i) => {
      positions[id] = {
        x: startX + i * colGap,
        y: padding + (maxL - L) * rowGap,
      };
    });
  }

  const width = padding * 2 + maxRowW + 80;
  const height = padding * 2 + (maxL + 1) * rowGap;
  return { positions, width, height, maxLevel: maxL };
}
