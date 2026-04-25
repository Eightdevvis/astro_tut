/**
 * Questmaker-Katalog ↔ Quest-Graph: Referenzen sammeln, Map für UI.
 */

import { isRpgItemCategoryId } from './rpg-item-categories.js';
import {
  walkNodesPreOrder,
  normalizeRewardEntry,
  getQuestRewardEntries,
} from './rpg-quest-nodes.js';
import { graphNodes } from './rpg-quests-data.js';

/**
 * Vollständige Item-Zeile für DB / PUT (keine Platzhalter).
 * @param {unknown} raw
 * @returns {{ id: string; category: string; title: string; description: string } | null}
 */
export function normalizeQuestmakerCatalogPayloadItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id) return null;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (!title || !description) return null;
  const catRaw = typeof o.category === 'string' ? o.category.trim() : '';
  const category = isRpgItemCategoryId(catRaw) ? catRaw : 'sonstiges';
  return { id, category, title, description };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {Set<string>}
 */
export function collectAllItemIdsFromGraph(graph) {
  return new Set([...collectItemRewardRefsFromGraph(graph).keys()]);
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {Map<string, { displayName?: string }>}
 */
export function collectItemRewardRefsFromGraph(graph) {
  /** @type {Map<string, { displayName?: string }>} */
  const refs = new Map();
  for (const q of graphNodes(graph)) {
    walkNodesPreOrder(q.children || [], (s) => {
      const e = normalizeRewardEntry(s.reward);
      if (e?.type === 'item') {
        const prev = refs.get(e.itemId) || {};
        refs.set(e.itemId, {
          displayName: e.displayName || prev.displayName,
        });
      }
    });
    for (const e of getQuestRewardEntries(q)) {
      if (e.type === 'item') {
        const prev = refs.get(e.itemId) || {};
        refs.set(e.itemId, {
          displayName: e.displayName || prev.displayName,
        });
      }
    }
  }
  return refs;
}

/**
 * Item-IDs aus einer Quest (Nodes + questRewards), z. B. für KI-Validierung.
 * @param {import('./rpg-quest-nodes.js').RpgQuestNode[] | undefined} nodes
 * @param {import('./rpg-quest-nodes.js').RpgQuestRewardEntry[] | undefined} questRewardEntries
 * @returns {Set<string>}
 */
export function collectItemIdsFromNodesAndQuestRewards(nodes, questRewardEntries) {
  const ids = new Set();
  walkNodesPreOrder(nodes || [], (s) => {
    const e = normalizeRewardEntry(s.reward);
    if (e?.type === 'item' && (e.itemId || '').trim()) ids.add(e.itemId.trim());
  });
  if (Array.isArray(questRewardEntries)) {
    for (const e of questRewardEntries) {
      if (e && e.type === 'item' && (e.itemId || '').trim()) ids.add(e.itemId.trim());
    }
  }
  return ids;
}

/**
 * API-Antwort → schnelle Id→Titel-Map für Reward-Pills.
 * @param {unknown[]} rows
 * @returns {Record<string, { title: string; category: string; description: string }>}
 */
export function questmakerCatalogToDisplayMap(rows) {
  /** @type {Record<string, { title: string; category: string; description: string }>} */
  const out = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const o = /** @type {Record<string, unknown>} */ (raw);
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) continue;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : id;
    out[id] = {
      title,
      category: typeof o.category === 'string' ? o.category : 'sonstiges',
      description: typeof o.description === 'string' ? o.description : '',
    };
  }
  return out;
}
