/**
 * RpgQuestPanel — Rechtes Detail-Panel im Codex-Stil.
 *
 * Zeigt Quest-Header mit Sigil, Fortschrittsbalken, Rewards,
 * und verschachtelte Node-Ansicht. Integriert den bestehenden
 * RpgQuestNodesView fuer die Baum-Darstellung der Sub-Nodes.
 *
 * Adaptiert aus designs/questtree-design-27,4,26/quest-panel.jsx fuer Preact
 * und das reale Datenmodell (RpgNode/RpgGraph).
 */
import { useMemo } from 'preact/hooks';
import RpgQuestNodesView from './RpgQuestNodesView.jsx';
import { questProgress as nodeProgress } from '../lib/rpg-quest-graph.js';
import { countQuestLeaves } from '../lib/rpg-tree-svg.js';

/**
 * Status-Eyebrow: menschenlesbarer Label fuer den Quest-Status.
 */
function statusEyebrow(quest, unlocked, completed, added) {
  if (completed) return 'Vollendet';
  if (!unlocked) return 'Verschlossen';
  if (added) return 'Aktive Quest';
  return 'Verfügbar';
}

/**
 * @param {{
 *   quest: import('../lib/rpg-quests-data.js').RpgNode;
 *   selectedNodeView: import('../lib/rpg-quests-data.js').RpgNode | null;
 *   selectedGraphNode: any;
 *   unlocked: boolean;
 *   completed: boolean;
 *   added: boolean;
 *   panelAddLabel: string;
 *   addButtonDisabled: boolean;
 *   canEditSelected: boolean;
 *   nodeDone: Record<string, Record<string, boolean>>;
 *   onToggleNode: (questId: string, nodeId: string) => void;
 *   onToggleAdded: () => void;
 *   onEdit: () => void;
 *   onClose: () => void;
 *   graph: any;
 *   itemCatalog?: Record<string, any>;
 *   currentLocation?: any;
 *   progressPct: number;
 * }} props
 */
export default function RpgQuestPanel({
  quest,
  selectedNodeView,
  selectedGraphNode,
  unlocked,
  completed,
  added,
  panelAddLabel,
  addButtonDisabled,
  canEditSelected,
  nodeDone,
  onToggleNode,
  onToggleAdded,
  onEdit,
  onClose,
  graph,
  itemCatalog,
  currentLocation,
  progressPct,
}) {
  if (!quest) return null;

  const eyebrow = statusEyebrow(quest, unlocked, completed, added);
  const pct = typeof progressPct === 'number' ? progressPct : 0;
  const isActive = unlocked && added && !completed;

  // Rewards aus der Quest (sofern vorhanden)
  const rewards = useMemo(() => {
    const raw = quest.rewards || [];
    return raw.map((r) => {
      // Normalisiertes Reward-Objekt: kind/label/icon
      if (typeof r === 'string') return { kind: 'item', label: r, icon: '\u25A7' };
      return {
        kind: r.kind || r.type || 'item',
        label: r.label || r.title || r.description || '',
        icon: r.icon || (r.kind === 'heart' ? '\u2665' : r.kind === 'mana' ? '\u25D0' : '\u25A7'),
      };
    });
  }, [quest.rewards]);

  return (
    <aside class="qpanel" aria-label="Quest-Details">
      {/* Dekorativer Rand mit Eckverzierungen */}
      <div class="qpanel__rim" />

      {/* Schliessen-Button */}
      <button type="button" class="qpanel__close" onClick={onClose} aria-label="Schließen">
        {'×'}
      </button>

      {/* Quest-Header: Sigil + Titel */}
      <header class="qpanel__crest">
        {/* Dekoratives Sigil (Stern im Kreis) */}
        <svg class="qpanel__sigil" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5" />
          <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.35" />
          <path d="M30 8 L34 26 L52 30 L34 34 L30 52 L26 34 L8 30 L26 26 Z" fill="currentColor" opacity="0.85" />
        </svg>
        <div class="qpanel__title-block">
          <div class="qpanel__eyebrow">
            {eyebrow} {'·'} {quest.cityLocation || '—'}
          </div>
          <h2 class="qpanel__title">
            {selectedNodeView ? selectedNodeView.title : quest.title}
          </h2>
          {quest.questmakerPrompt && (
            <p class="qpanel__sub">{quest.questmakerPrompt}</p>
          )}
        </div>
      </header>

      {/* Fortschrittsbalken (nur fuer aktive Quests) */}
      {isActive && (
        <div class="qpanel__meter">
          <div class="qpanel__meter-rail">
            <div class="qpanel__meter-fill" style={{ width: `${pct}%` }} />
            <div class="qpanel__meter-glow" style={{ width: `${pct}%` }} />
          </div>
          <div class="qpanel__meter-label">
            <span>Fortschritt</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}

      {/* Rewards-Sektion */}
      {rewards.length > 0 && (
        <div class="qpanel__rewards">
          <div class="qpanel__section-label">Belohnungen</div>
          <div class="qpanel__rewards-row">
            {rewards.map((r, i) => (
              <span key={i} class={`reward reward--${r.kind}`}>
                <span class="reward__icon">{r.icon}</span>
                <span>{r.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Aktions-Leiste: Hinzufuegen/Entfernen + Bearbeiten */}
      <div class="qpanel__actions">
        <button
          type="button"
          class={`qpanel__action-btn${added ? ' qpanel__action-btn--remove' : ''}`}
          disabled={addButtonDisabled}
          onClick={onToggleAdded}
        >
          {completed ? 'Fertig' : panelAddLabel}
        </button>
        <button
          type="button"
          class="qpanel__action-btn qpanel__action-btn--edit"
          disabled={!canEditSelected}
          onClick={onEdit}
          aria-label="Node bearbeiten"
          title="Node bearbeiten"
        >
          {'✎'}
        </button>
      </div>

      {/* Node-Baum (verschachtelt) — delegiert an bestehendes RpgQuestNodesView */}
      <div class="qpanel__tree">
        <div class="qpanel__section-label">Zweige</div>
        {selectedNodeView ? (
          <RpgQuestNodesView
            node={selectedNodeView}
            guardQuest={quest}
            nodeDone={nodeDone}
            onToggleNode={onToggleNode}
            doneScopeNodeId={quest.id}
            interactive
            showChildren
            childrenClass="qpanel__nodes"
            rewardsClass="qpanel__node-rewards"
            graph={graph}
            itemCatalog={itemCatalog}
            currentLocation={currentLocation}
            showLocationGuidance={false}
          />
        ) : (
          <p class="qpanel__empty-hint">Noch keine Zweige.</p>
        )}
      </div>

      {/* Quest-Meta am unteren Rand */}
      <div class="qpanel__meta">
        <div class="qpanel__section-label">Details</div>
        <ul class="qpanel__meta-list">
          <li><span>Quest-ID</span><strong>{quest.id}</strong></li>
          <li><span>Wurzel-Nodes</span><strong>{Array.isArray(quest.children) ? quest.children.length : 0}</strong></li>
          <li><span>Leaf-Nodes</span><strong>{countQuestLeaves(quest)}</strong></li>
          <li><span>Aktive Node</span><strong>{selectedGraphNode?.id || 'Quest-Root'}</strong></li>
        </ul>
      </div>
    </aside>
  );
}
