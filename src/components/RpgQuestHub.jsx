import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import RpgBootstrapLoading from './RpgBootstrapLoading.jsx';
import {
  questMap,
  isQuestCompleted,
  isQuestUnlocked,
  questProgress,
} from '../lib/rpg-quest-graph.js';
import { reconcileRpgVitals } from '../lib/rpg-vitals.js';
import { useRpgBootstrap } from '../lib/useRpgBootstrap.js';
import RpgQuestNodesView from './RpgQuestNodesView.jsx';
import './rpg-quest-hub.css';

function firstId(list) {
  return list?.[0]?.id ?? null;
}

function activeNodes(graph, added, nodeDone) {
  const out = [];
  for (const q of graph.nodes || []) {
    if (!added.has(q.id)) continue;
    if (isQuestCompleted(q, nodeDone)) continue;
    out.push(q);
  }
  return out;
}

function RpgTreeDeepLink({ questId }) {
  return (
    <a
      class="rpg-hub-tree-deep"
      href={`/rpg/tree?focus=${encodeURIComponent(questId)}`}
      aria-label="Im Node-Baum anzeigen"
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
  nodeDone,
  onToggleNode,
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
      <p class="rpg-section-label">Nodes</p>
      <RpgQuestNodesView
        node={quest}
        nodeDone={nodeDone}
        onToggleNode={onToggleNode}
        interactive
        childrenClass="rpg-nodes"
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
  const {
    graph, setGraph,
    added, setAdded,
    nodeDone, setNodeDone,
    itemCatalog,
    vitals, setVitals,
    location,
    bootstrapped,
    persistError, setPersistError,
    markDirty,
  } = useRpgBootstrap();

  const [focusedId, setFocusedId] = useState(/** @type {string | null} */ (null));
  const [expanded, setExpanded] = useState(() => new Set());

  // Hub-spezifisch: addedIds bereinigen wenn Quests abgeschlossen/gesperrt werden
  useEffect(() => {
    const m = questMap(graph);
    setAdded((prev) => {
      const next = new Set();
      for (const id of prev) {
        const q = m.get(id);
        if (!q) continue;
        if (isQuestCompleted(q, nodeDone)) continue;
        if (!isQuestUnlocked(id, graph, nodeDone, m)) continue;
        next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [graph, nodeDone]);

  const quests = useMemo(() => activeNodes(graph, added, nodeDone), [graph, added, nodeDone]);

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

  const onToggleNode = useCallback(
    (questId, nodeId) => {
      markDirty();
      setNodeDone((prev) => {
        const next = {
          ...prev,
          [questId]: { ...prev[questId], [nodeId]: !prev[questId]?.[nodeId] },
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
      {persistError && (
        <div class="rpg-persist-error" role="alert">
          <span>{persistError}</span>
          <button type="button" onClick={() => setPersistError(null)} aria-label="Schließen">×</button>
        </div>
      )}
      <aside class="rpg-hub__rail" aria-label="Quests">
        <div class="rpg-hub__rail-label">Aktive Nodes</div>
        <div class="rpg-hub__rail-spacer" />
        <a class="rpg-hub__tree-link" href="/rpg/tree">
          Node-Baum
        </a>
      </aside>

      <main class="rpg-hub__main">
        {!focusedQuest && (
          <p class="rpg-hub__empty">
            Keine aktiven Nodes. Im{' '}
            <a href="/rpg/tree">Node-Baum</a> Nodes hinzufügen.
          </p>
        )}

        {focusedQuest && (
          <>
            <div class="rpg-quest-block-wrap">
              <QuestDetail
                quest={focusedQuest}
                nodeDone={nodeDone}
                onToggleNode={onToggleNode}
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
                <p class="rpg-list-label">Weitere Nodes</p>
                {others.map((q) => {
                  const pct = questProgress(q, nodeDone, graph);
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
                              nodeDone={nodeDone}
                              onToggleNode={onToggleNode}
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
