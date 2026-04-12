/**
 * Rekursive Quest-Schritte: Gruppen, optionale Blätter, dependsOn, Step-Rewards,
 * Quest-Rewards mit Freischalt-Prozent. Fortschritt nur über nicht-optionale Blätter.
 */

/** @typedef {{ text: string; unlockAtPercent: number }} RpgQuestRewardEntry */

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   optional?: boolean;
 *   substeps?: RpgQuestStepNode[];
 *   dependsOn?: string[];
 *   reward?: string;
 *   done?: boolean;
 * }} RpgQuestStepNode
 */

/**
 * @param {unknown} raw
 * @param {{ n: number }} next
 * @returns {RpgQuestStepNode}
 */
function normalizeOneStep(raw, next) {
  const o = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `s-${next.n++}`;
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : id;
  const optional = !!o.optional;
  const dependsOn = Array.isArray(o.dependsOn)
    ? o.dependsOn.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const reward = typeof o.reward === 'string' && o.reward.trim() ? o.reward.trim() : undefined;
  const subsRaw = o.substeps;
  /** @type {RpgQuestStepNode | undefined} */
  let out = { id, label, optional };
  if (dependsOn.length) out = { ...out, dependsOn };
  if (reward) out = { ...out, reward };
  if (Array.isArray(subsRaw) && subsRaw.length > 0) {
    return { ...out, substeps: normalizeStepsArray(subsRaw, next) };
  }
  return out;
}

/**
 * @param {unknown[]} arr
 * @param {{ n: number }} next
 * @returns {RpgQuestStepNode[]}
 */
function normalizeStepsArray(arr, next) {
  return arr.map((x) => normalizeOneStep(x, next));
}

/**
 * @param {unknown} steps
 * @returns {RpgQuestStepNode[]}
 */
export function normalizeQuestStepsTree(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  return normalizeStepsArray(steps, { n: 0 });
}

/**
 * Flache Legacy-Zeilen → normalisierte Blätter ohne Substufen.
 * @param {{ id: string; label: string }[]} flat
 * @returns {RpgQuestStepNode[]}
 */
export function flatLegacyStepsToNormalized(flat) {
  const next = { n: 0 };
  return flat.map((s) => normalizeOneStep({ id: s.id, label: s.label, optional: false }, next));
}

/**
 * @param {string[]} lines
 * @returns {RpgQuestRewardEntry[]}
 */
export function distributeQuestRewardPercents(lines) {
  const n = lines.length;
  if (n === 0) return [];
  return lines.map((text, i) => ({
    text,
    unlockAtPercent: Math.round((100 * (i + 1)) / n),
  }));
}

/**
 * @param {unknown} raw
 * @returns {RpgQuestRewardEntry[]}
 */
export function normalizeQuestRewards(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {RpgQuestRewardEntry[]} */
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const text = typeof /** @type {any} */ (x).text === 'string' ? String(/** @type {any} */ (x).text).trim() : '';
    if (!text) continue;
    let p = Number(/** @type {any} */ (x).unlockAtPercent);
    if (!Number.isFinite(p)) p = 100;
    p = Math.max(0, Math.min(100, Math.round(p)));
    out.push({ text, unlockAtPercent: p });
  }
  return out;
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @param {string} id
 * @returns {RpgQuestStepNode | null}
 */
export function findStepById(steps, id) {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.substeps?.length) {
      const f = findStepById(s.substeps, id);
      if (f) return f;
    }
  }
  return null;
}

/**
 * @param {RpgQuestStepNode} step
 * @returns {boolean}
 */
export function stepIsLeaf(step) {
  return !Array.isArray(step.substeps) || step.substeps.length === 0;
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @param {(s: RpgQuestStepNode) => void} fn
 */
export function walkStepsPreOrder(steps, fn) {
  for (const s of steps) {
    fn(s);
    if (s.substeps?.length) walkStepsPreOrder(s.substeps, fn);
  }
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {string} stepId
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {Set<string>} [visiting]
 */
export function isStepNodeComplete(quest, stepId, stepDone, visiting) {
  const steps = quest.steps || [];
  const node = findStepById(steps, stepId);
  if (!node) return false;
  const qm = stepDone[quest.id] || {};

  if (!stepIsLeaf(node)) {
    const subs = node.substeps || [];
    for (const ch of subs) {
      if (ch.optional) continue;
      if (!isStepNodeComplete(quest, ch.id, stepDone)) return false;
    }
    return true;
  }

  const vis = visiting ?? new Set();
  if (vis.has(stepId)) return false;

  if (node.optional) {
    if (!qm[node.id]) return false;
    vis.add(stepId);
    for (const d of node.dependsOn || []) {
      if (!isStepNodeComplete(quest, d, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    vis.delete(stepId);
    return true;
  }

  if (!qm[node.id]) return false;
  vis.add(stepId);
  for (const d of node.dependsOn || []) {
    if (!isStepNodeComplete(quest, d, stepDone, vis)) {
      vis.delete(stepId);
      return false;
    }
  }
  vis.delete(stepId);
  return true;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {string} stepId
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {boolean} wantOn
 */
export function canSetStepDone(quest, stepId, stepDone, wantOn) {
  const node = findStepById(quest.steps || [], stepId);
  if (!node || !stepIsLeaf(node)) return false;
  if (!wantOn) return true;
  for (const d of node.dependsOn || []) {
    if (!isStepNodeComplete(quest, d, stepDone)) return false;
  }
  return true;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {RpgQuestStepNode[]} steps
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
function countLeafProgressQuest(quest, steps, stepDone) {
  let total = 0;
  let done = 0;
  for (const s of steps) {
    if (!stepIsLeaf(s)) {
      const sub = countLeafProgressQuest(quest, s.substeps || [], stepDone);
      total += sub.total;
      done += sub.done;
      continue;
    }
    if (s.optional) continue;
    total += 1;
    if (isStepNodeComplete(quest, s.id, stepDone)) done += 1;
  }
  return { total, done };
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @returns {Map<string, RpgQuestStepNode>}
 */
export function buildStepIdMap(steps) {
  /** @type {Map<string, RpgQuestStepNode>} */
  const m = new Map();
  walkStepsPreOrder(steps, (s) => m.set(s.id, s));
  return m;
}

/**
 * Zähler: nicht-optionale Blätter erledigt / Gesamtzahl.
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questLeafProgressRatio(quest, stepDone) {
  const { total, done } = countLeafProgressQuest(quest, quest.steps || [], stepDone);
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questProgressFromSteps(quest, stepDone) {
  return questLeafProgressRatio(quest, stepDone).percent;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function isQuestCompletedFromSteps(quest, stepDone) {
  const { total, percent } = questLeafProgressRatio(quest, stepDone);
  if (total === 0) return true;
  return percent >= 100;
}

/**
 * Sammelt Step-Rewards (DFS) und Quest-Rewards mit unlocked-Flag.
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function buildRewardDisplayList(quest, stepDone) {
  const pct = questLeafProgressRatio(quest, stepDone).percent;
  /** @type {{ text: string; unlocked: boolean; source: 'step' | 'quest' }[]} */
  const rows = [];
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (typeof s.reward === 'string' && s.reward.trim()) {
      const unlocked = isStepNodeComplete(quest, s.id, stepDone);
      rows.push({ text: s.reward.trim(), unlocked, source: 'step' });
    }
  });
  const qr = getQuestRewardEntries(quest);
  for (const r of qr) {
    const unlocked = pct >= r.unlockAtPercent;
    rows.push({ text: r.text, unlocked, source: 'quest' });
  }
  return rows;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} q
 * @returns {RpgQuestRewardEntry[]}
 */
export function getQuestRewardEntries(q) {
  if (Array.isArray(q.questRewards) && q.questRewards.length > 0) {
    return normalizeQuestRewards(q.questRewards);
  }
  const legacy = Array.isArray(q.rewards) ? q.rewards : [];
  return distributeQuestRewardPercents(legacy.map((x) => String(x).trim()).filter(Boolean));
}

/**
 * Migriert eine Quest: `rewards` → `questRewards`, Steps normalisieren.
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} q
 * @returns {import('./rpg-quests-data.js').RpgGraphQuest}
 */
export function migrateQuestToV2Shape(q) {
  const stepsIn = Array.isArray(q.steps) ? q.steps : [];

  const isLegacyFlatRow = (s) =>
    s &&
    typeof s === 'object' &&
    !Array.isArray(/** @type {any} */ (s).substeps)?.length &&
    typeof /** @type {any} */ (s).label === 'string' &&
    !/** @type {any} */ (s).dependsOn?.length &&
    !/** @type {any} */ (s).optional &&
    !/** @type {any} */ (s).reward;

  const looksLegacyFlat = stepsIn.length > 0 && stepsIn.every(isLegacyFlatRow);

  let steps;
  if (looksLegacyFlat) {
    steps = flatLegacyStepsToNormalized(
      stepsIn.map((s) => ({ id: /** @type {any} */ (s).id, label: /** @type {any} */ (s).label }))
    );
  } else {
    steps = normalizeQuestStepsTree(stepsIn);
  }

  let questRewards = normalizeQuestRewards(q.questRewards);
  if (questRewards.length === 0 && Array.isArray(q.rewards) && q.rewards.length > 0) {
    questRewards = distributeQuestRewardPercents(q.rewards.map((x) => String(x).trim()).filter(Boolean));
  }

  const { rewards: _drop, questRewards: _qr, steps: _st, ...rest } = q;
  return {
    ...rest,
    steps,
    questRewards,
  };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {import('./rpg-quests-data.js').RpgGraph}
 */
export function migrateRpgGraphToV2(graph) {
  const quests = (graph.quests || []).map((q) => migrateQuestToV2Shape(q));
  return { quests, edges: graph.edges || [] };
}
