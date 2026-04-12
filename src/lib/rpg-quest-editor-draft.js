/**
 * Entwurfs-Modell für den Quest-Schritt-Editor (UI) ↔ API-Bäume (`rpg-quest-steps`).
 */

import { isRpgItemCategoryId } from './rpg-item-categories.js';
import { normalizeQuestStepsTree, normalizeRewardEntry } from './rpg-quest-steps.js';
import { normalizeQuestmakerCatalogPayloadItem } from './rpg-questmaker-sync.js';

/**
 * @typedef {{
 *   key: string;
 *   stableId?: string;
 *   title: string;
 *   optional: boolean;
 *   rewardOn: boolean;
 *   rewardKind: 'text' | 'item';
 *   rewardText: string;
 *   itemId: string;
 *   itemDisplayName: string;
 *   itemCategory: string;
 *   itemDescription: string;
 *   substepsOn: boolean;
 *   children: QuestStepDraft[];
 *   saved: boolean;
 *   orderLinked: boolean;
 *   legacyDependsOn?: string[];
 *   timeLimitOn?: boolean;
 *   timeDueAt?: string;
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
    rewardKind: 'text',
    rewardText: '',
    itemId: '',
    itemDisplayName: '',
    itemCategory: '',
    itemDescription: '',
    substepsOn: false,
    children: [],
    saved,
    orderLinked: false,
    legacyDependsOn: undefined,
    timeLimitOn: false,
    timeDueAt: '',
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
  const due = typeof node.timeDueAt === 'string' && node.timeDueAt.trim() ? node.timeDueAt.trim().slice(0, 10) : '';
  const rent = normalizeRewardEntry(node.reward);
  const rewardOn = !!rent;
  const rewardKind = rent && rent.type === 'item' ? 'item' : 'text';
  const rewardText = rent && rent.type === 'text' ? rent.text : '';
  const itemId = rent && rent.type === 'item' ? rent.itemId : '';
  const itemDisplayName = rent && rent.type === 'item' && rent.displayName ? rent.displayName : '';
  return {
    key: node.id || newDraftKey(),
    stableId: typeof node.id === 'string' ? node.id : undefined,
    title: typeof node.label === 'string' ? node.label : '',
    optional: !!node.optional,
    rewardOn,
    rewardKind,
    rewardText,
    itemId,
    itemDisplayName,
    itemCategory: '',
    itemDescription: '',
    substepsOn: subs,
    children: subs ? node.substeps.map(questNodeToDraft) : [],
    saved: true,
    orderLinked: node.orderLinked === true,
    legacyDependsOn: legacyDeps,
    timeLimitOn: !!due,
    timeDueAt: due,
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
  /** @type {import('./rpg-quest-steps.js').RpgQuestRewardEntry | undefined} */
  let reward;
  if (d.rewardOn) {
    if (d.rewardKind === 'item' && (d.itemId || '').trim()) {
      const itemId = (d.itemId || '').trim();
      const dn = (d.itemDisplayName || '').trim();
      reward = dn ? { type: 'item', itemId, displayName: dn } : { type: 'item', itemId };
    } else if ((d.rewardText || '').trim()) {
      reward = { type: 'text', text: (d.rewardText || '').trim() };
    }
  }
  const due =
    d.timeLimitOn && (d.timeDueAt || '').trim()
      ? (d.timeDueAt || '').trim().slice(0, 10)
      : undefined;
  const meaningfulKids = d.children.filter(isDraftStepMeaningful);

  if (d.substepsOn && meaningfulKids.length > 0) {
    const substeps = processDraftSiblings(meaningfulKids, idCounter);
    /** @type {import('./rpg-quest-steps.js').RpgQuestStepNode} */
    const out = { id, label, optional, substeps };
    if (chainDependsOn.length) out.dependsOn = [...chainDependsOn];
    if (reward) out.reward = reward;
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) out.timeDueAt = due;
    if (d.orderLinked) out.orderLinked = true;
    return out;
  }

  /** @type {import('./rpg-quest-steps.js').RpgQuestStepNode} */
  const leaf = { id, label, optional };
  if (chainDependsOn.length) leaf.dependsOn = [...chainDependsOn];
  if (reward) leaf.reward = reward;
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) leaf.timeDueAt = due;
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
    timeLimitOn: false,
    timeDueAt: '',
  }));
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestStepNode[]} nodes
 * @returns {QuestStepDraft[]}
 */
export function aiQuestNodesToDraftSteps(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return questStepsToDrafts(normalizeQuestStepsTree(nodes));
}

/**
 * @typedef {{
 *   key: string;
 *   kind: 'text' | 'item';
 *   text: string;
 *   itemId: string;
 *   displayName: string;
 *   itemCategory: string;
 *   itemDescription: string;
 * }} QuestRewardDraftRow
 */

/** @returns {QuestRewardDraftRow} */
export function createEmptyRewardRow() {
  return {
    key: newDraftKey(),
    kind: 'text',
    text: '',
    itemId: '',
    displayName: '',
    itemCategory: '',
    itemDescription: '',
  };
}

/**
 * Ältere localStorage-Entwürfe ohne `kind` / Item-Felder.
 * @param {unknown} raw
 * @returns {QuestRewardDraftRow}
 */
export function ensureRewardRowFields(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyRewardRow();
  const r = /** @type {Record<string, unknown>} */ (raw);
  const key = typeof r.key === 'string' && r.key ? r.key : newDraftKey();
  if (r.kind === 'item') {
    return {
      key,
      kind: 'item',
      text: '',
      itemId: typeof r.itemId === 'string' ? r.itemId : '',
      displayName: typeof r.displayName === 'string' ? r.displayName : '',
      itemCategory: typeof r.itemCategory === 'string' ? r.itemCategory : '',
      itemDescription: typeof r.itemDescription === 'string' ? r.itemDescription : '',
    };
  }
  return {
    key,
    kind: 'text',
    text: typeof r.text === 'string' ? r.text : '',
    itemId: '',
    displayName: '',
    itemCategory: '',
    itemDescription: '',
  };
}

/**
 * @param {unknown} raw
 * @returns {QuestStepDraft}
 */
export function ensureStepDraftFields(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyStepDraft(false);
  const d = /** @type {QuestStepDraft} */ ({ ...createEmptyStepDraft(!!/** @type {any} */ (raw).saved), ...raw });
  if (d.rewardKind !== 'text' && d.rewardKind !== 'item') {
    d.rewardKind = (d.itemId || '').trim() ? 'item' : 'text';
  }
  if (typeof d.itemId !== 'string') d.itemId = '';
  if (typeof d.itemDisplayName !== 'string') d.itemDisplayName = '';
  if (typeof d.itemCategory !== 'string') d.itemCategory = '';
  if (typeof d.itemDescription !== 'string') d.itemDescription = '';
  if (typeof d.rewardText !== 'string') d.rewardText = '';
  if (Array.isArray(d.children) && d.children.length > 0) {
    d.children = d.children.map((c) => ensureStepDraftFields(c));
  }
  return d;
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestRewardEntry[] | undefined} entries
 * @returns {QuestRewardDraftRow[]}
 */
export function questRewardsToDraftRows(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries.map((e) => {
    if (e.type === 'item') {
      return {
        key: newDraftKey(),
        kind: 'item',
        text: '',
        itemId: e.itemId,
        displayName: e.displayName || '',
        itemCategory: '',
        itemDescription: '',
      };
    }
    return {
      key: newDraftKey(),
      kind: 'text',
      text: e.text,
      itemId: '',
      displayName: '',
      itemCategory: '',
      itemDescription: '',
    };
  });
}

/**
 * @param {QuestRewardDraftRow[]} rows
 * @returns {import('./rpg-quest-steps.js').RpgQuestRewardEntry[]}
 */
export function draftRewardRowsToQuestRewards(rows) {
  /** @type {import('./rpg-quest-steps.js').RpgQuestRewardEntry[]} */
  const out = [];
  for (const r of rows) {
    if (r.kind === 'item' && (r.itemId || '').trim()) {
      const itemId = (r.itemId || '').trim();
      const dn = (r.displayName || '').trim();
      out.push(dn ? { type: 'item', itemId, displayName: dn } : { type: 'item', itemId });
    } else if (r.kind === 'text' && (r.text || '').trim()) {
      out.push({ type: 'text', text: (r.text || '').trim() });
    }
  }
  return out;
}

/**
 * Vollständige Katalog-Zeilen aus Entwürfen (nur IDs, die noch nicht im Katalog sind).
 * @param {QuestStepDraft[]} stepDrafts
 * @param {QuestRewardDraftRow[]} rewardRows
 * @param {Set<string> | Record<string, unknown>} catalogIdSet
 * @returns {{ id: string; category: string; title: string; description: string }[]}
 */
export function collectQuestmakerItemsFromDrafts(stepDrafts, rewardRows, catalogIdSet) {
  const inCatalog =
    catalogIdSet instanceof Set
      ? catalogIdSet
      : new Set(Object.keys(/** @type {Record<string, unknown>} */ (catalogIdSet)));
  /** @type {Map<string, { id: string; category: string; title: string; description: string }>} */
  const map = new Map();
  /** @param {QuestStepDraft} d */
  function walk(d) {
    if (d.rewardOn && d.rewardKind === 'item' && (d.itemId || '').trim()) {
      const id = d.itemId.trim();
      if (inCatalog.has(id)) return;
      const row = {
        id,
        category: isRpgItemCategoryId((d.itemCategory || '').trim())
          ? /** @type {string} */ ((d.itemCategory || '').trim())
          : 'sonstiges',
        title: (d.itemDisplayName || '').trim(),
        description: (d.itemDescription || '').trim(),
      };
      const n = normalizeQuestmakerCatalogPayloadItem(row);
      if (n) map.set(id, n);
    }
    for (const c of d.children || []) walk(c);
  }
  for (const d of stepDrafts) walk(d);
  for (const r of rewardRows) {
    if (r.kind !== 'item' || !(r.itemId || '').trim()) continue;
    const id = r.itemId.trim();
    if (inCatalog.has(id)) continue;
    const row = {
      id,
      category: isRpgItemCategoryId((r.itemCategory || '').trim())
        ? /** @type {string} */ ((r.itemCategory || '').trim())
        : 'sonstiges',
      title: (r.displayName || '').trim(),
      description: (r.itemDescription || '').trim(),
    };
    const n = normalizeQuestmakerCatalogPayloadItem(row);
    if (n) map.set(id, n);
  }
  return [...map.values()];
}
