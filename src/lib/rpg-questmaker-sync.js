/**
 * Questmaker-Katalog ↔ Quest-Graph: Referenzen sammeln, Map für UI.
 */

import {
  walkStepsPreOrder,
  normalizeRewardEntry,
  getQuestRewardEntries,
} from './rpg-quest-steps.js';

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {Map<string, { displayName?: string }>}
 */
export function collectItemRewardRefsFromGraph(graph) {
  /** @type {Map<string, { displayName?: string }>} */
  const refs = new Map();
  for (const q of graph.quests || []) {
    walkStepsPreOrder(q.steps || [], (s) => {
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
