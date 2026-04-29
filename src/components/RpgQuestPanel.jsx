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
import { countQuestLeaves } from '../lib/rpg-tree-svg.js';
import { nodeIsLeaf, isNodeCompleteInQuest, canSetNodeDone, buildRewardDisplayList } from '../lib/rpg-quest-nodes.js';

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
 *   selectedGraphNode: import('../lib/rpg-quests-data.js').RpgNode | null;
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

  // Der View-Node ist immer der relevante Knoten (Sub-Node wenn selektiert,
  // sonst der Root-Quest selbst). Title/Description/Rewards/Children werden
  // einheitlich darueber gelesen — kein Subtypen-Switch.
  const viewNode = selectedNodeView || quest;

  // Leaf-Done-Toggle: nur wenn der View-Node ein Leaf ist.
  // Funktioniert fuer Root-Leaves (Quest ohne Children) und Sub-Leaves identisch.
  const isLeafSelected = !!(selectedGraphNode && nodeIsLeaf(selectedGraphNode));
  const isLeafDone = isLeafSelected && isNodeCompleteInQuest(quest, selectedGraphNode.id, nodeDone);
  const canToggleLeaf = isLeafSelected && canSetNodeDone(quest, selectedGraphNode.id, nodeDone, !isLeafDone);

  // Rewards: EIN Aufruf, EINE Pipeline. buildRewardDisplayList ist
  // tiefenagnostisch — Root oder Sub-Node, gleiche Funktion, gleiche Ausgabe-Form.
  // selfProgressPercent nur uebergeben wenn der Root angezeigt wird (aggregierter
  // Graph-Progress); fuer Sub-Nodes ist isNodeCompleteInQuest die richtige Quelle.
  const rewards = useMemo(() => {
    return buildRewardDisplayList(viewNode, nodeDone, {
      scopeQuestId: quest.id,
      selfProgressPercent: viewNode === quest ? progressPct : undefined,
      itemCatalogById: itemCatalog,
    });
  }, [viewNode, quest, nodeDone, progressPct, itemCatalog]);

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
        {/* Sigil (Stern im Kreis): dekorativ bei Quest-Root, interaktiv bei Leaf-Selektion.
            Hohl = Leaf nicht erledigt, Ausgefüllt + Leuchten = erledigt. */}
        <svg
          class={[
            'qpanel__sigil',
            isLeafSelected ? 'qpanel__sigil--leaf' : '',
            isLeafDone ? 'qpanel__sigil--done' : '',
            isLeafSelected && canToggleLeaf ? 'qpanel__sigil--clickable' : '',
          ].filter(Boolean).join(' ')}
          viewBox="0 0 60 60"
          role={isLeafSelected ? 'button' : undefined}
          aria-label={isLeafSelected ? (isLeafDone ? 'Quest als offen markieren' : 'Quest als erledigt markieren') : undefined}
          aria-pressed={isLeafSelected ? isLeafDone : undefined}
          aria-hidden={!isLeafSelected}
          tabIndex={isLeafSelected && canToggleLeaf ? 0 : undefined}
          onClick={isLeafSelected && canToggleLeaf ? () => onToggleNode(quest.id, selectedGraphNode.id) : undefined}
          onKeyDown={isLeafSelected && canToggleLeaf
            ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleNode(quest.id, selectedGraphNode.id); } }
            : undefined}
        >
          <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5" />
          <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.35" />
          {/* Stern: hohl wenn Leaf-not-done, ausgefüllt wenn done oder Quest-Root */}
          <path
            d="M30 8 L34 26 L52 30 L34 34 L30 52 L26 34 L8 30 L26 26 Z"
            fill={!isLeafSelected || isLeafDone ? 'currentColor' : 'none'}
            stroke={isLeafSelected && !isLeafDone ? 'currentColor' : 'none'}
            stroke-width="1.5"
            opacity="0.85"
          />
        </svg>
        <div class="qpanel__title-block">
          <div class="qpanel__eyebrow">
            {eyebrow} {'·'} {quest.cityLocation || '—'}
          </div>
          {/* Title aus dem View-Node — gleich fuer Root und Sub-Node. */}
          <h2 class="qpanel__title">{viewNode.title || viewNode.id}</h2>
          {/* Description aus dem View-Node. Fuer den Root faellt der
              questmakerPrompt als Fallback an, weil das die einzige
              Stelle ist an der dieser angezeigt wird. */}
          {(() => {
            const desc =
              (viewNode.description && viewNode.description.trim()) ||
              (viewNode === quest && quest.questmakerPrompt) ||
              '';
            return desc ? <p class="qpanel__sub">{desc}</p> : null;
          })()}
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

      {/* Rewards-Sektion: nutzt buildRewardDisplayList-Output (kind, label, unlocked, pointKind, nodeId). */}
      {rewards.length > 0 && (
        <div class="qpanel__rewards">
          <div class="qpanel__section-label">Belohnungen</div>
          <div class="qpanel__rewards-row">
            {rewards.map((r, i) => (
              <span
                key={`${r.nodeId}-${i}-${r.kind}`}
                class={`reward reward--${r.kind}${r.unlocked ? '' : ' reward--locked'}`}
                title={r.unlocked ? undefined : 'Noch nicht freigeschaltet'}
              >
                {/* Icon je nach Typ — spiegelt die Logik aus RpgQuestNodesView */}
                {r.kind === 'item' ? (
                  <span class="reward__icon">▧</span>
                ) : r.kind === 'points' ? (
                  <span class="reward__icon">{r.pointKind === 'mana' ? '◐' : '♥'}</span>
                ) : r.kind === 'achievement' ? (
                  <span class="reward__icon">🏆</span>
                ) : (
                  <span class="reward__icon">✦</span>
                )}
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
          aria-label="Quest bearbeiten"
          title="Quest bearbeiten"
        >
          {'✎'}
        </button>
      </div>

      {/* Node-Baum (verschachtelt) — delegiert an RpgQuestNodesView.
          Identische Pipeline ob viewNode = Root oder Sub-Node. */}
      <div class="qpanel__tree">
        <div class="qpanel__section-label">Zweige</div>
        <RpgQuestNodesView
          node={viewNode}
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
          showRewards={false}
        />
      </div>

      {/* Quest-Meta am unteren Rand */}
      <div class="qpanel__meta">
        <div class="qpanel__section-label">Details</div>
        <ul class="qpanel__meta-list">
          <li><span>Quest-ID</span><strong>{quest.id}</strong></li>
          <li><span>Zweige</span><strong>{Array.isArray(quest.children) ? quest.children.length : 0}</strong></li>
          <li><span>Aufgaben</span><strong>{countQuestLeaves(quest)}</strong></li>
          <li><span>Auswahl</span><strong>{selectedGraphNode?.id || 'Quest-Root'}</strong></li>
        </ul>
      </div>
    </aside>
  );
}
