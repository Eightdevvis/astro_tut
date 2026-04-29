/**
 * Entwurfs-Modell für den Quest-Schritt-Editor (UI) ↔ API-Bäume (`rpg-quest-nodes`).
 */

import { isRpgItemCategoryId } from './rpg-item-categories.js';
import { normalizeQuestNodesTree } from './rpg-quest-nodes.js';
import { normalizeRewardEntry } from './rpg-quest-rewards.js';
import { normalizeQuestmakerCatalogPayloadItem } from './rpg-questmaker-sync.js';
import { normalizeQuestId } from './rpg-quest-form-helpers.js';

/**
 * @typedef {{
 *   key: string;
 *   stableId?: string;
 *   title: string;
 *   description: string;
 *   optional: boolean;
 *   rewardOn: boolean;
 *   rewardRows: QuestRewardDraftRow[];
 *   rewardKind: 'text' | 'item' | 'points' | 'achievement';
 *   rewardText: string;
 *   itemId: string;
 *   itemDisplayName: string;
 *   itemCategory: string;
 *   itemDescription: string;
 *   achievementId: string;
 *   achievementDisplayName: string;
 *   pointKind: 'heart' | 'mana';
 *   pointsAmount: string;
 *   subnodesOn: boolean;
 *   children: QuestNodeDraft[];
 *   saved: boolean;
 *   orderLinked: boolean;
 *   isLock: boolean;
 *   legacyDependsOn?: string[];
 *   timeLimitOn?: boolean;
 *   timeDueAt?: string;
 * }} QuestNodeDraft
 */

/** @returns {string} */
export function newDraftKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {boolean} [saved]
 * @returns {QuestNodeDraft}
 */
export function createEmptyNodeDraft(saved = false) {
  return {
    key: newDraftKey(),
    title: '',
    description: '',
    optional: false,
    rewardOn: false,
    rewardRows: [],
    rewardKind: 'text',
    rewardText: '',
    itemId: '',
    itemDisplayName: '',
    itemCategory: '',
    itemDescription: '',
    achievementId: '',
    achievementDisplayName: '',
    pointKind: 'heart',
    pointsAmount: '',
    subnodesOn: false,
    children: [],
    saved,
    orderLinked: false,
    isLock: false,
    legacyDependsOn: undefined,
    timeLimitOn: false,
    timeDueAt: '',
  };
}

/**
 * @param {import('./rpg-quests-data.js').RpgNode} node
 * @returns {QuestNodeDraft}
 */
export function questNodeToDraft(node) {
  const subs = Array.isArray(node.children) && node.children.length > 0;
  const legacyDeps =
    Array.isArray(node.dependsOn) && node.dependsOn.length > 0 ? [...node.dependsOn] : undefined;
  const due = typeof node.timeDueAt === 'string' && node.timeDueAt.trim() ? node.timeDueAt.trim().slice(0, 10) : '';
  // Neues Format: rewards[] (Array), Legacy: reward (Einzeleintrag)
  const rent = normalizeRewardEntry(Array.isArray(node.rewards) && node.rewards.length > 0 ? node.rewards[0] : node.reward);
  const rewardOn = !!rent;
  const rewardKind =
    rent?.type === 'item' ? 'item' :
    rent?.type === 'points' ? 'points' :
    rent?.type === 'achievement' ? 'achievement' : 'text';
  const rewardText = rent && rent.type === 'text' ? rent.text : '';
  const itemId = rent && rent.type === 'item' ? rent.itemId : '';
  const itemDisplayName = rent && rent.type === 'item' && rent.displayName ? rent.displayName : '';
  const achievementId = rent && rent.type === 'achievement' ? rent.achievementId : '';
  const achievementDisplayName = rent && rent.type === 'achievement' && rent.displayName ? rent.displayName : '';
  const pointKind = rent && rent.type === 'points' ? rent.pointKind : 'heart';
  const pointsAmount = rent && rent.type === 'points' ? String(rent.amount) : '';
  return {
    key: node.id || newDraftKey(),
    stableId: typeof node.id === 'string' ? node.id : undefined,
    title: typeof node.title === 'string' ? node.title : '',
    description: typeof node.description === 'string' ? node.description : '',
    optional: !!node.optional,
    rewardOn,
    rewardKind,
    rewardText,
    rewardRows: questRewardsToDraftRows(Array.isArray(node.rewards) ? node.rewards : rent ? [rent] : []),
    itemId,
    itemDisplayName,
    itemCategory: '',
    itemDescription: '',
    achievementId,
    achievementDisplayName,
    pointKind,
    pointsAmount,
    subnodesOn: subs,
    children: subs ? node.children.map(questNodeToDraft) : [],
    saved: true,
    orderLinked: node.orderLinked === true,
    isLock: node.isLock === true,
    legacyDependsOn: legacyDeps,
    timeLimitOn: !!due,
    timeDueAt: due,
  };
}

/**
 * @param {import('./rpg-quests-data.js').RpgNode[] | undefined} nodes
 * @returns {QuestNodeDraft[]}
 */
export function questNodesToDrafts(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return nodes.map(questNodeToDraft);
}

/**
 * @param {QuestNodeDraft} d
 * @returns {boolean}
 */
export function isDraftNodeMeaningful(d) {
  if ((d.title || '').trim().length > 0) return true;
  if (d.children.length > 0) {
    return d.children.some(isDraftNodeMeaningful);
  }
  return false;
}

/**
 * @param {QuestNodeDraft[]} arr
 * @param {number} fromIdx
 * @param {number} toIdx
 * @returns {QuestNodeDraft[]}
 */
export function reorderDraftNodes(arr, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) {
    return arr;
  }
  const next = [...arr];
  const [it] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, it);
  return next;
}

/**
 * @param {string} label
 * @param {Set<string>} usedIds
 * @returns {string}
 */
function makeUniqueNodeIdFromLabel(label, usedIds) {
  const raw = String(label || '').trim();
  const base = normalizeQuestId(raw) || 'node';
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let n = 2;
  while (usedIds.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  usedIds.add(id);
  return id;
}

/**
 * @param {QuestNodeDraft} d
 * @param {string} id
 * @param {string[]} chainDependsOn
 * @param {Set<string>} usedIds
 * @param {string | null} parentId
 * @returns {import('./rpg-quests-data.js').RpgNode}
 */
function buildRawFromDraft(d, id, chainDependsOn, usedIds, parentId) {
  const label = (d.title || '').trim() || 'Schritt';
  const description = (d.description || '').trim();
  const optional = !!d.optional;
  // Rewards kommen aus rewardRows[] (kanonisches Array-Format)
  const rewards = draftRewardRowsToQuestRewards(d.rewardRows || []);
  const due =
    d.timeLimitOn && (d.timeDueAt || '').trim()
      ? (d.timeDueAt || '').trim().slice(0, 10)
      : undefined;
  const meaningfulKids = d.children.filter(isDraftNodeMeaningful);

  if (meaningfulKids.length > 0) {
    const children = processDraftSiblings(meaningfulKids, usedIds, id);
    // Kanonisches Feld ist 'title', nicht 'label' — wichtig fuer Normalisierung und DB-Persistenz.
    /** @type {import('./rpg-quests-data.js').RpgNode} */
    const out = { id, parentId, title: label, optional, children, ...(description ? { description } : {}) };
    if (chainDependsOn.length) out.dependsOn = [...chainDependsOn];
    if (rewards.length) out.rewards = rewards;
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) out.timeDueAt = due;
    if (d.orderLinked) out.orderLinked = true;
    if (d.isLock) out.isLock = true;
    return out;
  }

  // Kanonisches Feld ist 'title', nicht 'label' — wichtig fuer Normalisierung und DB-Persistenz.
  /** @type {import('./rpg-quests-data.js').RpgNode} */
  const leaf = { id, parentId, title: label, optional, children: [], ...(description ? { description } : {}) };
  if (chainDependsOn.length) leaf.dependsOn = [...chainDependsOn];
  if (rewards.length) leaf.rewards = rewards;
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) leaf.timeDueAt = due;
  if (d.orderLinked) leaf.orderLinked = true;
  if (d.isLock) leaf.isLock = true;
  return leaf;
}

/**
 * @param {QuestNodeDraft[]} meaningfulSiblings
 * @param {Set<string>} usedIds
 * @param {string | null} parentId
 * @returns {import('./rpg-quests-data.js').RpgNode[]}
 */
function processDraftSiblings(meaningfulSiblings, usedIds, parentId) {
  /** @type {import('./rpg-quests-data.js').RpgNode[]} */
  const out = [];

  for (const d of meaningfulSiblings) {
    const label = (d.title || '').trim() || 'Schritt';
    const stableId = typeof d.stableId === 'string' ? d.stableId.trim() : '';
    const id =
      stableId && !usedIds.has(stableId)
        ? (usedIds.add(stableId), stableId)
        : makeUniqueNodeIdFromLabel(label, usedIds);
    /** @type {string[]} */
    const deps = d.legacyDependsOn?.length ? [...d.legacyDependsOn] : [];
    out.push(buildRawFromDraft(d, id, deps, usedIds, parentId));
  }
  return out;
}

/**
 * @param {QuestNodeDraft[]} drafts
 * @param {string | null} [rootParentId]
 * @returns {import('./rpg-quests-data.js').RpgNode[]}
 */
export function draftNodesToQuestNodes(drafts, rootParentId = null, initialUsedIds = undefined) {
  const usedIds = initialUsedIds instanceof Set ? new Set(initialUsedIds) : new Set();
  const meaningful = drafts.filter(isDraftNodeMeaningful);
  const raw = processDraftSiblings(meaningful, usedIds, rootParentId);
  return normalizeQuestNodesTree(raw, rootParentId);
}

/**
 * @param {string[]} labels
 * @returns {QuestNodeDraft[]}
 */
export function aiLabelsToDraftNodes(labels) {
  const arr = Array.isArray(labels) ? labels.map((x) => String(x).trim()).filter(Boolean) : [];
  return arr.map((title) => ({
    ...createEmptyNodeDraft(true),
    title,
    key: newDraftKey(),
    orderLinked: false,
    isLock: false,
    legacyDependsOn: undefined,
    timeLimitOn: false,
    timeDueAt: '',
  }));
}

/**
 * @param {import('./rpg-quests-data.js').RpgNode[]} nodes
 * @returns {QuestNodeDraft[]}
 */
export function aiQuestNodesToDraftNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  return questNodesToDrafts(normalizeQuestNodesTree(nodes));
}

/**
 * @typedef {{
 *   key: string;
 *   kind: 'text' | 'item' | 'points' | 'achievement';
 *   text: string;
 *   itemId: string;
 *   displayName: string;
 *   itemCategory: string;
 *   itemDescription: string;
 *   achievementId: string;
 *   achievementTitle: string;
 *   pointKind: 'heart' | 'mana';
 *   pointsAmount: string;
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
    achievementId: '',
    achievementTitle: '',
    pointKind: 'heart',
    pointsAmount: '',
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
      achievementId: '',
      achievementTitle: '',
      pointKind: r.pointKind === 'mana' ? 'mana' : 'heart',
      pointsAmount: typeof r.pointsAmount === 'string' ? r.pointsAmount : '',
    };
  }
  if (r.kind === 'achievement') {
    return {
      key,
      kind: 'achievement',
      text: '',
      itemId: '',
      displayName: '',
      itemCategory: '',
      itemDescription: '',
      achievementId: typeof r.achievementId === 'string' ? r.achievementId : '',
      achievementTitle: typeof r.achievementTitle === 'string' ? r.achievementTitle : '',
      pointKind: 'heart',
      pointsAmount: '',
    };
  }
  if (r.kind === 'points') {
    return {
      key,
      kind: 'points',
      text: '',
      itemId: '',
      displayName: '',
      itemCategory: '',
      itemDescription: '',
      achievementId: '',
      achievementTitle: '',
      pointKind: r.pointKind === 'mana' ? 'mana' : 'heart',
      pointsAmount: typeof r.pointsAmount === 'string' ? r.pointsAmount : '',
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
    achievementId: '',
    achievementTitle: '',
    pointKind: r.pointKind === 'mana' ? 'mana' : 'heart',
    pointsAmount: typeof r.pointsAmount === 'string' ? r.pointsAmount : '',
  };
}

/**
 * Baut einen kanonischen RewardEntry aus alten Single-Reward-Feldern eines QuestNodeDraft.
 * Nur für die Migration in ensureNodeDraftFields.
 * @param {any} d
 * @returns {import('./rpg-quests-data.js').RpgRewardEntry | null}
 */
function _legacySingleRewardToEntry(d) {
  if (d.rewardKind === 'item' && (d.itemId || '').trim()) {
    const itemId = d.itemId.trim();
    const dn = (d.itemDisplayName || '').trim();
    return dn ? { type: 'item', itemId, displayName: dn } : { type: 'item', itemId };
  }
  if (d.rewardKind === 'achievement' && (d.achievementId || '').trim()) {
    const achievementId = d.achievementId.trim();
    const dn = (d.achievementDisplayName || '').trim();
    return dn ? { type: 'achievement', achievementId, displayName: dn } : { type: 'achievement', achievementId };
  }
  if (d.rewardKind === 'points' && (d.pointsAmount || '').trim()) {
    const n = Number(String(d.pointsAmount).trim());
    if (Number.isFinite(n)) return { type: 'points', pointKind: d.pointKind === 'mana' ? 'mana' : 'heart', amount: Math.trunc(n) };
  }
  if ((d.rewardText || '').trim()) return { type: 'text', text: d.rewardText.trim() };
  return null;
}

/**
 * @param {unknown} raw
 * @returns {QuestNodeDraft}
 */
export function ensureNodeDraftFields(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyNodeDraft(false);
  const d = /** @type {QuestNodeDraft} */ ({ ...createEmptyNodeDraft(!!/** @type {any} */ (raw).saved), ...raw });
  // rewardRows: Migration aus altem Single-Reward-Format falls noch nicht vorhanden
  if (!Array.isArray(d.rewardRows)) {
    if (d.rewardOn) {
      const oldEntry = _legacySingleRewardToEntry(d);
      d.rewardRows = oldEntry ? questRewardsToDraftRows([oldEntry]) : [];
    } else {
      d.rewardRows = [];
    }
  }
  if (d.rewardKind !== 'text' && d.rewardKind !== 'item' && d.rewardKind !== 'points' && d.rewardKind !== 'achievement') {
    d.rewardKind = (d.itemId || '').trim() ? 'item' : (d.achievementId || '').trim() ? 'achievement' : 'text';
  }
  if (typeof d.itemId !== 'string') d.itemId = '';
  if (typeof d.itemDisplayName !== 'string') d.itemDisplayName = '';
  if (typeof d.itemCategory !== 'string') d.itemCategory = '';
  if (typeof d.itemDescription !== 'string') d.itemDescription = '';
  if (typeof d.achievementId !== 'string') d.achievementId = '';
  if (typeof d.achievementDisplayName !== 'string') d.achievementDisplayName = '';
  if (typeof d.pointKind !== 'string' || (d.pointKind !== 'heart' && d.pointKind !== 'mana')) {
    d.pointKind = 'heart';
  }
  if (typeof d.pointsAmount !== 'string') d.pointsAmount = '';
  if (typeof d.rewardText !== 'string') d.rewardText = '';
  if (typeof d.description !== 'string') d.description = '';
  d.isLock = d.isLock === true;
  if (Array.isArray(d.children) && d.children.length > 0) {
    d.children = d.children.map((c) => ensureNodeDraftFields(c));
    d.subnodesOn = true;
  }
  return d;
}

/**
 * @param {import('./rpg-quest-nodes.js').RpgQuestRewardRow[]} rows
 * @returns {QuestRewardDraftRow[]}
 */
export function questRewardRowsToDraftRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row) => {
    const e = row.entry;
    if (e.type === 'item') {
      return {
        key: newDraftKey(),
        kind: 'item',
        text: '',
        itemId: e.itemId,
        displayName: e.displayName || '',
        itemCategory: '',
        itemDescription: '',
        achievementId: '',
        achievementTitle: '',
        pointKind: 'heart',
        pointsAmount: '',
      };
    }
    if (e.type === 'achievement') {
      return {
        key: newDraftKey(),
        kind: 'achievement',
        text: '',
        itemId: '',
        displayName: '',
        itemCategory: '',
        itemDescription: '',
        achievementId: e.achievementId,
        achievementTitle: e.displayName || '',
        pointKind: 'heart',
        pointsAmount: '',
      };
    }
    if (e.type === 'points') {
      return {
        key: newDraftKey(),
        kind: 'points',
        text: '',
        itemId: '',
        displayName: '',
        itemCategory: '',
        itemDescription: '',
        achievementId: '',
        achievementTitle: '',
        pointKind: e.pointKind,
        pointsAmount: String(e.amount),
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
      achievementId: '',
      achievementTitle: '',
      pointKind: 'heart',
      pointsAmount: '',
    };
  });
}

/**
 * @param {import('./rpg-quest-nodes.js').RpgQuestRewardEntry[] | undefined} entries
 * @returns {QuestRewardDraftRow[]}
 */
export function questRewardsToDraftRows(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return questRewardRowsToDraftRows(entries.map((e) => ({ entry: e })));
}

/**
 * @param {QuestRewardDraftRow[]} rows
 * @returns {import('./rpg-quest-nodes.js').RpgQuestRewardEntry[]}
 */
export function draftRewardRowsToQuestRewards(rows) {
  return draftRewardRowsToStoredRewards(rows).map((o) => {
    const e = /** @type {Record<string, unknown>} */ (o);
    if (e.type === 'item') {
      const itemId = String(e.itemId ?? '');
      const dn = typeof e.displayName === 'string' ? e.displayName.trim() : '';
      return dn ? { type: 'item', itemId, displayName: dn } : { type: 'item', itemId };
    }
    if (e.type === 'achievement') {
      const achievementId = String(e.achievementId ?? '');
      const dn = typeof e.displayName === 'string' ? e.displayName.trim() : '';
      return dn ? { type: 'achievement', achievementId, displayName: dn } : { type: 'achievement', achievementId };
    }
    if (e.type === 'points') {
      const pointKind = e.pointKind === 'mana' ? 'mana' : 'heart';
      const amt = Number(e.amount);
      const amount = Number.isFinite(amt) ? Math.trunc(amt) : 0;
      return { type: 'points', pointKind, amount };
    }
    return { type: 'text', text: String(e.text ?? '') };
  });
}

/**
 * Wandelt Draft-Reward-Rows in gespeicherte Reward-Einträge um.
 * @param {QuestRewardDraftRow[]} rows
 * @returns {Record<string, unknown>[]}
 */
export function draftRewardRowsToStoredRewards(rows) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const r of rows) {
    if (r.kind === 'item' && (r.itemId || '').trim()) {
      const itemId = (r.itemId || '').trim();
      const dn = (r.displayName || '').trim();
      /** @type {Record<string, unknown>} */
      const o = { type: 'item', itemId };
      if (dn) o.displayName = dn;
      out.push(o);
    } else if (r.kind === 'achievement' && (r.achievementId || '').trim()) {
      const achievementId = (r.achievementId || '').trim();
      const dn = (r.achievementTitle || '').trim();
      /** @type {Record<string, unknown>} */
      const o = { type: 'achievement', achievementId };
      if (dn) o.displayName = dn;
      out.push(o);
    } else if (r.kind === 'points' && (r.pointsAmount || '').trim()) {
      const n = Number(String(r.pointsAmount).trim());
      if (Number.isFinite(n)) {
        const pointKind = r.pointKind === 'mana' ? 'mana' : 'heart';
        out.push({ type: 'points', pointKind, amount: Math.trunc(n) });
      }
    } else if (r.kind === 'text' && (r.text || '').trim()) {
      out.push({ type: 'text', text: (r.text || '').trim() });
    }
  }
  return out;
}

/**
 * Katalog-Daten in Item-Felder übernehmen, wenn Nutzer sie leer gelassen hat.
 * @param {QuestNodeDraft[]} nodeDrafts
 * @param {QuestRewardDraftRow[]} rewardRows
 * @param {Record<string, { title?: string; category?: string; description?: string }>} catalog
 */
export function hydrateItemFieldsFromCatalog(nodeDrafts, rewardRows, catalog) {
  /** @param {QuestNodeDraft} d */
  function walk(d) {
    if ((d.itemId || '').trim()) {
      const id = d.itemId.trim();
      const row = catalog[id];
      if (row) {
        if (!(d.itemDisplayName || '').trim() && row.title) d.itemDisplayName = row.title;
        if (!(d.itemCategory || '').trim() && row.category) d.itemCategory = row.category;
        if (!(d.itemDescription || '').trim() && row.description) d.itemDescription = row.description;
      }
    }
    for (const c of d.children || []) walk(c);
  }
  for (const d of nodeDrafts) walk(d);
  for (const r of rewardRows) {
    if (r.kind !== 'item' || !(r.itemId || '').trim()) continue;
    const row = catalog[(r.itemId || '').trim()];
    if (row) {
      if (!(r.displayName || '').trim() && row.title) r.displayName = row.title;
      if (!(r.itemCategory || '').trim() && row.category) r.itemCategory = row.category;
      if (!(r.itemDescription || '').trim() && row.description) r.itemDescription = row.description;
    }
  }
}

/**
 * Vollständige Katalog-Zeilen aus Entwürfen (nur IDs, die noch nicht im Katalog sind).
 * @param {QuestNodeDraft[]} nodeDrafts
 * @param {QuestRewardDraftRow[]} rewardRows
 * @param {Set<string> | Record<string, unknown>} catalogIdSet
 * @returns {{ id: string; category: string; title: string; description: string }[]}
 */
export function collectQuestmakerItemsFromDrafts(nodeDrafts, rewardRows, catalogIdSet) {
  const inCatalog =
    catalogIdSet instanceof Set
      ? catalogIdSet
      : new Set(Object.keys(/** @type {Record<string, unknown>} */ (catalogIdSet)));
  /** @type {Map<string, { id: string; category: string; title: string; description: string }>} */
  const map = new Map();
  /** @param {QuestNodeDraft} d */
  function walk(d) {
    // Über rewardRows iterieren (kanonisches Array-Format)
    for (const r of d.rewardRows || []) {
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
    for (const c of d.children || []) walk(c);
  }
  for (const d of nodeDrafts) walk(d);
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
