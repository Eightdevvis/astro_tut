/**
 * useRpgBootstrap — Gemeinsamer Bootstrap-/Sync-Hook fuer RpgQuestTree und RpgQuestHub.
 *
 * Konzept:
 *   Beide Hauptkomponenten (Hub + Tree) brauchen denselben Ablauf:
 *   1. Session-Cache lesen → sofort anzeigen (optimistic)
 *   2. Server-Fetch → echten State laden + ggf. Migration
 *   3. Aenderungen per Debounce zurueck an den Server persistieren
 *   4. Vitals nach jeder nodeDone-/Graph-Aenderung reconcilen
 *   5. Custom-Events fuer Location + Katalog-Updates hoeren
 *
 *   Statt diesen Code (~150 Zeilen) in beiden Komponenten zu duplizieren,
 *   lebt er jetzt einmal hier. Komponenten bekommen State + Setter zurueck.
 *
 * Optionen:
 *   - questmakerBatchRef: Optionaler Ref fuer Questmaker-Item-Batching (nur Tree).
 *     Wenn gesetzt, werden bei Persist die angesammelten Items mitgeschickt.
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { EMPTY_RPG_GRAPH } from './rpg-quests-data.js';
import {
  mergeNodeDoneBase,
  buildInitialNodeMapFromGraph,
} from './rpg-quest-graph.js';
import {
  fetchRpgBootstrap,
  migrateLocalRpgToServerIfNeeded,
  deriveRpgUiStateFromPayload,
  loadSessionCachedPayload,
  saveSessionCachedPayload,
  persistRpgState,
} from './rpg-server-sync.js';
import { normalizeRpgVitalsState, reconcileRpgVitals } from './rpg-vitals.js';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from './rpg-location.js';

/**
 * Wendet die abgeleiteten Felder aus einem Payload auf alle State-Setter an.
 * Vermeidet die 8-fache Wiederholung von setGraph/setAdded/... in jedem Branch.
 */
function applyDerivedState(d, setters) {
  setters.setGraph(d.graph);
  setters.setAdded(d.added);
  setters.setNodeDone(d.nodeDone || {});
  setters.setVitals(d.vitals);
  setters.setLocation(d.location);
  setters.setLocationCatalog(d.locationCatalog);
  setters.setLocations(d.locations);
  setters.setItemCatalog(d.itemCatalog);
  setters.itemCatalogRef.current = d.itemCatalog;
}

/**
 * @param {object} [opts]
 * @param {{ current: { id: string; category: string; title: string; description: string }[] }} [opts.questmakerBatchRef]
 *   Optionaler Ref – wenn vorhanden, werden Items beim Persist mitgeschickt und der Ref geleert.
 */
export function useRpgBootstrap(opts = {}) {
  const { questmakerBatchRef } = opts;

  // -- Shared State: Graph, Fortschritt, Kataloge, Sync-Flags --
  const [graph, setGraph] = useState(EMPTY_RPG_GRAPH);
  const [added, setAdded] = useState(() => new Set());
  const [nodeDone, setNodeDone] = useState(() =>
    mergeNodeDoneBase(buildInitialNodeMapFromGraph(EMPTY_RPG_GRAPH), {})
  );
  const [itemCatalog, setItemCatalog] = useState(() => ({}));
  const [vitals, setVitals] = useState(() => normalizeRpgVitalsState(null));
  const [location, setLocation] = useState(() => normalizeRpgLocationState(null));
  const [locationCatalog, setLocationCatalog] = useState(() => normalizeRpgLocationCatalog(null));
  const [locations, setLocations] = useState(() => []);
  const [bootstrapped, setBootstrapped] = useState(false);
  /** Kein Debounce-PUT, bis der erste GET abgeschlossen ist (nach Session-Cache: bis GET fertig). */
  const [canPersist, setCanPersist] = useState(true);
  const [dirtySinceBootstrap, setDirtySinceBootstrap] = useState(false);
  /** Persist-Fehler fuer Inline-Anzeige statt window.alert */
  const [persistError, setPersistError] = useState(/** @type {string | null} */ (null));

  // -- Refs fuer Closure-stable Werte --
  const itemCatalogRef = useRef(
    /** @type {Record<string, { title: string; category: string; description: string }>} */ ({})
  );
  const persistFailFingerprintRef = useRef('');

  // Ref-Sync: itemCatalogRef immer aktuell halten (fuer Callbacks die ihn lesen).
  useEffect(() => {
    itemCatalogRef.current = itemCatalog;
  }, [itemCatalog]);

  // -- Event: Location-Updates von RpgLocationStrip --
  // Listener braucht keine State-Deps, weil setLocation keinen Closure-State nutzt.
  useEffect(() => {
    const onLocation = (/** @type {CustomEvent} */ e) => {
      setLocation(normalizeRpgLocationState(e.detail));
    };
    window.addEventListener('rpg-location-updated', onLocation);
    return () => window.removeEventListener('rpg-location-updated', onLocation);
  }, []);

  // -- Event: Questmaker-Katalog-Update (z.B. nach Editor-Save) --
  // Muss alle State-Werte im Closure haben, weil saveSessionCachedPayload sie braucht.
  useEffect(() => {
    const onCatalog = (/** @type {CustomEvent} */ e) => {
      const m = e.detail?.itemCatalog;
      if (!m || typeof m !== 'object') return;
      setItemCatalog(m);
      itemCatalogRef.current = m;
      saveSessionCachedPayload({
        graph,
        addedIds: [...added],
        nodeDone,
        vitals,
        location,
        locationCatalog,
        locations,
        itemCatalog: m,
      });
    };
    window.addEventListener('rpg-questmaker-catalog-updated', onCatalog);
    return () => window.removeEventListener('rpg-questmaker-catalog-updated', onCatalog);
  }, [graph, added, nodeDone, vitals, location, locationCatalog, locations]);

  // -- Bootstrap: Session-Cache → Server-Fetch → State befuellen --
  // Laeuft einmal beim Mount. Cancellation ueber `cancelled`-Flag.
  const stateSetters = { setGraph, setAdded, setNodeDone, setVitals, setLocation, setLocationCatalog, setLocations, setItemCatalog, itemCatalogRef };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Phase 1: Session-Cache sofort anzeigen (optimistic UI)
      const cached = loadSessionCachedPayload();
      if (cached && !cancelled) {
        applyDerivedState(deriveRpgUiStateFromPayload(cached), stateSetters);
        setBootstrapped(true);
        // Persist blockieren bis Server-Fetch durch ist – sonst wuerde der
        // Cache-Stand als "Aenderung" zurueckgeschrieben werden.
        setCanPersist(false);
      }

      // Phase 2: Echte Daten vom Server holen
      let data = await fetchRpgBootstrap();
      if (cancelled) return;
      if (!data) {
        // Server nicht erreichbar: Fallback auf Cache oder Empty
        applyDerivedState(deriveRpgUiStateFromPayload(cached ?? null), stateSetters);
        setBootstrapped(true);
        setCanPersist(true);
        setDirtySinceBootstrap(false);
        return;
      }

      // Phase 3: Einmalige localStorage-Migration (Legacy-Clients)
      data = await migrateLocalRpgToServerIfNeeded(data);
      if (!data || cancelled) return;

      // Phase 4: State setzen + Session-Cache aktualisieren
      const d = deriveRpgUiStateFromPayload(data);
      applyDerivedState(d, stateSetters);
      saveSessionCachedPayload({
        graph: d.graph,
        addedIds: [...d.added],
        nodeDone: d.nodeDone || {},
        vitals: d.vitals,
        location: d.location,
        locationCatalog: d.locationCatalog,
        locations: d.locations,
        itemCatalog: d.itemCatalog,
      });
      setBootstrapped(true);
      setCanPersist(true);
      setDirtySinceBootstrap(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -- Debounced Persist: Aenderungen nach 450ms an Server senden --
  // Nur wenn: bootstrapped UND canPersist UND es gab tatsaechlich Aenderungen.
  useEffect(() => {
    if (!bootstrapped || !canPersist || !dirtySinceBootstrap) return;
    const t = setTimeout(() => {
      // Optional: Questmaker-Items aus Batch-Ref entnehmen und mitschicken
      const batch = questmakerBatchRef?.current ?? [];
      if (questmakerBatchRef) questmakerBatchRef.current = [];

      const payload = {
        graph,
        addedIds: [...added],
        nodeDone,
        vitals,
        location,
        locationCatalog,
        locations,
        ...(batch.length ? { questmakerItems: batch } : {}),
      };
      void (async () => {
        const r = await persistRpgState(payload);
        if (r.ok) {
          persistFailFingerprintRef.current = '';
          setDirtySinceBootstrap(false);
          // Server kann aktualisierte Kataloge/Locations zurueckgeben
          if (r.itemCatalog) {
            setItemCatalog(r.itemCatalog);
            itemCatalogRef.current = r.itemCatalog;
          }
          if (r.locationCatalog) setLocationCatalog(r.locationCatalog);
          if (Array.isArray(r.locations)) setLocations(r.locations);
        } else if (r.error) {
          // Fehler nur einmal pro Fingerprint anzeigen (kein Spam bei schnellen Retries)
          const fp = `${r.status ?? ''}:${r.error}:${(r.missing || []).join(',')}`;
          if (persistFailFingerprintRef.current !== fp) {
            persistFailFingerprintRef.current = fp;
            let msg = r.error;
            if (r.missing?.length) msg += `\n\nFehlende Item-IDs: ${r.missing.join(', ')}`;
            setPersistError(msg);
          }
        }
        // Session-Cache immer aktualisieren (auch bei Fehler), damit
        // naechster Tab-Start nicht veraltete Daten zeigt.
        saveSessionCachedPayload({
          ...payload,
          locationCatalog: r.locationCatalog ?? locationCatalog,
          locations: Array.isArray(r.locations) ? r.locations : locations,
          itemCatalog: r.itemCatalog ?? itemCatalogRef.current,
        });
      })();
    }, 450);
    return () => clearTimeout(t);
  }, [
    bootstrapped,
    canPersist,
    dirtySinceBootstrap,
    graph,
    added,
    nodeDone,
    vitals,
    location,
    locationCatalog,
    locations,
  ]);

  // -- Vitals-Reconciliation: nach jeder Graph-/NodeDone-Aenderung --
  // Deterministische Neuberechnung – bucht Rewards genau einmal per appliedNodeRewardIds.
  useEffect(() => {
    setVitals((prev) => {
      const out = reconcileRpgVitals(graph, nodeDone, prev);
      return out.changed ? out.state : prev;
    });
  }, [graph, nodeDone]);

  // -- Convenience: markDirty triggert den Persist-Debounce --
  const markDirty = useCallback(() => setDirtySinceBootstrap(true), []);

  return {
    // State
    graph,
    setGraph,
    added,
    setAdded,
    nodeDone,
    setNodeDone,
    itemCatalog,
    setItemCatalog,
    itemCatalogRef,
    vitals,
    setVitals,
    location,
    setLocation,
    locationCatalog,
    setLocationCatalog,
    locations,
    setLocations,
    bootstrapped,
    dirtySinceBootstrap,
    persistError,
    setPersistError,
    // Aktionen
    markDirty,
  };
}
