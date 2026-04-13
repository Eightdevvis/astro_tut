import {
  loadCustomGraph,
  loadAddedIds,
  loadStepDone,
  clearAllRpgLocalStorage,
} from './rpg-persistence.js';
import { SAMPLE_RPG_GRAPH } from './rpg-quests-data.js';
import {
  isValidGraphShape,
  mergeStepDoneBase,
  buildInitialStepMapFromGraph,
} from './rpg-quest-graph.js';
import { migrateRpgGraphToV2 } from './rpg-quest-steps.js';
import { questmakerCatalogToDisplayMap } from './rpg-questmaker-sync.js';
import { normalizeRpgVitalsState } from './rpg-vitals.js';
import { normalizeRpgLocationState } from './rpg-location.js';

export { isValidGraphShape };

const RPG_SESSION_CACHE_KEY = 'rpg-bootstrap-v1';

/**
 * Letzter bekannter Stand (Tab-Session): sofortige Anzeige ohne auf GET zu warten.
 * @returns {{ graph: import('./rpg-quests-data.js').RpgGraph; addedIds: string[]; stepDone: Record<string, Record<string, boolean>>; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string } } | null}
 */
export function loadSessionCachedPayload() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(RPG_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !isValidGraphShape(parsed.graph)) return null;
    const addedIds = Array.isArray(parsed.addedIds) ? parsed.addedIds : [];
    const stepDone =
      parsed.stepDone && typeof parsed.stepDone === 'object' ? parsed.stepDone : {};
    const itemCatalog =
      parsed.itemCatalog && typeof parsed.itemCatalog === 'object' && !Array.isArray(parsed.itemCatalog)
        ? parsed.itemCatalog
        : {};
    const vitals = normalizeRpgVitalsState(parsed.vitals);
    const location = normalizeRpgLocationState(parsed.location);
    return { graph: parsed.graph, addedIds, stepDone, itemCatalog, vitals, location };
  } catch {
    return null;
  }
}

/** @param {{ graph: object; addedIds: string[]; stepDone: object; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; itemCatalog?: Record<string, unknown> }} payload */
export function saveSessionCachedPayload(payload) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      RPG_SESSION_CACHE_KEY,
      JSON.stringify({
        graph: payload.graph,
        addedIds: payload.addedIds,
        stepDone: payload.stepDone,
        vitals: payload.vitals,
        location: normalizeRpgLocationState(payload.location),
        itemCatalog: payload.itemCatalog && typeof payload.itemCatalog === 'object' ? payload.itemCatalog : {},
      })
    );
  } catch {
    /* quota */
  }
}

export async function fetchRpgBootstrap() {
  const res = await fetch('/api/rpg/quests');
  if (!res.ok) return null;
  return res.json();
}

/**
 * @param {{ graph: object; addedIds: string[]; stepDone: object; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; questmakerItems?: { id: string; category: string; title: string; description: string }[] }} payload
 * @returns {Promise<{ ok: boolean; itemCatalog?: Record<string, { title: string; category: string; description: string }>; status?: number; error?: string; missing?: string[] }>}
 */
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
      const msg = typeof err?.error === 'string' ? err.error : undefined;
      const missing = Array.isArray(err?.missing) ? err.missing.filter((x) => typeof x === 'string') : undefined;
      return { ok: false, status: res.status, error: msg, missing };
    } catch {
      console.warn('[rpg] persist failed', res.status);
    }
    return { ok: false, status: res.status };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* */
  }
  const itemCatalog =
    data.questmakerItems && Array.isArray(data.questmakerItems)
      ? questmakerCatalogToDisplayMap(data.questmakerItems)
      : undefined;
  return itemCatalog ? { ok: true, itemCatalog } : { ok: true };
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
  const result = await persistRpgState({
    graph,
    addedIds: added,
    stepDone: steps,
    vitals: normalizeRpgVitalsState(data?.vitals),
    location: normalizeRpgLocationState(data?.location),
  });
  if (result.ok) {
    clearAllRpgLocalStorage();
    const fresh = await fetchRpgBootstrap();
    if (fresh) return fresh;
    return {
      ...data,
      persisted: true,
      graph,
      addedIds: added,
      stepDone: steps,
      vitals: normalizeRpgVitalsState(data?.vitals),
      location: normalizeRpgLocationState(data?.location),
    };
  }
  return data;
}

/** @param {any} data */
export function pickRpgPayloadFromResponse(data) {
  const raw = isValidGraphShape(data?.graph) ? data.graph : SAMPLE_RPG_GRAPH;
  const graph = migrateRpgGraphToV2(raw);
  const addedIds = Array.isArray(data?.addedIds) ? data.addedIds : [];
  const stepDone = data?.stepDone && typeof data.stepDone === 'object' ? data.stepDone : {};
  const vitals = normalizeRpgVitalsState(data?.vitals);
  const location = normalizeRpgLocationState(data?.location);
  /** @type {Record<string, { title: string; category: string; description: string }>} */
  let itemCatalog = {};
  if (data?.questmakerItems && Array.isArray(data.questmakerItems)) {
    itemCatalog = questmakerCatalogToDisplayMap(data.questmakerItems);
  } else if (
    data?.itemCatalog &&
    typeof data.itemCatalog === 'object' &&
    !Array.isArray(data.itemCatalog)
  ) {
    itemCatalog = /** @type {typeof itemCatalog} */ (data.itemCatalog);
  }
  return { graph, addedIds, stepDone, vitals, location, persisted: !!data?.persisted, itemCatalog };
}

/**
 * @param {any} data GET-Antwort oder null (Sample-Fallback)
 * @returns {{ graph: import('./rpg-quests-data.js').RpgGraph; added: Set<string>; stepDone: Record<string, Record<string, boolean>>; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; itemCatalog: Record<string, { title: string; category: string; description: string }> }}
 */
export function deriveRpgUiStateFromPayload(data) {
  const { graph, addedIds, stepDone: sd, vitals, location, itemCatalog } = pickRpgPayloadFromResponse(data);
  const stepDone = mergeStepDoneBase(buildInitialStepMapFromGraph(graph), sd);
  return { graph, added: new Set(addedIds), stepDone, vitals, location, itemCatalog };
}
