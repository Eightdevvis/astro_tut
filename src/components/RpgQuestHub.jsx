import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';
import { EMPTY_RPG_GRAPH } from '../lib/rpg-quests-data.js';
import RpgBootstrapLoading from './RpgBootstrapLoading.jsx';
import {
  questMap,
  isQuestCompleted,
  isQuestUnlocked,
  questProgress,
  mergeStepDoneBase,
  buildInitialStepMapFromGraph,
} from '../lib/rpg-quest-graph.js';
import {
  fetchRpgBootstrap,
  migrateLocalRpgToServerIfNeeded,
  deriveRpgUiStateFromPayload,
  saveSessionCachedPayload,
  persistRpgState,
} from '../lib/rpg-server-sync.js';
import { normalizeRpgVitalsState, reconcileRpgVitals } from '../lib/rpg-vitals.js';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from '../lib/rpg-location.js';
import RpgQuestStepsView from './RpgQuestStepsView.jsx';
import './rpg-quest-hub.css';

function firstId(list) {
  return list?.[0]?.id ?? null;
}

function activeQuests(graph, added, stepDone) {
  const out = [];
  for (const q of graph.quests || []) {
    if (!added.has(q.id)) continue;
    if (isQuestCompleted(q, stepDone)) continue;
    out.push(q);
  }
  return out;
}

function RpgTreeDeepLink({ questId }) {
  return (
    <a
      class="rpg-hub-tree-deep"
      href={`/rpg/tree?focus=${encodeURIComponent(questId)}`}
      aria-label="Im Quest-Baum anzeigen"
    >
      <svg viewBox="0 0 32 24" width="20" height="20" aria-hidden="true">
        <line x1="16" y1="20" x2="8" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="16" y1="20" x2="24" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <polygon points="16,4 20,8 16,12 12,8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="24" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </a>
  );
}

function QuestDetail({
  quest,
  stepDone,
  onToggleStep,
  showFocusBadge,
  variant = 'hero',
  graph,
  itemCatalog,
  location,
}) {
  const TitleTag = variant === 'hero' ? 'h2' : 'h3';
  const wrapClass =
    variant === 'hero' ? 'rpg-quest-block rpg-quest-block--hero' : 'rpg-quest-block rpg-quest-block--embedded';

  return (
    <div class={wrapClass}>
      {showFocusBadge && <div class="rpg-quest-block__badge">Fokus</div>}
      <TitleTag class="rpg-quest-block__title">{quest.title}</TitleTag>
      <p class="rpg-quest-block__desc">{quest.description}</p>
      <p class="rpg-section-label">Schritte</p>
      <RpgQuestStepsView
        quest={quest}
        stepDone={stepDone}
        onToggleStep={onToggleStep}
        interactive
        stepsClass="rpg-steps"
        rewardsClass="rpg-rewards"
        graph={graph}
        itemCatalog={itemCatalog}
        currentLocation={location}
        showLocationGuidance
      />
    </div>
  );
}

export default function RpgQuestHub() {
  const [graph, setGraph] = useState(EMPTY_RPG_GRAPH);
  const [added, setAdded] = useState(() => new Set());
  const [focusedId, setFocusedId] = useState(/** @type {string | null} */ (null));
  const [expanded, setExpanded] = useState(() => new Set());
  const [stepDone, setStepDone] = useState(() =>
    mergeStepDoneBase(buildInitialStepMapFromGraph(EMPTY_RPG_GRAPH), {})
  );
  const itemCatalogRef = useRef(
    /** @type {Record<string, { title: string; category: string; description: string }>} */ ({})
  );
  const persistFailFingerprintRef = useRef('');
  const [itemCatalog, setItemCatalog] = useState(() => ({}));
  const [vitals, setVitals] = useState(() => normalizeRpgVitalsState(null));
  const [location, setLocation] = useState(() => normalizeRpgLocationState(null));
  const [locationCatalog, setLocationCatalog] = useState(() => normalizeRpgLocationCatalog(null));
  const [locations, setLocations] = useState(() => []);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [canPersist, setCanPersist] = useState(true);
  const [dirtySinceBootstrap, setDirtySinceBootstrap] = useState(false);

  useEffect(() => {
    itemCatalogRef.current = itemCatalog;
  }, [itemCatalog]);

  useEffect(() => {
    const onLocation = (/** @type {CustomEvent} */ e) => {
      setLocation(normalizeRpgLocationState(e.detail));
    };
    window.addEventListener('rpg-location-updated', onLocation);
    return () => window.removeEventListener('rpg-location-updated', onLocation);
  }, []);

  useEffect(() => {
    const onCatalog = (/** @type {CustomEvent} */ e) => {
      const m = e.detail?.itemCatalog;
      if (!m || typeof m !== 'object') return;
      setItemCatalog(m);
      itemCatalogRef.current = m;
      saveSessionCachedPayload({
        graph,
        addedIds: [...added],
        stepDone,
        vitals,
        location,
        locationCatalog,
        locations,
        itemCatalog: m,
      });
    };
    window.addEventListener('rpg-questmaker-catalog-updated', onCatalog);
    return () => window.removeEventListener('rpg-questmaker-catalog-updated', onCatalog);
  }, [graph, added, stepDone, vitals, location, locationCatalog, locations]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data = await fetchRpgBootstrap();
      if (cancelled) return;
      if (!data) {
        const d = deriveRpgUiStateFromPayload(null);
        setGraph(d.graph);
        setAdded(d.added);
        setStepDone(d.stepDone);
        setVitals(d.vitals);
        setLocation(d.location);
        setLocationCatalog(d.locationCatalog);
        setLocations(d.locations);
        setItemCatalog(d.itemCatalog);
        itemCatalogRef.current = d.itemCatalog;
        setBootstrapped(true);
        setCanPersist(true);
        return;
      }
      data = await migrateLocalRpgToServerIfNeeded(data);
      if (!data || cancelled) return;
      const d = deriveRpgUiStateFromPayload(data);
      setGraph(d.graph);
      setAdded(d.added);
      setStepDone(d.stepDone);
      setVitals(d.vitals);
      setLocation(d.location);
      setLocationCatalog(d.locationCatalog);
      setLocations(d.locations);
      setItemCatalog(d.itemCatalog);
      itemCatalogRef.current = d.itemCatalog;
      saveSessionCachedPayload({
        graph: d.graph,
        addedIds: [...d.added],
        stepDone: d.stepDone,
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

  useEffect(() => {
    if (!bootstrapped || !canPersist || !dirtySinceBootstrap) return;
    const t = setTimeout(() => {
      const payload = {
        graph,
        addedIds: [...added],
        stepDone,
        vitals,
        location,
        locationCatalog,
        locations,
      };
      void (async () => {
        const r = await persistRpgState(payload);
        if (r.ok) {
          persistFailFingerprintRef.current = '';
          setDirtySinceBootstrap(false);
          if (r.itemCatalog) {
            setItemCatalog(r.itemCatalog);
            itemCatalogRef.current = r.itemCatalog;
          }
          if (r.locationCatalog) setLocationCatalog(r.locationCatalog);
          if (Array.isArray(r.locations)) setLocations(r.locations);
        } else if (r.error) {
          const fp = `${r.status ?? ''}:${r.error}:${(r.missing || []).join(',')}`;
          if (persistFailFingerprintRef.current !== fp) {
            persistFailFingerprintRef.current = fp;
            let msg = r.error;
            if (r.missing?.length) msg += `\n\nFehlende Item-IDs: ${r.missing.join(', ')}`;
            window.alert(msg);
          }
        }
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
    stepDone,
    vitals,
    location,
    locationCatalog,
    locations,
  ]);

  useEffect(() => {
    setVitals((prev) => {
      const out = reconcileRpgVitals(graph, stepDone, prev);
      return out.changed ? out.state : prev;
    });
  }, [graph, stepDone]);

  useEffect(() => {
    const m = questMap(graph);
    setAdded((prev) => {
      const next = new Set();
      for (const id of prev) {
        const q = m.get(id);
        if (!q) continue;
        if (isQuestCompleted(q, stepDone)) continue;
        if (!isQuestUnlocked(id, graph, stepDone, m)) continue;
        next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [graph, stepDone]);

  const quests = useMemo(() => activeQuests(graph, added, stepDone), [graph, added, stepDone]);

  useEffect(() => {
    if (focusedId && quests.some((q) => q.id === focusedId)) return;
    setFocusedId(firstId(quests));
  }, [focusedId, quests]);
  const focusedQuest = useMemo(
    () => quests.find((q) => q.id === focusedId) ?? quests[0] ?? null,
    [quests, focusedId]
  );

  const others = useMemo(
    () => quests.filter((q) => q.id !== (focusedQuest?.id ?? '')),
    [quests, focusedQuest]
  );

  const onToggleStep = useCallback(
    (questId, stepId) => {
      setDirtySinceBootstrap(true);
      setStepDone((prev) => {
        const next = {
          ...prev,
          [questId]: { ...prev[questId], [stepId]: !prev[questId]?.[stepId] },
        };
        setVitals((old) => reconcileRpgVitals(graph, next, old).state);
        return next;
      });
    },
    [graph]
  );

  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setFocused = useCallback((id) => setFocusedId(id), []);

  if (!bootstrapped) {
    return <RpgBootstrapLoading />;
  }

  return (
    <div class="rpg-hub">
      <aside class="rpg-hub__rail" aria-label="Quests">
        <div class="rpg-hub__rail-label">Aktive Quests</div>
        <div class="rpg-hub__rail-spacer" />
        <a class="rpg-hub__tree-link" href="/rpg/tree">
          Quest-Baum
        </a>
      </aside>

      <main class="rpg-hub__main">
        {!focusedQuest && (
          <p class="rpg-hub__empty">
            Keine aktiven Quests. Im{' '}
            <a href="/rpg/tree">Quest-Baum</a> Quests hinzufügen.
          </p>
        )}

        {focusedQuest && (
          <>
            <div class="rpg-quest-block-wrap">
              <QuestDetail
                quest={focusedQuest}
                stepDone={stepDone}
                onToggleStep={onToggleStep}
                showFocusBadge
                variant="hero"
                graph={graph}
                itemCatalog={itemCatalog}
                location={location}
              />
              <RpgTreeDeepLink questId={focusedQuest.id} />
            </div>

            {others.length > 0 && (
              <>
                <p class="rpg-list-label">Weitere Quests</p>
                {others.map((q) => {
                  const pct = questProgress(q, stepDone, graph);
                  const open = expanded.has(q.id);
                  const teaser = (q.description || '').replace(/\s+/g, ' ').trim();

                  return (
                    <div key={q.id} class="rpg-strip">
                      <div class="rpg-strip__head">
                        <button
                          type="button"
                          class="rpg-strip__focus"
                          onClick={() => setFocused(q.id)}
                          aria-label={`${q.title} als Fokus`}
                        >
                          <span class="rpg-strip__title">{q.title}</span>
                          <span class="rpg-strip__pct">{pct}%</span>
                          <span class="rpg-strip__teaser">{teaser}</span>
                        </button>
                        <button
                          type="button"
                          class="rpg-strip__expand"
                          onClick={() => toggleExpand(q.id)}
                          aria-expanded={open}
                          aria-label={open ? 'Quest einklappen' : 'Quest ausklappen'}
                        >
                          <span class={`rpg-strip__chev${open ? ' rpg-strip__chev--open' : ''}`}>▸</span>
                        </button>
                      </div>
                      {open && (
                        <div class="rpg-strip__body">
                          <div class="rpg-quest-block-wrap rpg-quest-block-wrap--strip">
                            <QuestDetail
                              quest={q}
                              stepDone={stepDone}
                              onToggleStep={onToggleStep}
                              showFocusBadge={false}
                              variant="embedded"
                              graph={graph}
                              itemCatalog={itemCatalog}
                              location={location}
                            />
                            <RpgTreeDeepLink questId={q.id} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
