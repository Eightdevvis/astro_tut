/**
 * Questmaker-Katalog ↔ Quest-Graph: Referenzen sammeln, Map für UI.
 */

import { isRpgItemCategoryId } from './rpg-item-categories.js';
import {
  walkNodesPreOrder,
  getNodeRewardEntries,
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
  /** @param {import('./rpg-quests-data.js').RpgNode | Record<string, unknown>} n */
  const collectFromNode = (n) => {
    // Einheitlich via getNodeRewardEntries — liest sowohl kanonisches 'rewards' als auch
    // Legacy-Felder ('questRewards'). Gleicher Pfad fuer Root und Sub-Node, keine Sonder-Logik.
    for (const e of getNodeRewardEntries(n)) {
      if (e.type === 'item') {
        const prev = refs.get(e.itemId) || {};
        refs.set(e.itemId, {
          displayName: e.displayName || prev.displayName,
        });
      }
    }
  };
  for (const q of graphNodes(graph)) {
    collectFromNode(q);
    walkNodesPreOrder(q.children || [], collectFromNode);
  }
  return refs;
}

/**
 * Item-IDs aus einer Quest (Nodes + questRewards), z. B. für KI-Validierung.
 * @param {import('./rpg-quests-data.js').RpgNode[] | undefined} nodes
 * @param {import('./rpg-quests-data.js').RpgRewardEntry[] | undefined} questRewardEntries
 * @returns {Set<string>}
 */
export function collectItemIdsFromNodesAndQuestRewards(nodes, questRewardEntries) {
  const ids = new Set();
  // Einheitlich via getNodeRewardEntries — liest sowohl kanonisches 'rewards' als auch
  // Legacy 'questRewards'. Sub-Nodes und der gegebene questRewardEntries-Parameter
  // werden gleich behandelt: jede Item-Entry wird gesammelt.
  walkNodesPreOrder(nodes || [], (s) => {
    for (const e of getNodeRewardEntries(s)) {
      if (e.type === 'item' && (e.itemId || '').trim()) ids.add(e.itemId.trim());
    }
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
