import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import RpgBootstrapLoading from './RpgBootstrapLoading.jsx';
import {
  questMap,
  isQuestCompleted,
  isQuestUnlocked,
  questProgress,
} from '../lib/rpg-quest-graph.js';
import {
  findNodeWithAncestors,
  questLeafProgressRatio,
} from '../lib/rpg-quest-nodes.js';
import { reconcileRpgVitals } from '../lib/rpg-vitals.js';
import { useRpgBootstrap } from '../lib/useRpgBootstrap.js';
import RpgQuestNodesView from './RpgQuestNodesView.jsx';
import './rpg-quest-hub.css';

/**
 * Liefert alle aktiven Hub-Einträge: Root-Quests ODER Sub-Quests die per Tree-Pick
 * hinzugefügt wurden. Gibt immer { node, rootQuestId, ancestors } zurück —
 * Root-Entries haben ancestors = [].
 *
 * @param {import('../lib/rpg-quests-data.js').RpgGraph} graph
 * @param {Set<string>} added
 * @param {Record<string, Record<string, boolean>>} nodeDone
 * @returns {{ node: any; rootQuestId: string; ancestors: any[] }[]}
 */
function activeHubEntries(graph, added, nodeDone) {
  const out = [];
  for (const id of added) {
    const found = findNodeWithAncestors(graph, id);
    if (!found) continue;
    const { node, rootQuestId, ancestors } = found;
    // Root-Quest-Completion prüfen — wenn Root fertig ist, sind alle Sub-Quests auch fertig
    const rootQuest = (graph.nodes || []).find((q) => q.id === rootQuestId);
    if (!rootQuest || isQuestCompleted(rootQuest, nodeDone)) continue;
    out.push({ node, rootQuestId, ancestors });
  }
  return out;
}

/**
 * Kleiner Sprung-Link in den Quest-Baum mit Fokus auf die Root-Quest.
 * Visuell ein dezentes Gold-Pill am unteren linken Rand des Hero-Blocks.
 */
function RpgTreeDeepLink({ questId }) {
  return (
    <a
      class="rpg-hub-tree-deep"
      href={`/rpg/tree?focus=${encodeURIComponent(questId)}`}
      aria-label="Im Quest-Baum anzeigen"
      title="Im Quest-Baum anzeigen"
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

/**
 * Detail-Block fuer eine Quest: Eltern-Kontext, Titel, Beschreibung,
 * Sub-Quest-Baum (delegiert an RpgQuestNodesView). Wird sowohl als
 * Hero-Block (variant='hero') als auch eingebettet im Strip (variant='embedded')
 * verwendet — in beiden Faellen identische Information, nur unterschiedliche Chrome.
 */
function QuestDetail({
  node,
  rootQuestId,
  ancestors,
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

  // "Teil von X › Y" — nur wenn der Node ein Sub-Quest-Knoten ist, nicht Root-Level
  const parentContext = ancestors.length > 0
    ? `Teil von ${ancestors.map((a) => a.title || a.id).join(' › ')}`
    : null;

  return (
    <div class={wrapClass}>
      {showFocusBadge && <div class="rpg-quest-block__badge">Fokus</div>}
      {parentContext && <p class="rpg-quest-block__parent-context">{parentContext}</p>}
      <TitleTag class="rpg-quest-block__title">{node.title}</TitleTag>
      {node.description ? <p class="rpg-quest-block__desc">{node.description}</p> : null}
      <p class="rpg-section-label">Zweige</p>
      <RpgQuestNodesView
        node={node}
        nodeDone={nodeDone}
        onToggleNode={onToggleNode}
        doneScopeNodeId={rootQuestId}
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

  // Hub-spezifisch: addedIds bereinigen, wenn Root-Quests abgeschlossen oder
  // wieder gesperrt werden — sonst zeigt der Hub Geister-Quests.
  useEffect(() => {
    const m = questMap(graph);
    setAdded((prev) => {
      const next = new Set();
      for (const id of prev) {
        const found = findNodeWithAncestors(graph, id);
        if (!found) continue;
        const rootQuest = m.get(found.rootQuestId);
        if (!rootQuest) continue;
        if (isQuestCompleted(rootQuest, nodeDone)) continue;
        if (!isQuestUnlocked(found.rootQuestId, graph, nodeDone, m)) continue;
        next.add(id);
      }
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [graph, nodeDone]);

  // Aktive Eintraege: entweder Root-Quests oder Sub-Quests (mit Eltern-Kontext)
  const entries = useMemo(() => activeHubEntries(graph, added, nodeDone), [graph, added, nodeDone]);

  // Fokus-Eintrag stabilisieren: bleibt erhalten solange er aktiv ist,
  // sonst auf den ersten Eintrag setzen.
  useEffect(() => {
    if (focusedId && entries.some((e) => e.node.id === focusedId)) return;
    setFocusedId(entries[0]?.node.id ?? null);
  }, [focusedId, entries]);

  const focusedEntry = useMemo(
    () => entries.find((e) => e.node.id === focusedId) ?? entries[0] ?? null,
    [entries, focusedId]
  );

  const otherEntries = useMemo(
    () => entries.filter((e) => e.node.id !== (focusedEntry?.node.id ?? '')),
    [entries, focusedEntry]
  );

  // Toggle einer Sub-Quest (Leaf abhaken). Aktualisiert Vitals via reconcile,
  // damit Heart/Mana sofort korrekt sind.
  //
  // Phase 2: nodeDone ist flach (Record<nodeId, boolean>). questId vom
  // Aufrufer ignoriert — der Done-Status haengt jetzt an der Node-ID selbst.
  const onToggleNode = useCallback(
    (_questId, nodeId) => {
      markDirty();
      setNodeDone((prev) => {
        const wasOn = prev[nodeId] === true;
        const next = { ...prev };
        if (wasOn) delete next[nodeId];
        else next[nodeId] = true;
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
      {/* Persist-Error: schwebt zentriert oben, bleibt bis vom User geschlossen */}
      {persistError && (
        <div class="rpg-persist-error" role="alert">
          <span>{persistError}</span>
          <button type="button" onClick={() => setPersistError(null)} aria-label="Schließen">×</button>
        </div>
      )}

      {/* Topbar: Titel links, Tree-Link rechts (analog zur Tree-Topbar) */}
      <header class="rpg-hub__top">
        <p class="rpg-hub__top-title">
          Codex der Quests
          <em>· Sammlung</em>
        </p>
        <a class="rpg-hub__tree-link" href="/rpg/tree" aria-label="Zum Quest-Baum">
          <span class="rpg-hub__tree-link-glyph" aria-hidden="true">✷</span>
          Quest-Baum
        </a>
      </header>

      <main class="rpg-hub__main">
        {!focusedEntry && (
          <p class="rpg-hub__empty">
            Keine aktiven Quests. Im{' '}
            <a href="/rpg/tree">Quest-Baum</a> Quests hinzufügen.
          </p>
        )}

        {focusedEntry && (
          <>
            {/* Hero-Block: Fokus-Quest mit goldenem Rim und Eck-Markern */}
            <div class="rpg-quest-block-wrap">
              <QuestDetail
                node={focusedEntry.node}
                rootQuestId={focusedEntry.rootQuestId}
                ancestors={focusedEntry.ancestors}
                nodeDone={nodeDone}
                onToggleNode={onToggleNode}
                showFocusBadge
                variant="hero"
                graph={graph}
                itemCatalog={itemCatalog}
                location={location}
              />
              <RpgTreeDeepLink questId={focusedEntry.rootQuestId} />
            </div>

            {/* Strips: weitere aktive Quests (klick fokussiert, expand klappt auf) */}
            {otherEntries.length > 0 && (
              <>
                <p class="rpg-list-label">Weitere Quests</p>
                {otherEntries.map((entry) => {
                  // Fortschritt: einheitlich via questLeafProgressRatio mit scopeQuestId.
                  // Funktioniert identisch fuer Root- (entry.node === Root, scope === Root.id)
                  // und Sub-Node-Eintraege (entry.node === Sub-Node, scope === Root-Quest-ID).
                  const pct = questLeafProgressRatio(entry.node, nodeDone, entry.rootQuestId).percent;
                  const open = expanded.has(entry.node.id);
                  const teaser = (entry.node.description || '').replace(/\s+/g, ' ').trim();
                  // Sub-Quest-Titel mit Eltern-Pfad praefixen, damit klar bleibt wo sie sitzt
                  const displayTitle = entry.ancestors.length > 0
                    ? `${entry.ancestors.map((a) => a.title || a.id).join(' › ')} › ${entry.node.title}`
                    : entry.node.title;

                  return (
                    <div key={entry.node.id} class="rpg-strip">
                      <div class="rpg-strip__head">
                        <button
                          type="button"
                          class="rpg-strip__focus"
                          onClick={() => setFocused(entry.node.id)}
                          aria-label={`${entry.node.title} als Fokus`}
                        >
                          <span class="rpg-strip__title">{displayTitle}</span>
                          <span class="rpg-strip__pct">{pct}%</span>
                          <span class="rpg-strip__teaser">{teaser}</span>
                        </button>
                        <button
                          type="button"
                          class="rpg-strip__expand"
                          onClick={() => toggleExpand(entry.node.id)}
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
                              node={entry.node}
                              rootQuestId={entry.rootQuestId}
                              ancestors={entry.ancestors}
                              nodeDone={nodeDone}
                              onToggleNode={onToggleNode}
                              showFocusBadge={false}
                              variant="embedded"
                              graph={graph}
                              itemCatalog={itemCatalog}
                              location={location}
                            />
                            <RpgTreeDeepLink questId={entry.rootQuestId} />
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
