/**
 * Rekursive Quest-Schritte: Gruppen, optionale Blätter, dependsOn, Step-Rewards,
 * Quest-Rewards mit Freischalt-Prozent. Fortschritt nur über nicht-optionale Blätter.
 */

/** Gespeichert: nur Text. Freischalt-Schwelle wird pro Quest-ID deterministisch „zufällig“ vergeben. */
/** @typedef {{ text: string }} RpgQuestRewardEntry */

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   optional?: boolean;
 *   substeps?: RpgQuestStepNode[];
 *   dependsOn?: string[];
 *   reward?: string;
 *   timeDueAt?: string;
 *   done?: boolean;
 *   orderLinked?: boolean;
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
  let timeDueAt;
  const rawDue = typeof o.timeDueAt === 'string' ? o.timeDueAt.trim() : '';
  if (rawDue) {
    const ymd = rawDue.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) timeDueAt = ymd;
    else {
      const t = Date.parse(rawDue);
      if (!Number.isNaN(t)) timeDueAt = new Date(t).toISOString().slice(0, 10);
    }
  }
  const subsRaw = o.substeps;
  /** @type {RpgQuestStepNode | undefined} */
  let out = { id, label, optional };
  if (dependsOn.length) out = { ...out, dependsOn };
  if (reward) out = { ...out, reward };
  if (timeDueAt) out = { ...out, timeDueAt };
  if (o.orderLinked === true) out = { ...out, orderLinked: true };
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
  return lines.map((text) => ({ text }));
}

/**
 * @param {string} s
 * @returns {number}
 */
export function hashQuestStringToSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {unknown[]} arr
 * @param {() => number} rand
 */
function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

/**
 * Standard-Stufen (wie früher gleichmäßig), zufällig den Belohnungszeilen zugeordnet — stabil pro Quest-ID.
 * @param {string} questId
 * @param {RpgQuestRewardEntry[]} entries
 * @returns {{ text: string; unlockAtPercent: number }[]}
 */
export function resolveQuestRewardUnlockSchedule(questId, entries) {
  const n = entries.length;
  if (n === 0) return [];
  /** @type {number[]} */
  const milestones = [];
  for (let i = 0; i < n; i++) {
    milestones.push(Math.round((100 * (i + 1)) / n));
  }
  const copy = [...milestones];
  const rand = mulberry32(hashQuestStringToSeed(`rpg-quest-rewards:${questId}`));
  shuffleInPlace(copy, rand);
  return entries.map((e, i) => ({
    text: (e.text || '').trim(),
    unlockAtPercent: copy[i],
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
    out.push({ text });
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
    const vis = visiting ?? new Set();
    if (vis.has(stepId)) return false;
    vis.add(stepId);
    for (const d of node.dependsOn || []) {
      if (!isStepNodeComplete(quest, d, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    const subs = node.substeps || [];
    for (const ch of subs) {
      if (ch.optional) continue;
      if (!isStepNodeComplete(quest, ch.id, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    vis.delete(stepId);
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

const MS_WEEK = 7 * 86400000;

/**
 * @param {string} isoYmd
 * @returns {number}
 */
function endOfLocalDayMs(isoYmd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoYmd).trim());
  if (!m) {
    const t = Date.parse(isoYmd);
    return Number.isNaN(t) ? 0 : t;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Noch offene Pflichtschritte mit gesetzter Frist (Quest gilt dann als zeitgebunden).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questHasIncompleteTimeBoundLeaves(quest, stepDone) {
  let found = false;
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (!stepIsLeaf(s)) return;
    if (s.optional) return;
    if (!s.timeDueAt || !String(s.timeDueAt).trim()) return;
    if (isStepNodeComplete(quest, s.id, stepDone)) return;
    found = true;
  });
  return found;
}

/**
 * Dringend: offene Pflichtschritte mit Frist in weniger als einer Woche oder überfällig (für rotes Baum-Symbol).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {number} [nowMs]
 */
export function questHasUrgentTimeBoundLeaves(quest, stepDone, nowMs = Date.now()) {
  let found = false;
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (!stepIsLeaf(s)) return;
    if (s.optional) return;
    const dueRaw = s.timeDueAt && String(s.timeDueAt).trim();
    if (!dueRaw) return;
    if (isStepNodeComplete(quest, s.id, stepDone)) return;
    const dueEnd = endOfLocalDayMs(dueRaw);
    if (!dueEnd) return;
    const remaining = dueEnd - nowMs;
    if (remaining < MS_WEEK) found = true;
  });
  return found;
}

/**
 * Sammelt Step-Rewards (DFS) und Quest-Rewards mit unlocked-Flag.
 * Quest-Reward-Schwellen kommen aus resolveQuestRewardUnlockSchedule (deterministisch pro Quest-ID).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {number} [progressPercentOverride] — z. B. aus questProgress(..., graph): Vorgänger + Folgequests
 */
export function buildRewardDisplayList(quest, stepDone, progressPercentOverride) {
  const pct =
    typeof progressPercentOverride === 'number' && Number.isFinite(progressPercentOverride)
      ? progressPercentOverride
      : questLeafProgressRatio(quest, stepDone).percent;
  /** @type {{ text: string; unlocked: boolean; source: 'step' | 'quest' }[]} */
  const rows = [];
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (typeof s.reward === 'string' && s.reward.trim()) {
      const unlocked = isStepNodeComplete(quest, s.id, stepDone);
      rows.push({ text: s.reward.trim(), unlocked, source: 'step' });
    }
  });
  const qr = resolveQuestRewardUnlockSchedule(quest.id, getQuestRewardEntries(quest));
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
    !/** @type {any} */ (s).reward &&
    !/** @type {any} */ (s).timeDueAt;

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
