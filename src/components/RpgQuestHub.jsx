import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { SAMPLE_RPG_GRAPH } from '../lib/rpg-quests-data.js';
import {
  questMap,
  isQuestCompleted,
  isQuestUnlocked,
  questProgress,
} from '../lib/rpg-quest-graph.js';
import {
  loadAddedIds,
  saveAddedIds,
  loadStepDone,
  saveStepDone,
  loadCustomGraph,
} from '../lib/rpg-persistence.js';
import './rpg-quest-hub.css';

function mergeStepDoneBase(serverBase, persisted) {
  const out = { ...serverBase };
  for (const qid of Object.keys(persisted)) {
    out[qid] = { ...(out[qid] || {}), ...persisted[qid] };
  }
  return out;
}

function buildInitialStepMapFromGraph(graph) {
  /** @type {Record<string, Record<string, boolean>>} */
  const m = {};
  for (const q of graph.quests || []) {
    m[q.id] = {};
    for (const s of q.steps || []) {
      if (s.done) m[q.id][s.id] = true;
    }
  }
  return m;
}

function firstId(list) {
  return list?.[0]?.id ?? null;
}

function activeQuestsForKind(graph, added, stepDone, kind) {
  const out = [];
  for (const q of graph.quests || []) {
    if (q.kind !== kind) continue;
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

function QuestDetail({ quest, stepDone, onToggleStep, showFocusBadge, variant = 'hero' }) {
  const doneFor = stepDone[quest.id] || {};
  const TitleTag = variant === 'hero' ? 'h2' : 'h3';
  const wrapClass =
    variant === 'hero' ? 'rpg-quest-block rpg-quest-block--hero' : 'rpg-quest-block rpg-quest-block--embedded';

  return (
    <div class={wrapClass}>
      {showFocusBadge && <div class="rpg-quest-block__badge">Fokus</div>}
      <TitleTag class="rpg-quest-block__title">{quest.title}</TitleTag>
      <p class="rpg-quest-block__desc">{quest.description}</p>
      <p class="rpg-section-label">Schritte</p>
      <ul class="rpg-steps">
        {(quest.steps || []).map((s) => (
          <li key={s.id} class="rpg-step">
            <label style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!doneFor[s.id]}
                onChange={() => onToggleStep(quest.id, s.id)}
              />
              <span>{s.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <p class="rpg-section-label">Rewards</p>
      <div class="rpg-rewards">
        {(quest.rewards || []).map((r, i) => (
          <span key={i} class="rpg-reward-pill" aria-hidden="true">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RpgQuestHub() {
  const [graph, setGraph] = useState(SAMPLE_RPG_GRAPH);
  const [added, setAdded] = useState(() => loadAddedIds());
  const [category, setCategory] = useState(/** @type {'main' | 'side'} */ ('main'));
  const [focusedByCat, setFocusedByCat] = useState({ main: null, side: null });
  const [expanded, setExpanded] = useState(() => new Set());
  const [stepDone, setStepDone] = useState(() =>
    mergeStepDoneBase(buildInitialStepMapFromGraph(SAMPLE_RPG_GRAPH), loadStepDone())
  );

  useEffect(() => {
    saveAddedIds(added);
  }, [added]);

  useEffect(() => {
    saveStepDone(stepDone);
  }, [stepDone]);

  useEffect(() => {
    const custom = loadCustomGraph();
    if (custom?.quests?.length) {
      /** @type {{ quests: typeof SAMPLE_RPG_GRAPH.quests; edges: typeof SAMPLE_RPG_GRAPH.edges }} */
      const g = { quests: /** @type {typeof SAMPLE_RPG_GRAPH.quests} */ (custom.quests), edges: /** @type {typeof SAMPLE_RPG_GRAPH.edges} */ (custom.edges) };
      setGraph(g);
      const base = buildInitialStepMapFromGraph(g);
      setStepDone((prev) => mergeStepDoneBase(base, prev));
      return;
    }
    fetch('/api/rpg/quests')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.graph?.quests?.length) {
          setGraph(data.graph);
          const base = buildInitialStepMapFromGraph(data.graph);
          setStepDone((prev) => mergeStepDoneBase(base, prev));
        }
      })
      .catch(() => {});
  }, []);

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

  const mainActive = useMemo(
    () => activeQuestsForKind(graph, added, stepDone, 'main'),
    [graph, added, stepDone]
  );
  const sideActive = useMemo(
    () => activeQuestsForKind(graph, added, stepDone, 'side'),
    [graph, added, stepDone]
  );

  const quests = category === 'main' ? mainActive : sideActive;

  useEffect(() => {
    setFocusedByCat((prev) => {
      const id = prev[category];
      if (id && quests.some((q) => q.id === id)) return prev;
      return { ...prev, [category]: firstId(quests) };
    });
  }, [category, quests]);

  const focusedId = focusedByCat[category] ?? firstId(quests);
  const focusedQuest = useMemo(
    () => quests.find((q) => q.id === focusedId) ?? quests[0] ?? null,
    [quests, focusedId]
  );

  const others = useMemo(
    () => quests.filter((q) => q.id !== (focusedQuest?.id ?? '')),
    [quests, focusedQuest]
  );

  const onToggleStep = useCallback((questId, stepId) => {
    setStepDone((prev) => ({
      ...prev,
      [questId]: { ...prev[questId], [stepId]: !prev[questId]?.[stepId] },
    }));
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setFocused = useCallback(
    (id) => {
      setFocusedByCat((prev) => ({ ...prev, [category]: id }));
    },
    [category]
  );

  return (
    <div class="rpg-hub">
      <aside class="rpg-hub__rail" aria-label="Quest-Kategorien">
        <div class="rpg-hub__rail-label">Kategorie</div>
        <button
          type="button"
          class={`rpg-hub__cat${category === 'main' ? ' rpg-hub__cat--active' : ''}`}
          onClick={() => setCategory('main')}
        >
          Main
        </button>
        <button
          type="button"
          class={`rpg-hub__cat${category === 'side' ? ' rpg-hub__cat--active' : ''}`}
          onClick={() => setCategory('side')}
        >
          Side
        </button>
        <div class="rpg-hub__rail-spacer" />
        <a class="rpg-hub__tree-link" href="/rpg/tree">
          Quest-Baum
        </a>
      </aside>

      <main class="rpg-hub__main">
        {!focusedQuest && (
          <p class="rpg-hub__empty">
            Keine aktiven Quests in dieser Kategorie. Im{' '}
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
              />
              <RpgTreeDeepLink questId={focusedQuest.id} />
            </div>

            {others.length > 0 && (
              <>
                <p class="rpg-list-label">Weitere Quests</p>
                {others.map((q) => {
                  const pct = questProgress(q, stepDone);
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
