/**
 * Entwurfs-Modell für den Quest-Schritt-Editor (UI) ↔ API-Bäume (`rpg-quest-steps`).
 */

import { normalizeQuestStepsTree } from './rpg-quest-steps.js';

/**
 * @typedef {{
 *   key: string;
 *   stableId?: string;
 *   title: string;
 *   optional: boolean;
 *   rewardOn: boolean;
 *   rewardText: string;
 *   substepsOn: boolean;
 *   children: QuestStepDraft[];
 *   saved: boolean;
 *   orderLinked: boolean;
 *   legacyDependsOn?: string[];
 * }} QuestStepDraft
 */

/** @returns {string} */
export function newDraftKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {boolean} [saved]
 * @returns {QuestStepDraft}
 */
export function createEmptyStepDraft(saved = false) {
  return {
    key: newDraftKey(),
    title: '',
    optional: false,
    rewardOn: false,
    rewardText: '',
    substepsOn: false,
    children: [],
    saved,
    orderLinked: false,
    legacyDependsOn: undefined,
  };
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestStepNode} node
 * @returns {QuestStepDraft}
 */
export function questNodeToDraft(node) {
  const subs = Array.isArray(node.substeps) && node.substeps.length > 0;
  const legacyDeps =
    node.orderLinked === true
      ? undefined
      : Array.isArray(node.dependsOn) && node.dependsOn.length > 0
        ? [...node.dependsOn]
        : undefined;
  return {
    key: node.id || newDraftKey(),
    stableId: typeof node.id === 'string' ? node.id : undefined,
    title: typeof node.label === 'string' ? node.label : '',
    optional: !!node.optional,
    rewardOn: !!(typeof node.reward === 'string' && node.reward.trim()),
    rewardText: typeof node.reward === 'string' ? node.reward : '',
    substepsOn: subs,
    children: subs ? node.substeps.map(questNodeToDraft) : [],
    saved: true,
    orderLinked: node.orderLinked === true,
    legacyDependsOn: legacyDeps,
  };
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestStepNode[] | undefined} nodes
 * @returns {QuestStepDraft[]}
 */
export function questStepsToDrafts(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return nodes.map(questNodeToDraft);
}

/**
 * @param {QuestStepDraft} d
 * @returns {boolean}
 */
export function isDraftStepMeaningful(d) {
  if ((d.title || '').trim().length > 0) return true;
  if (d.substepsOn && d.children.length > 0) {
    return d.children.some(isDraftStepMeaningful);
  }
  return false;
}

/**
 * @param {QuestStepDraft[]} arr
 * @param {number} fromIdx
 * @param {number} toIdx
 * @returns {QuestStepDraft[]}
 */
export function reorderDraftSteps(arr, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) {
    return arr;
  }
  const next = [...arr];
  const [it] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, it);
  return next;
}

/**
 * @param {QuestStepDraft} d
 * @param {string} id
 * @param {string[]} chainDependsOn
 * @param {{ n: number }} idCounter
 * @returns {import('./rpg-quest-steps.js').RpgQuestStepNode}
 */
function buildRawFromDraft(d, id, chainDependsOn, idCounter) {
  const label = (d.title || '').trim() || 'Schritt';
  const optional = !!d.optional;
  const reward =
    d.rewardOn && (d.rewardText || '').trim() ? (d.rewardText || '').trim() : undefined;
  const meaningfulKids = d.children.filter(isDraftStepMeaningful);

  if (d.substepsOn && meaningfulKids.length > 0) {
    const substeps = processDraftSiblings(meaningfulKids, idCounter);
    /** @type {import('./rpg-quest-steps.js').RpgQuestStepNode} */
    const out = { id, label, optional, substeps };
    if (chainDependsOn.length) out.dependsOn = [...chainDependsOn];
    if (reward) out.reward = reward;
    if (d.orderLinked) out.orderLinked = true;
    return out;
  }

  /** @type {import('./rpg-quest-steps.js').RpgQuestStepNode} */
  const leaf = { id, label, optional };
  if (chainDependsOn.length) leaf.dependsOn = [...chainDependsOn];
  if (reward) leaf.reward = reward;
  if (d.orderLinked) leaf.orderLinked = true;
  return leaf;
}

/**
 * @param {QuestStepDraft[]} meaningfulSiblings
 * @param {{ n: number }} idCounter
 * @returns {import('./rpg-quest-steps.js').RpgQuestStepNode[]}
 */
function processDraftSiblings(meaningfulSiblings, idCounter) {
  let lastChainId = /** @type {string | null} */ (null);
  /** @type {import('./rpg-quest-steps.js').RpgQuestStepNode[]} */
  const out = [];

  for (const d of meaningfulSiblings) {
    const id = d.stableId?.trim() || `s-${idCounter.n++}`;
    /** @type {string[]} */
    let deps = [];
    if (d.orderLinked) {
      deps = lastChainId ? [lastChainId] : [];
      lastChainId = id;
    } else if (d.legacyDependsOn?.length) {
      deps = [...d.legacyDependsOn];
    }
    out.push(buildRawFromDraft(d, id, deps, idCounter));
  }
  return out;
}

/**
 * @param {QuestStepDraft[]} drafts
 * @returns {import('./rpg-quest-steps.js').RpgQuestStepNode[]}
 */
export function draftStepsToQuestNodes(drafts) {
  const idCounter = { n: 0 };
  const meaningful = drafts.filter(isDraftStepMeaningful);
  const raw = processDraftSiblings(meaningful, idCounter);
  return normalizeQuestStepsTree(raw);
}

/**
 * @param {string[]} labels
 * @returns {QuestStepDraft[]}
 */
export function aiLabelsToDraftSteps(labels) {
  const arr = Array.isArray(labels) ? labels.map((x) => String(x).trim()).filter(Boolean) : [];
  return arr.map((title) => ({
    ...createEmptyStepDraft(true),
    title,
    key: newDraftKey(),
    orderLinked: false,
    legacyDependsOn: undefined,
  }));
}

/**
 * @typedef {{ key: string; text: string; unlockAtPercent: number }} QuestRewardDraftRow
 */

/** @returns {QuestRewardDraftRow} */
export function createEmptyRewardRow() {
  return { key: newDraftKey(), text: '', unlockAtPercent: 50 };
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestRewardEntry[] | undefined} entries
 * @returns {QuestRewardDraftRow[]}
 */
export function questRewardsToDraftRows(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries.map((e) => ({
    key: newDraftKey(),
    text: typeof e.text === 'string' ? e.text : '',
    unlockAtPercent:
      typeof e.unlockAtPercent === 'number' && Number.isFinite(e.unlockAtPercent)
        ? Math.max(0, Math.min(100, Math.round(e.unlockAtPercent)))
        : 100,
  }));
}

/**
 * @param {QuestRewardDraftRow[]} rows
 * @returns {import('./rpg-quest-steps.js').RpgQuestRewardEntry[]}
 */
export function draftRewardRowsToQuestRewards(rows) {
  return rows
    .map((r) => ({
      text: (r.text || '').trim(),
      unlockAtPercent: Math.max(0, Math.min(100, Math.round(Number(r.unlockAtPercent) || 0))),
    }))
    .filter((r) => r.text.length > 0);
}
