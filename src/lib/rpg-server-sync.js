import {
  loadCustomGraph,
  loadAddedIds,
  loadNodeDone,
  clearAllRpgLocalStorage,
} from './rpg-persistence.js';
import { EMPTY_RPG_GRAPH } from './rpg-quests-data.js';
import { graphNodes, makeRpgGraph, graphEdges } from './rpg-quests-data.js';
import {
  isValidGraphShape,
  mergeNodeDoneBase,
  buildInitialNodeMapFromGraph,
} from './rpg-quest-graph.js';
import { migrateRpgGraphToV2 } from './rpg-quest-nodes.js';
import { questmakerCatalogToDisplayMap } from './rpg-questmaker-sync.js';
import { normalizeRpgVitalsState } from './rpg-vitals.js';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from './rpg-location.js';

export { isValidGraphShape };

const RPG_SESSION_CACHE_KEY = 'rpg-bootstrap-v1';
const RPG_BOOTSTRAP_TIMEOUT_MS = 12000;
const RPG_SYNC_WARNED_KEYS = new Set();
function warnSyncOnce(key, message, details) {
  if (RPG_SYNC_WARNED_KEYS.has(key)) return;
  RPG_SYNC_WARNED_KEYS.add(key);
  console.warn(`[rpg:sync] ${message}`, details);
}

/**
 * Letzter bekannter Stand (Tab-Session): sofortige Anzeige ohne auf GET zu warten.
 * @returns {{ graph: import('./rpg-quests-data.js').RpgGraph; addedIds: string[]; nodeDone: Record<string, Record<string, boolean>>; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; locationCatalog: { cityIds: string[]; placeIds: string[] }; locations: { id: string; kind: 'city' | 'place'; name: string; description: string; city: string; country: string }[] } | null}
 */
export function loadSessionCachedPayload() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(RPG_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !isValidGraphShape(parsed.graph)) {
      warnSyncOnce('session.invalidPayload', 'Ignoring invalid session cached payload', {
        hasParsed: !!parsed,
        graphType: typeof parsed?.graph,
      });
      return null;
    }
    const addedIds = Array.isArray(parsed.addedIds) ? parsed.addedIds : [];
    const nodeDoneRaw = parsed.nodeDone;
    const nodeDone =
      nodeDoneRaw && typeof nodeDoneRaw === 'object' ? nodeDoneRaw : {};
    const itemCatalog =
      parsed.itemCatalog && typeof parsed.itemCatalog === 'object' && !Array.isArray(parsed.itemCatalog)
        ? parsed.itemCatalog
        : {};
    const vitals = normalizeRpgVitalsState(parsed.vitals);
    const location = normalizeRpgLocationState(parsed.location);
    const locationCatalog = normalizeRpgLocationCatalog(parsed.locationCatalog);
    const locations = Array.isArray(parsed.locations) ? parsed.locations : [];
    return { graph: parsed.graph, addedIds, nodeDone, itemCatalog, vitals, location, locationCatalog, locations };
  } catch {
    return null;
  }
}

/** @param {{ graph: object; addedIds: string[]; nodeDone?: object; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; locationCatalog: { cityIds: string[]; placeIds: string[] }; locations?: unknown[]; itemCatalog?: Record<string, unknown> }} payload */
export function saveSessionCachedPayload(payload) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const nodeDoneRaw = payload.nodeDone;
    const nodeDone =
      nodeDoneRaw && typeof nodeDoneRaw === 'object' ? nodeDoneRaw : {};
    sessionStorage.setItem(
      RPG_SESSION_CACHE_KEY,
      JSON.stringify({
        graph: payload.graph,
        addedIds: payload.addedIds,
        nodeDone,
        vitals: payload.vitals,
        location: normalizeRpgLocationState(payload.location),
        locationCatalog: normalizeRpgLocationCatalog(payload.locationCatalog),
        locations: Array.isArray(payload.locations) ? payload.locations : [],
        itemCatalog: payload.itemCatalog && typeof payload.itemCatalog === 'object' ? payload.itemCatalog : {},
      })
    );
  } catch {
    /* quota */
  }
}

export async function fetchRpgBootstrap() {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    typeof window !== 'undefined' && ctrl
      ? window.setTimeout(() => ctrl.abort(), RPG_BOOTSTRAP_TIMEOUT_MS)
      : null;
  try {
    const res = await fetch('/api/rpg/quests', {
      signal: ctrl?.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[rpg] bootstrap fetch failed', err);
    } else {
      console.warn('[rpg] bootstrap fetch timed out');
    }
    return null;
  } finally {
    if (timer != null && typeof window !== 'undefined') window.clearTimeout(timer);
  }
}

/**
 * @param {{ graph: object; addedIds: string[]; nodeDone?: object; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; locationCatalog: { cityIds: string[]; placeIds: string[] }; questmakerItems?: { id: string; category: string; title: string; description: string }[] }} payload
 * @returns {Promise<{ ok: boolean; itemCatalog?: Record<string, { title: string; category: string; description: string }>; locationCatalog?: { cityIds: string[]; placeIds: string[] }; locations?: { id: string; kind: 'city' | 'place'; name: string; description: string; city: string; country: string }[]; status?: number; error?: string; missing?: string[] }>}
 */
export async function persistRpgState(payload) {
  if (!isValidGraphShape(payload?.graph)) {
    warnSyncOnce('persist.invalidGraph', 'Refusing to persist invalid graph payload', {
      graphType: typeof payload?.graph,
    });
    return { ok: false, error: 'invalid_graph' };
  }
  const nodeDoneRaw = payload.nodeDone;
  const nodeDone =
    nodeDoneRaw && typeof nodeDoneRaw === 'object' ? nodeDoneRaw : {};
  const res = await fetch('/api/rpg/quests', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      nodeDone,
    }),
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
  const locationCatalog = normalizeRpgLocationCatalog(data.locationCatalog);
  const locations = Array.isArray(data.locations) ? data.locations : undefined;
  const out = { ok: true };
  if (itemCatalog) out.itemCatalog = itemCatalog;
  out.locationCatalog = locationCatalog;
  if (locations) out.locations = locations;
  return out;
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
  const nodeDone = loadNodeDone();
  const hasLocal =
    (g?.quests?.length ?? 0) > 0 || added.length > 0 || Object.keys(nodeDone).length > 0;
  if (!hasLocal) return data;
  const graph = (g?.quests?.length ?? 0) > 0 ? { quests: g.quests, edges: g.edges || [] } : data.graph;
  if (!isValidGraphShape(graph)) return data;
  const result = await persistRpgState({
    graph,
    addedIds: added,
    nodeDone,
    vitals: normalizeRpgVitalsState(data?.vitals),
    location: normalizeRpgLocationState(data?.location),
    locationCatalog: normalizeRpgLocationCatalog(data?.locationCatalog),
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
      nodeDone,
      vitals: normalizeRpgVitalsState(data?.vitals),
      location: normalizeRpgLocationState(data?.location),
      locationCatalog: normalizeRpgLocationCatalog(data?.locationCatalog),
    };
  }
  return data;
}

/** @param {any} data */
export function pickRpgPayloadFromResponse(data) {
  const raw = isValidGraphShape(data?.graph) ? data.graph : EMPTY_RPG_GRAPH;
  if (!isValidGraphShape(data?.graph)) {
    warnSyncOnce('response.invalidGraph', 'Server response contained invalid graph; using EMPTY_RPG_GRAPH fallback', {
      graphType: typeof data?.graph,
    });
  }
  const graph = migrateRpgGraphToV2(
    makeRpgGraph(graphNodes(raw), graphEdges(raw))
  );
  const addedIds = Array.isArray(data?.addedIds) ? data.addedIds : [];
  const nodeDoneRaw = data?.nodeDone;
  const nodeDone = nodeDoneRaw && typeof nodeDoneRaw === 'object' ? nodeDoneRaw : {};
  const vitals = normalizeRpgVitalsState(data?.vitals);
  const location = normalizeRpgLocationState(data?.location);
  const locationCatalog = normalizeRpgLocationCatalog(data?.locationCatalog);
  const locations = Array.isArray(data?.locations) ? data.locations : [];
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
  return {
    graph,
    addedIds,
    nodeDone,
    vitals,
    location,
    locationCatalog,
    locations,
    persisted: !!data?.persisted,
    itemCatalog,
  };
}

/**
 * @param {any} data GET-Antwort oder null (leerer Graph als Fallback)
 * @returns {{ graph: import('./rpg-quests-data.js').RpgGraph; added: Set<string>; nodeDone: Record<string, Record<string, boolean>>; vitals: import('./rpg-vitals.js').RpgVitalsState; location: { city: string; place: string }; locationCatalog: { cityIds: string[]; placeIds: string[] }; locations: { id: string; kind: 'city' | 'place'; name: string; description: string; city: string; country: string }[]; itemCatalog: Record<string, { title: string; category: string; description: string }> }}
 */
export function deriveRpgUiStateFromPayload(data) {
  const { graph, addedIds, nodeDone: nd, vitals, location, locationCatalog, locations, itemCatalog } =
    pickRpgPayloadFromResponse(data);
  const nodeDone = mergeNodeDoneBase(buildInitialNodeMapFromGraph(graph), nd);
  return { graph, added: new Set(addedIds), nodeDone, vitals, location, locationCatalog, locations, itemCatalog };
}
