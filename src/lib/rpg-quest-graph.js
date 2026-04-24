import {
  questProgressFromSteps,
  isQuestCompletedFromSteps,
  walkStepsPreOrder,
  stepIsLeaf,
  questLeafProgressRatio,
} from './rpg-quest-steps.js';

/** @typedef {import('./rpg-quest-steps.js').RpgQuestStepNode} RpgQuestStep */
/** @typedef {import('./rpg-quest-steps.js').RpgQuestRewardEntry} RpgQuestRewardEntry */
/** @typedef {{ id: string; parentId: null; title: string; description: string; cityLocation?: string; children: RpgQuestStep[]; rewards?: string[]; questRewards?: (RpgQuestRewardEntry | Record<string, unknown>)[]; orderInLayer?: number; questmakerPrompt?: string }} RpgGraphQuest */
/** @typedef {{ from: string; to: string }} RpgGraphEdge */
/** @typedef {{ quests: RpgGraphQuest[]; edges: RpgGraphEdge[] }} RpgGraph */

/**
 * @param {unknown} g
 * @returns {g is RpgGraph}
 */
export function isValidGraphShape(g) {
  return (
    !!g &&
    typeof g === 'object' &&
    Array.isArray(/** @type {any} */ (g).quests) &&
    Array.isArray(/** @type {any} */ (g).edges)
  );
}

/**
 * Quest-IDs deren Schritte in den Fortschritt einfließen: alle Vorgänger (eingehende Kanten)
 * und alle Folgequests (ausgehende Kanten), jeweils transitiv.
 * @param {RpgGraph} graph
 * @param {string} questId
 * @returns {string[]}
 */
export function collectQuestIdsForAggregatedProgress(graph, questId) {
  const incoming = buildIncomingMap(graph);
  /** @type {Set<string>} */
  const out = new Set();

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

  const down = [questId];
  const seenDown = new Set([questId]);
  while (down.length) {
    const id = down.pop();
    if (typeof id !== 'string') continue;
    out.add(id);
    for (const e of graph.edges || []) {
      if (e.from === id && !seenDown.has(e.to)) {
        seenDown.add(e.to);
        down.push(e.to);
      }
    }
  }

  return [...out];
}

/**
 * @param {RpgGraph} graph
 * @param {RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questLeafProgressRatioAggregated(graph, quest, stepDone) {
  const ids = collectQuestIdsForAggregatedProgress(graph, quest.id);
  const qmap = questMap(graph);
  let total = 0;
  let done = 0;
  for (const qid of ids) {
    const q = qmap.get(qid);
    if (!q) continue;
    const r = questLeafProgressRatio(q, stepDone);
    total += r.total;
    done += r.done;
  }
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * @param {RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {RpgGraph | null | undefined} [graph] — mit Graph: Fortschritt über Vorgänger- + Folgequests (Subquests)
 */
export function questProgress(quest, stepDone, graph) {
  if (!graph || !Array.isArray(graph.quests)) return questProgressFromSteps(quest, stepDone);
  return questLeafProgressRatioAggregated(graph, quest, stepDone).percent;
}

/**
 * @param {RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function isQuestCompleted(quest, stepDone) {
  return isQuestCompletedFromSteps(quest, stepDone);
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

/** @param {boolean} compact */
function layoutShapeRadius(compact) {
  return compact ? 26 : 24;
}

/**
 * Lokale AABB relativ zum Knotenmittelpunkt (SVG wie RpgQuestTree: Label unter dem Shape).
 * @param {RpgGraphQuest} q
 * @param {boolean} compact
 */
function layoutNodeLocalBounds(q, compact) {
  const r = layoutShapeRadius(compact);
  const title = typeof q.title === 'string' ? q.title : '';
  const labelText = title.length > 20 ? `${title.slice(0, 18)}…` : title;
  const charW = compact ? 5.7 : 6.2;
  const labelHalfW = Math.min(78, (Math.max(labelText.length, 1) * charW) / 2);
  const labelBelow = 16;
  const labelH = compact ? 12 : 13;
  const sidePad = 6;
  const halfW = Math.max(r + sidePad, labelHalfW + sidePad);
  return {
    left: -halfW,
    right: halfW,
    top: -(r + sidePad),
    bottom: r + labelBelow + labelH + sidePad,
  };
}

/**
 * Iterativ überlappende Knoten-Hüllen auseinanderdrücken (SAT-Minimum Translation).
 * @param {Record<string, { x: number; y: number }>} positions — wird mutiert
 * @param {RpgGraph} graph
 * @param {boolean} compact
 * @param {{ iterations?: number; extraSeparation?: number }} [opts]
 */
export function resolveQuestNodeCollisions(positions, graph, compact, opts = {}) {
  const iterations = opts.iterations ?? 48;
  const extra = opts.extraSeparation ?? 2;
  const byId = questMap(graph);
  const ids = (graph.quests || []).map((q) => q.id).filter((id) => positions[id]);
  const bounds = new Map(
    ids.map((id) => {
      const q = byId.get(id);
      return [id, q ? layoutNodeLocalBounds(q, compact) : { left: -24, right: 24, top: -28, bottom: 44 }];
    })
  );

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ia = ids[i];
        const ib = ids[j];
        const ba = bounds.get(ia);
        const bb = bounds.get(ib);
        const pa = positions[ia];
        const pb = positions[ib];
        if (!ba || !bb || !pa || !pb) continue;

        const ax0 = pa.x + ba.left;
        const ax1 = pa.x + ba.right;
        const ay0 = pa.y + ba.top;
        const ay1 = pa.y + ba.bottom;
        const bx0 = pb.x + bb.left;
        const bx1 = pb.x + bb.right;
        const by0 = pb.y + bb.top;
        const by1 = pb.y + bb.bottom;

        const overlapX = Math.min(ax1, bx1) - Math.max(ax0, bx0);
        const overlapY = Math.min(ay1, by1) - Math.max(ay0, by0);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (overlapX < overlapY) {
          const mag = overlapX * 0.5 + extra;
          const dir = pa.x < pb.x ? 1 : -1;
          const sx = dir * mag;
          pa.x -= sx;
          pb.x += sx;
        } else {
          const mag = overlapY * 0.5 + extra;
          const dir = pa.y < pb.y ? 1 : -1;
          const sy = dir * mag;
          pa.y -= sy;
          pb.y += sy;
        }
      }
    }
  }
}

/**
 * @param {Record<string, { x: number; y: number }>} positions
 * @param {RpgGraph} graph
 * @param {boolean} compact
 * @param {number} padding
 */
function normalizeLayoutOrigin(positions, graph, compact, padding) {
  const quests = graph.quests || [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of quests) {
    const p = positions[q.id];
    if (!p) continue;
    const b = layoutNodeLocalBounds(q, compact);
    minX = Math.min(minX, p.x + b.left);
    maxX = Math.max(maxX, p.x + b.right);
    minY = Math.min(minY, p.y + b.top);
    maxY = Math.max(maxY, p.y + b.bottom);
  }
  if (!Number.isFinite(minX)) return;
  const dx = padding - minX;
  const dy = padding - minY;
  for (const q of quests) {
    const p = positions[q.id];
    if (p) {
      p.x += dx;
      p.y += dy;
    }
  }
}

/**
 * Layer0 = keine eingehenden Kanten (unten). Höhere Layer = weiter oben.
 * @param {RpgGraph} graph
 * @param {{ rowGap?: number; colGap?: number; padding?: number; compact?: boolean; collisionIterations?: number }} [opts]
 */
export function computeLayeredLayout(graph, opts = {}) {
  const rowGap = opts.rowGap ?? 108;
  const colGap = opts.colGap ?? 128;
  const padding = opts.padding ?? 72;
  const compact = !!opts.compact;
  const quests = graph.quests || [];
  const collisionIterations =
    opts.collisionIterations ?? Math.min(120, 36 + Math.floor(quests.length * 2.5));
  const ids = quests.map((q) => q.id);
  const incoming = buildIncomingMap(graph);

  /** @type {Map<string, number>} */
  const level = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();

  function levelOf(id) {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) {
      // Defensiv gegen fehlerhafte persistierte Zyklen.
      return 0;
    }
    visiting.add(id);
    const preds = incoming.get(id) || [];
    if (preds.length === 0) {
      level.set(id, 0);
      visiting.delete(id);
      return 0;
    }
    const L = Math.max(...preds.map((p) => levelOf(p))) + 1;
    level.set(id, L);
    visiting.delete(id);
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
  const orderOf = (id) => {
    const q = quests.find((x) => x.id === id);
    const o = q?.orderInLayer;
    return typeof o === 'number' && !Number.isNaN(o) ? o : 0;
  };
  for (const row of byLevel.values()) {
    row.sort((a, b) => {
      const da = orderOf(a);
      const db = orderOf(b);
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });
  }

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

  resolveQuestNodeCollisions(positions, graph, compact, { iterations: collisionIterations });
  normalizeLayoutOrigin(positions, graph, compact, padding);

  let maxR = 0;
  let maxB = 0;
  for (const q of quests) {
    const p = positions[q.id];
    if (!p) continue;
    const b = layoutNodeLocalBounds(q, compact);
    maxR = Math.max(maxR, p.x + b.right);
    maxB = Math.max(maxB, p.y + b.bottom);
  }
  const width = Math.ceil(maxR + padding);
  const height = Math.ceil(maxB + padding);
  return { positions, width, height, maxLevel: maxL };
}

/**
 * @param {RpgGraph} graph
 * @param {RpgGraphQuest} quest
 * @param {string[]} prerequisiteIds — Kanten from → quest.id
 */
export function upsertQuestInGraph(graph, quest, prerequisiteIds) {
  const ids = new Set((prerequisiteIds || []).filter((x) => typeof x === 'string'));
  ids.delete(quest.id);
  const prev = (graph.quests || []).find((q) => q.id === quest.id);
  const mergedQuest =
    prev && typeof prev === 'object' ? { ...prev, ...quest } : quest;
  if (Array.isArray(mergedQuest.questRewards)) {
    delete mergedQuest.rewards;
  }
  const quests = (graph.quests || []).filter((q) => q.id !== quest.id);
  quests.push(mergedQuest);
  const edges = (graph.edges || []).filter((e) => e.to !== quest.id);
  for (const from of ids) {
    if (quests.some((q) => q.id === from)) edges.push({ from, to: quest.id });
  }
  return { quests, edges };
}

/** @param {RpgGraph} graph @param {string} questId */
export function removeQuestFromGraph(graph, questId) {
  return {
    quests: (graph.quests || []).filter((q) => q.id !== questId),
    edges: (graph.edges || []).filter((e) => e.from !== questId && e.to !== questId),
  };
}

/** @param {RpgGraph} graph */
export function buildInitialStepMapFromGraph(graph) {
  /** @type {Record<string, Record<string, boolean>>} */
  const m = {};
  for (const q of graph.quests || []) {
    m[q.id] = {};
    walkStepsPreOrder(q.children || [], (s) => {
      if (stepIsLeaf(s) && s.done) m[q.id][s.id] = true;
    });
  }
  return m;
}

/** @param {Record<string, Record<string, boolean>>} serverBase @param {Record<string, Record<string, boolean>>} persisted */
export function mergeStepDoneBase(serverBase, persisted) {
  const out = { ...serverBase };
  for (const qid of Object.keys(persisted)) {
    out[qid] = { ...(out[qid] || {}), ...persisted[qid] };
  }
  return out;
}

export function graphHasCycle(graph) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const q of graph.quests || []) out.set(q.id, []);
  for (const e of graph.edges || []) {
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
