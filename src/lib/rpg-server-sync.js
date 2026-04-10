import {
  loadCustomGraph,
  loadAddedIds,
  loadStepDone,
  clearAllRpgLocalStorage,
} from './rpg-persistence.js';
import { SAMPLE_RPG_GRAPH } from './rpg-quests-data.js';
import { isValidGraphShape } from './rpg-quest-graph.js';

export { isValidGraphShape };

export async function fetchRpgBootstrap() {
  const res = await fetch('/api/rpg/quests');
  if (!res.ok) return null;
  return res.json();
}

/** @param {{ graph: object; addedIds: string[]; stepDone: object }} payload */
export async function persistRpgState(payload) {
  const res = await fetch('/api/rpg/quests', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    try {
      const err = await res.json();
      console.warn('[rpg] persist failed', res.status, err);
    } catch {
      console.warn('[rpg] persist failed', res.status);
    }
  }
  return res.ok;
}

export async function resetRpgToDefaultOnServer() {
  const res = await fetch('/api/rpg/quests', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resetToDefault: true }),
  });
  return res.ok;
}

/**
 * Wenn noch kein DB-Eintrag: localStorage einmalig hochladen und leeren.
 * @param {any} data GET-Antwort
 */
export async function migrateLocalRpgToServerIfNeeded(data) {
  if (!data || data.persisted) return data;
  const g = loadCustomGraph();
  const added = [...loadAddedIds()];
  const steps = loadStepDone();
  const hasLocal =
    (g?.quests?.length ?? 0) > 0 || added.length > 0 || Object.keys(steps).length > 0;
  if (!hasLocal) return data;
  const graph = (g?.quests?.length ?? 0) > 0 ? { quests: g.quests, edges: g.edges || [] } : data.graph;
  if (!isValidGraphShape(graph)) return data;
  const ok = await persistRpgState({
    graph,
    addedIds: added,
    stepDone: steps,
  });
  if (ok) clearAllRpgLocalStorage();
  return (await fetchRpgBootstrap()) || data;
}

/** @param {any} data */
export function pickRpgPayloadFromResponse(data) {
  const graph = isValidGraphShape(data?.graph) ? data.graph : SAMPLE_RPG_GRAPH;
  const addedIds = Array.isArray(data?.addedIds) ? data.addedIds : [];
  const stepDone = data?.stepDone && typeof data.stepDone === 'object' ? data.stepDone : {};
  return { graph, addedIds, stepDone, persisted: !!data?.persisted };
}
