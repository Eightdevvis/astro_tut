import { useState, useMemo } from 'preact/hooks';
import { canSetNodeDone, buildRewardDisplayList } from '../lib/rpg-quest-nodes.js';
import { nodeProgress, computeLockedNodeIds } from '../lib/rpg-quest-graph.js';
import { normalizeQuestCityLocation, normalizeNodePlaceLocation } from '../lib/rpg-location.js';
import { resolveNodeGuardQuest } from '../lib/rpg-graph-validation.js';

// Einheitlicher Tooltip-Text fuer alle Reward-Pills, egal ob der Reward
// auf dem View-Node selbst oder auf einem Descendant liegt.
function rewardTooltip(unlocked) {
  return unlocked ? 'Quest erledigt' : 'Nach Erledigung der Quest';
}

function RewardCubeIcon() {
  return (
    <svg
      class="rpg-reward-pill__cube"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.35"
        d="M8 1 2 4v6l6 3 6-3V4L8 1zm0 1.2 4.2 2.1L8 6.4 3.8 4.4 8 2.2zM3 5.2l4 2v4.5l-4-2V5.2zm10 0v4.5l-4 2V7.2l4-2z"
      />
    </svg>
  );
}

function RewardHeartIcon() {
  return (
    <svg
      class="rpg-reward-pill__points-icon rpg-reward-pill__points-icon--heart"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.9"
        d="M8 13.2 2.2 7.4c-1.1-1.1-1.1-2.9 0-4 1.1-1.1 2.9-1.1 4 0l1.8 1.8 1.8-1.8c1.1-1.1 2.9-1.1 4 0 1.1 1.1 1.1 2.9 0 4L8 13.2z"
      />
    </svg>
  );
}

/** Achtzack-Stern (zwei überlagerte Quadrate). */
function RewardManaStarIcon() {
  return (
    <svg
      class="rpg-reward-pill__points-icon rpg-reward-pill__points-icon--mana"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.9"
        d="M8.00,1.80L9.07,5.41L12.38,3.62L10.59,6.93L14.20,8.00L10.59,9.07L12.38,12.38L9.07,10.59L8.00,14.20L6.93,10.59L3.62,12.38L5.41,9.07L1.80,8.00L5.41,6.93L3.62,3.62L6.93,5.41Z"
      />
    </svg>
  );
}

// NodeLockIcon entfaellt seit 2026-05-04 — die Lock-Sibling-Mechanik
// (node.isLock) zeigt sich jetzt einheitlich ueber das `--treelocked`-Dimming
// der gesperrten Geschwister-Nodes (siehe `lockedNodeIds` weiter unten).

/**
 * @param {{
 *   node: import('../lib/rpg-quests-data.js').RpgNode;
 *   nodeDone: Record<string, Record<string, boolean>>;
 *   onToggleNode?: (scopeNodeId: string, nodeId: string) => void;
 *   interactive?: boolean;
 *   showChildren?: boolean;
 *   childrenClass?: string;
 *   rewardsClass?: string;
 *   graph?: import('../lib/rpg-quest-graph.js').RpgGraph | null;
 *   itemCatalog?: Record<string, { title?: string }>;
 *   currentLocation?: { city?: string; place?: string } | null;
 *   showLocationGuidance?: boolean;
 *   doneScopeNodeId?: string;
 *   guardQuest?: import('../lib/rpg-quests-data.js').RpgNode | null;
 *   showRewards?: boolean;
 * }} props
 */
export default function RpgQuestNodesView({
  node,
  nodeDone,
  onToggleNode = () => {},
  interactive = true,
  showChildren = true,
  childrenClass = 'rpg-nodes',
  rewardsClass = 'rpg-rewards',
  graph = null,
  itemCatalog = {},
  currentLocation = null,
  showLocationGuidance = true,
  doneScopeNodeId = '',
  guardQuest = null,
  showRewards = true,
}) {
  const activeNode = node;
  const activeNodeDone = nodeDone || {};
  const activeToggle = onToggleNode || (() => {});
  const activeShowChildren = !!showChildren;
  const activeChildrenClass = childrenClass || 'rpg-nodes';
  const activeDoneScopeNodeId = doneScopeNodeId || activeNode?.id || '';
  const [focusedNodeId, setFocusedNodeId] = useState(/** @type {string | null} */ (null));
  if (!activeNode) return null;
  // Phase 2: nodeDone ist flach (Record<nodeId, boolean>). Frueher haben wir
  // hier `nodeDone[scopeId]` ausgepackt — das gibt es nicht mehr.
  // Fuer Compat mit V2-Eingaben fallen wir auf den verschachtelten Pfad zurueck,
  // wenn der Top-Level-Wert kein boolean ist.
  /** @type {Record<string, boolean>} */
  const doneFor = (() => {
    if (!activeNodeDone || typeof activeNodeDone !== 'object') return {};
    // Wenn es Top-Level booleans gibt, ist es flach → komplettes Objekt nutzen.
    const hasTopLevelBoolean = Object.values(activeNodeDone).some((v) => typeof v === 'boolean');
    if (hasTopLevelBoolean) return /** @type {any} */ (activeNodeDone);
    // V2-Compat: nodeDone[scopeId] → Record<nodeId, boolean>
    return activeNodeDone[activeDoneScopeNodeId] || {};
  })();
  // Aggregierten Graph-Progress nur fuer Root-Views verwenden — fuer Sub-Node-Views
  // ist die scope-ID nicht der Node selbst und nodeProgress kennt sie im Graph nicht.
  const isRootView = activeDoneScopeNodeId === activeNode.id;
  const rewardProgressPct = (graph && isRootView) ? nodeProgress(graph, activeNode.id, activeNodeDone) : undefined;
  const questCity = normalizeQuestCityLocation(activeNode.cityLocation);
  const currentCity = normalizeQuestCityLocation(currentLocation?.city);
  const cityMismatch = !!questCity && !!currentCity && questCity !== currentCity;
  const cityLead = Object.values(doneFor).some(Boolean) ? 'Kehre zurueck zu' : 'Gehe zu';

  // Lock-Set fuer visuelles Dimming der gesperrten Sub-Nodes — einheitlich
  // mit dem Tree-View. Berechnet:
  //   - Edge-Lock (child/parent/both) auf parent_of-Edges
  //   - Sibling-Lock via aktive node.isLock-Nodes (nodeDone-aware)
  // Wenn kein Graph uebergeben wurde, leeres Set → keine Dimming-Wirkung.
  const lockedNodeIds = useMemo(
    () => (graph ? computeLockedNodeIds(graph, activeNodeDone) : new Set()),
    [graph, activeNodeDone]
  );

  return (
    <>
      {activeShowChildren ? (
        <ul class={activeChildrenClass}>
          {cityMismatch ? (
            <li class="rpg-node rpg-node--location-blocked">
              <span class="rpg-node__location-hint">
                {cityLead} {questCity}.
              </span>
            </li>
          ) : (
            (activeNode.children || []).map((childNode) => (
              <NodeBranch
                key={childNode.id}
                node={activeNode}
                guardQuest={guardQuest || activeNode}
                childNode={childNode}
                depth={0}
                doneFor={doneFor}
                nodeDone={activeNodeDone}
                onToggleNode={activeToggle}
                interactive={interactive}
                focusedNodeId={focusedNodeId}
                setFocusedNodeId={setFocusedNodeId}
                currentLocation={currentLocation}
                questCity={questCity}
                showLocationGuidance={showLocationGuidance}
                doneScopeNodeId={activeDoneScopeNodeId}
                graph={graph}
                lockedNodeIds={lockedNodeIds}
              />
            ))
          )}
        </ul>
      ) : null}
      {showRewards && <p class="rpg-section-label">Rewards</p>}
      {showRewards && (
        <div class={rewardsClass}>
          {buildRewardDisplayList(activeNode, activeNodeDone, {
            scopeQuestId: activeDoneScopeNodeId,
            selfProgressPercent: rewardProgressPct,
            itemCatalogById: itemCatalog,
          }).map((row, i) => (
            <span
              key={`${row.nodeId}-${i}-${row.kind}-${row.kind === 'points' && row.pointKind ? row.pointKind : ''}-${row.label.slice(0, 24)}`}
              class={`rpg-reward-pill${row.kind === 'item' ? ' rpg-reward-pill--item' : ''}${
                row.kind === 'points' ? ' rpg-reward-pill--points' : ''
              }${row.kind === 'achievement' ? ' rpg-reward-pill--achievement' : ''}${row.unlocked ? '' : ' rpg-reward-pill--locked'}`}
              title={rewardTooltip(row.unlocked)}
            >
              {row.kind === 'item' ? (
                <>
                  <RewardCubeIcon />
                  <span class="rpg-reward-pill__label">{row.label}</span>
                </>
              ) : row.kind === 'points' ? (
                <>
                  {row.pointKind === 'mana' ? <RewardManaStarIcon /> : <RewardHeartIcon />}
                  <span class="rpg-reward-pill__label rpg-reward-pill__label--points">{row.label}</span>
                </>
              ) : row.kind === 'achievement' ? (
                <>
                  <span class="rpg-reward-pill__achievement-icon" aria-hidden="true">🏆</span>
                  <span class="rpg-reward-pill__label">{row.label}</span>
                </>
              ) : (
                <span class="rpg-reward-pill__label">{row.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * @param {{
 *   node: import('../lib/rpg-quests-data.js').RpgNode;
 *   guardQuest: import('../lib/rpg-quests-data.js').RpgNode | null;
 *   childNode: Record<string, unknown> & { id: string; title: string; children?: unknown[]; optional?: boolean };
 *   depth: number;
 *   doneFor: Record<string, boolean>;
 *   nodeDone: Record<string, Record<string, boolean>>;
 *   onToggleNode: (scopeNodeId: string, nodeId: string) => void;
 *   interactive: boolean;
 *   focusedNodeId: string | null;
 *   setFocusedNodeId: (id: string | null) => void;
 *   currentLocation: { city?: string; place?: string } | null;
 *   questCity: string;
 *   showLocationGuidance: boolean;
 *   doneScopeNodeId: string;
 *   graph?: import('../lib/rpg-quest-graph.js').RpgGraph | null;
 * }} props
 */
function NodeBranch({
  node,
  guardQuest,
  childNode,
  depth,
  doneFor,
  nodeDone,
  onToggleNode,
  interactive,
  focusedNodeId,
  setFocusedNodeId,
  currentLocation,
  questCity,
  showLocationGuidance,
  doneScopeNodeId,
  graph = null,
  lockedNodeIds = null,
}) {
  const hasSubs = Array.isArray(childNode.children) && childNode.children.length > 0;
  // Treelocked: dieser Node ist via Edge-Lock oder Sibling-Lock im
  // gemeinsamen Lock-Set. Visuell gedimmt — analog zum Tree-View.
  const isTreeLocked = !!(lockedNodeIds && lockedNodeIds.has(childNode.id));

  if (hasSubs) {
    // Fortschritt fuer Gruppen-Nodes berechnen (nur wenn graph vorhanden)
    const groupPct = graph ? nodeProgress(childNode, nodeDone, graph) : undefined;

    return (
      <li
        key={childNode.id}
        class={`rpg-node rpg-node--group${isTreeLocked ? ' rpg-node--treelocked' : ''}`}
        style={{ '--rpg-node-depth': String(depth) }}
      >
        <details class="rpg-node__details" open={depth < 1}>
          <summary class="rpg-node__summary">
            <span class="rpg-node__summary-text">
              {childNode.title}
              {childNode.description ? <small class="rpg-node__desc">{childNode.description}</small> : null}
            </span>
            {/* NodeLockIcon entfaellt — Sibling-Lock-Wirkung jetzt via --treelocked-Dimming. */}
            {childNode.optional ? (
              <span class="rpg-node-badge" title="Optional">
                optional
              </span>
            ) : null}
            {typeof groupPct === 'number' ? (
              <span class="rpg-node__progress">{groupPct}%</span>
            ) : null}
          </summary>
          <ul class="rpg-nodes rpg-nodes--nested">
            {childNode.children.map((ch) => (
              <NodeBranch
                key={ch.id}
                node={node}
                guardQuest={guardQuest}
                childNode={ch}
                depth={depth + 1}
                doneFor={doneFor}
                nodeDone={nodeDone}
                onToggleNode={onToggleNode}
                interactive={interactive}
                focusedNodeId={focusedNodeId}
                setFocusedNodeId={setFocusedNodeId}
                currentLocation={currentLocation}
                questCity={questCity}
                showLocationGuidance={showLocationGuidance}
                doneScopeNodeId={doneScopeNodeId}
                graph={graph}
                lockedNodeIds={lockedNodeIds}
              />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  const checked = !!doneFor[childNode.id];
  const questForGuards = resolveNodeGuardQuest(node, guardQuest);
  const depBlocked = interactive && !checked && !canSetNodeDone(questForGuards, childNode.id, nodeDone, true);
  const nodePlace = normalizeNodePlaceLocation(childNode.placeLocation);
  const nodeCity = normalizeQuestCityLocation(childNode.cityLocation) || questCity;
  const currentCity = normalizeQuestCityLocation(currentLocation?.city);
  const currentPlace = normalizeNodePlaceLocation(currentLocation?.place);
  const placeMismatch =
    showLocationGuidance &&
    !!nodePlace &&
    (!!nodeCity ? nodeCity === currentCity : true) &&
    nodePlace !== currentPlace;
  const isFocused = focusedNodeId === childNode.id;
  const hasFocusedSibling = !!focusedNodeId;
  const showGoToHint = isFocused && placeMismatch;

  const toggle = () => {
    if (checked) {
      onToggleNode(doneScopeNodeId, childNode.id);
      return;
    }
    if (canSetNodeDone(questForGuards, childNode.id, nodeDone, true)) {
      onToggleNode(doneScopeNodeId, childNode.id);
    }
  };

  return (
    <li
      key={childNode.id}
      class={`rpg-node rpg-node--leaf${childNode.optional ? ' rpg-node--optional' : ''}${
        hasFocusedSibling && !isFocused ? ' rpg-node--dimmed' : ''
      }${showGoToHint ? ' rpg-node--place-blocked' : ''}${
        isTreeLocked ? ' rpg-node--treelocked' : ''
      }`}
      style={{ '--rpg-node-depth': String(depth) }}
      onMouseEnter={() => setFocusedNodeId(childNode.id)}
      onFocusCapture={() => setFocusedNodeId(childNode.id)}
    >
      <label class={`rpg-node__label${!interactive ? ' rpg-node__label--readonly' : ''}`}>
        {interactive ? (
          <input
            type="checkbox"
            checked={checked}
            disabled={depBlocked}
            onChange={toggle}
          />
        ) : null}
        <span class="rpg-node__text-wrap">
          {showGoToHint ? (
            <span class="rpg-node__location-hint">Go to {nodePlace}.</span>
          ) : null}
          <span class="rpg-node__text">{childNode.title}</span>
          {childNode.description ? <small class="rpg-node__desc">{childNode.description}</small> : null}
        </span>
        {/* NodeLockIcon entfaellt — Sibling-Lock-Wirkung jetzt via --treelocked-Dimming. */}
        {childNode.optional ? (
          <span class="rpg-node-badge" title="Optional">
            optional
          </span>
        ) : null}
        {childNode.timeDueAt && String(childNode.timeDueAt).trim() ? (
          <span class="rpg-node-badge rpg-node-badge--due" title="Frist">
            bis {String(childNode.timeDueAt).trim().slice(0, 10)}
          </span>
        ) : null}
        {depBlocked ? (
          <span class="rpg-node-hint" title="Zuerst abhängige Quests erledigen">
            gesperrt
          </span>
        ) : null}
      </label>
    </li>
  );
}
