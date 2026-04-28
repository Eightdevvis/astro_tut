import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  createEmptyNodeDraft,
  newDraftKey,
  reorderDraftNodes,
} from '../lib/rpg-quest-editor-draft.js';
import { RPG_ITEM_CATEGORY_IDS } from '../lib/rpg-item-categories.js';

/** @type {Record<string, string>} */
const ITEM_CAT_UI = {
  alltag: 'Alltag',
  studium: 'Studium',
  arbeit: 'Arbeit',
  gesundheit: 'Gesundheit',
  beziehungen: 'Beziehungen',
  organisation: 'Organisation',
  sonstiges: 'Sonstiges',
};

/**
 * @typedef {import('../lib/rpg-quest-editor-draft.js').QuestNodeDraft} QuestNodeDraft
 */

function IconPencil() {
  return (
    <svg class="rpg-node-card__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <span class="rpg-node-builder__plus" aria-hidden="true">
      +
    </span>
  );
}

function IconLink() {
  return <span class="rpg-node-builder__plus" aria-hidden="true">◉</span>;
}

/**
 * @param {QuestNodeDraft[]} nodes
 * @param {string} sourceId
 * @param {string} targetId
 */
function wouldCreateSiblingCycle(nodes, sourceId, targetId) {
  if (sourceId === targetId) return true;
  /** @type {Map<string, string[]>} */
  const edges = new Map();
  for (const n of nodes) edges.set(n.key, []);
  for (const n of nodes) {
    for (const depId of n.legacyDependsOn || []) {
      if (!edges.has(depId)) continue;
      edges.get(depId).push(n.key);
    }
  }
  if (!edges.has(sourceId) || !edges.has(targetId)) return true;
  edges.get(sourceId).push(targetId);
  const seen = new Set();
  /** @param {string} cur */
  const dfs = (cur) => {
    if (cur === sourceId && seen.size > 0) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    for (const nxt of edges.get(cur) || []) {
      if (nxt === sourceId) return true;
      if (dfs(nxt)) return true;
    }
    seen.delete(cur);
    return false;
  };
  return dfs(sourceId);
}

/**
 * @param {QuestNodeDraft[]} nodes
 * @returns {boolean}
 */
function hasAnyLevelWithAtLeastTwoNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const savedCount = nodes.reduce((n, node) => n + (node?.saved ? 1 : 0), 0);
  if (savedCount >= 2) return true;
  for (const n of nodes) {
    if (hasAnyLevelWithAtLeastTwoNodes(n.children || [])) return true;
  }
  return false;
}

/** @returns {QuestNodeDraft} */
function createNodeDraft() {
  return {
    ...createEmptyNodeDraft(false),
    key: newDraftKey(),
    subnodesOn: false,
    children: [],
  };
}

function IconGrip() {
  return (
    <svg class="rpg-node-builder__grip-svg" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <g key={row} transform={`translate(0 ${row * 6})`}>
          <circle cx="4" cy="3" r="1.5" fill="currentColor" />
          <circle cx="10" cy="3" r="1.5" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/**
 * @param {{
 *   draft: QuestNodeDraft;
 *   depth: number;
 *   dependencyMode?: boolean;
 *   onChange: (next: QuestNodeDraft) => void;
 *   onRemove?: () => void;
 * }} props
 */
function NodeDraftCard({
  draft,
  depth,
  dependencyMode = false,
  onChange,
  onRemove,
}) {
  const update = (/** @type {Partial<QuestNodeDraft>} */ partial) => onChange({ ...draft, ...partial });

  const save = () => {
    const t = (draft.title || '').trim();
    if (!t) return;
    update({ saved: true });
  };

  const edit = () => update({ saved: false });

  const titlePreview = (draft.title || '').trim() || 'Ohne Titel';

  if (draft.saved) {
    return (
      <div
        class={`rpg-node-card rpg-node-card--collapsed rpg-node-card--depth-${Math.min(depth, 4)}`}
        style={{ '--node-depth': String(depth) }}
      >
        <div class="rpg-node-card__collapsed-main">
          <p class="rpg-node-card__preview-title">{titlePreview}</p>
          <div class="rpg-node-card__badges">
            {draft.isLock ? (
              <span class="rpg-node-card__badge" title="Lock-Node">
                Lock
              </span>
            ) : null}
            {draft.optional ? (
              <span class="rpg-node-card__badge" title="Optional">
                Optional
              </span>
            ) : null}
            {draft.timeLimitOn && (draft.timeDueAt || '').trim() ? (
              <span class="rpg-node-card__badge rpg-node-card__badge--due" title="Frist">
                bis {draft.timeDueAt}
              </span>
            ) : null}
            {draft.rewardOn &&
            (draft.rewardKind === 'item'
              ? (draft.itemId || '').trim()
              : draft.rewardKind === 'points'
                ? (draft.pointsAmount || '').trim()
                : (draft.rewardText || '').trim()) ? (
              <span class="rpg-node-card__badge" title="Mit Belohnung">
                Belohnung
              </span>
            ) : null}
            {draft.subnodesOn && draft.children.length > 0 ? (
              <span class="rpg-node-card__badge">
                {draft.children.length} Child-Node{draft.children.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" class="rpg-node-card__edit-btn" onClick={edit} aria-label="Node bearbeiten" title="Bearbeiten">
          <IconPencil />
        </button>
      </div>
    );
  }

  return (
    <div
      class={`rpg-node-card rpg-node-card--open rpg-node-card--depth-${Math.min(depth, 4)}`}
      style={{ '--node-depth': String(depth) }}
    >
      <div class="rpg-node-card__field">
        <span class="rpg-node-card__field-label">Node-Titel</span>
        <input
          type="text"
          class="rpg-graph-editor__input rpg-node-card__title-input"
          value={draft.title}
          onInput={(ev) => update({ title: ev.currentTarget.value })}
        />
      </div>
      <div class="rpg-node-card__field">
        <span class="rpg-node-card__field-label">Beschreibung</span>
        <textarea
          class="rpg-graph-editor__textarea"
          rows={2}
          value={draft.description || ''}
          placeholder="Optional"
          onInput={(ev) => update({ description: ev.currentTarget.value })}
        />
      </div>

      <label class="rpg-node-card__toggle">
        <input
          type="checkbox"
          checked={draft.rewardOn}
          onChange={(ev) => {
            const on = ev.currentTarget.checked;
            update({
              rewardOn: on,
              ...(on
                ? {}
                : {
                    rewardKind: 'text',
                    rewardText: '',
                    itemId: '',
                    itemDisplayName: '',
                    itemCategory: '',
                    itemDescription: '',
                    pointKind: 'heart',
                    pointsAmount: '',
                  }),
            });
          }}
        />
        <span>Belohnung für diesen Node</span>
      </label>
      {draft.rewardOn ? (
        <div class="rpg-node-card__field rpg-node-card__field--indented rpg-node-card__reward-block">
          <span class="rpg-node-card__field-label">Art</span>
          <div class="rpg-reward-kind-switch" role="group" aria-label="Belohnungsart">
            <button
              type="button"
              class={`rpg-reward-kind-switch__btn${draft.rewardKind === 'text' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
              onClick={() => update({ rewardKind: 'text' })}
            >
              Text
            </button>
            <button
              type="button"
              class={`rpg-reward-kind-switch__btn${draft.rewardKind === 'item' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
              onClick={() => update({ rewardKind: 'item' })}
            >
              Item
            </button>
            <button
              type="button"
              class={`rpg-reward-kind-switch__btn${draft.rewardKind === 'points' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
              onClick={() => update({ rewardKind: 'points' })}
            >
              Punkte
            </button>
          </div>
          {draft.rewardKind === 'text' ? (
            <>
              <span class="rpg-node-card__field-label">Text</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.rewardText}
                placeholder="z. B. Fundstück, kleiner Bonus …"
                onInput={(ev) => update({ rewardText: ev.currentTarget.value })}
              />
            </>
          ) : draft.rewardKind === 'points' ? (
            <>
              <span class="rpg-node-card__field-label">Punktart</span>
              <select
                class="rpg-graph-editor__input"
                value={draft.pointKind === 'mana' ? 'mana' : 'heart'}
                onChange={(ev) =>
                  update({ pointKind: ev.currentTarget.value === 'mana' ? 'mana' : 'heart' })
                }
              >
                <option value="heart">Herz — körperliche Energie</option>
                <option value="mana">Mana — geistige Energie</option>
              </select>
              <span class="rpg-node-card__field-label">Wert</span>
              <input
                type="text"
                inputmode="numeric"
                class="rpg-graph-editor__input"
                value={draft.pointsAmount}
                placeholder="z. B. 3 oder −2"
                title="Ganze Zahl; negativ möglich"
                onInput={(ev) => update({ pointsAmount: ev.currentTarget.value })}
              />
            </>
          ) : (
            <>
              <span class="rpg-node-card__field-label">Item-ID</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.itemId}
                placeholder="technische Id (Katalog)"
                onInput={(ev) => update({ itemId: ev.currentTarget.value })}
              />
              <span class="rpg-node-card__field-label">Anzeigename</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.itemDisplayName}
                placeholder="Name in der Reward-Pill"
                onInput={(ev) => update({ itemDisplayName: ev.currentTarget.value })}
              />
              <span class="rpg-node-card__field-label">Kategorie (Katalog)</span>
              <select
                class="rpg-graph-editor__input"
                value={
                  draft.itemCategory && RPG_ITEM_CATEGORY_IDS.includes(/** @type {any} */ (draft.itemCategory))
                    ? draft.itemCategory
                    : 'sonstiges'
                }
                onChange={(ev) => update({ itemCategory: ev.currentTarget.value })}
              >
                {RPG_ITEM_CATEGORY_IDS.map((cid) => (
                  <option key={cid} value={cid}>
                    {ITEM_CAT_UI[cid] ?? cid}
                  </option>
                ))}
              </select>
              <span class="rpg-node-card__field-label">Kurzbeschreibung (neue Items)</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.itemDescription}
                placeholder="Für den Katalog beim Speichern"
                onInput={(ev) => update({ itemDescription: ev.currentTarget.value })}
              />
            </>
          )}
        </div>
      ) : null}

      <label class="rpg-node-card__toggle">
        <input
          type="checkbox"
          checked={draft.optional}
          onChange={(ev) => update({ optional: ev.currentTarget.checked })}
        />
        <span>Optional — zählt nicht für den Pflicht-Abschluss</span>
      </label>

      <label class="rpg-node-card__toggle">
        <input
          type="checkbox"
          checked={draft.isLock}
          onChange={(ev) => {
            const on = ev.currentTarget.checked;
            update({
              isLock: on,
              optional: on ? false : draft.optional,
            });
          }}
        />
        <span>Lock-Node — sperrt Geschwister bis Lock erfüllt ist</span>
      </label>

      {draft.children.length === 0 ? (
        <>
          <label class="rpg-node-card__toggle">
            <input
              type="checkbox"
              checked={draft.timeLimitOn}
              onChange={(ev) => {
                const on = ev.currentTarget.checked;
                update({
                  timeLimitOn: on,
                  ...(on ? {} : { timeDueAt: '' }),
                });
              }}
            />
            <span>Zeitbegrenzt — Frist (nur bei Pflicht-Leafs relevant für die Quest)</span>
          </label>
          {draft.timeLimitOn ? (
            <div class="rpg-node-card__field rpg-node-card__field--indented">
              <span class="rpg-node-card__field-label">Frist (Datum)</span>
              <input
                type="date"
                class="rpg-graph-editor__input"
                value={(draft.timeDueAt || '').slice(0, 10)}
                onInput={(ev) => update({ timeDueAt: ev.currentTarget.value })}
              />
            </div>
          ) : null}
        </>
      ) : null}
      <div class="rpg-node-card__nest">
        <span class="rpg-node-card__nest-label">Children</span>
        {draft.children.length > 0 ? (
          <DraggableNodeList
            nodes={draft.children}
            depth={depth + 1}
            dependencyMode={dependencyMode}
            onNodesChange={(next) => update({ children: next, subnodesOn: next.length > 0 })}
          />
        ) : (
          <p class="rpg-node-card__order-hint">Keine Children. Dieser Node ist aktuell ein Leaf.</p>
        )}
        <button
          type="button"
          class="rpg-node-builder__add-nested"
          onClick={() =>
            update({
              children: [...draft.children, createNodeDraft()],
              subnodesOn: true,
              timeLimitOn: false,
              timeDueAt: '',
            })
          }
        >
          <IconPlus /> Child-Node hinzufügen
        </button>
      </div>

      <div class="rpg-node-card__actions">
        {onRemove ? (
          <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost rpg-node-card__remove" onClick={onRemove}>
            Entfernen
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
          onClick={save}
          disabled={!(draft.title || '').trim()}
        >
          Node speichern
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   nodes: QuestNodeDraft[];
 *   depth: number;
 *   dependencyMode?: boolean;
 *   onNodesChange: (next: QuestNodeDraft[]) => void;
 * }} props
 */
function DraggableNodeList({
  nodes,
  depth,
  dependencyMode = false,
  onNodesChange,
}) {
  const listRef = useRef(/** @type {HTMLUListElement | null} */ (null));
  const [pendingSourceId, setPendingSourceId] = useState(/** @type {string | null} */ (null));
  const [pointerPos, setPointerPos] = useState(/** @type {{ x: number; y: number } | null} */ (null));
  const [anchorPosByNode, setAnchorPosByNode] = useState(() => /** @type {Record<string, { x: number; y: number }>} */ ({}));

  const edges = useMemo(() => {
    /** @type {{ sourceId: string; targetId: string; idx: number }[]} */
    const out = [];
    for (const target of nodes) {
      const deps = Array.isArray(target.legacyDependsOn) ? target.legacyDependsOn : [];
      let idx = 0;
      for (const sourceId of deps) {
        if (!nodes.some((n) => n.key === sourceId) || sourceId === target.key) continue;
        out.push({ sourceId, targetId: target.key, idx: idx++ });
      }
    }
    return out;
  }, [nodes]);

  useEffect(() => {
    if (!dependencyMode) {
      setPendingSourceId(null);
      setPointerPos(null);
    }
  }, [dependencyMode]);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      /** @type {Record<string, { x: number; y: number }>} */
      const next = {};
      const anchors = root.querySelectorAll('[data-dep-anchor-node]');
      anchors.forEach((el) => {
        const id = String((/** @type {HTMLElement} */ (el)).dataset.depAnchorNode || '').trim();
        if (!id || next[id]) return;
        const r = (/** @type {HTMLElement} */ (el)).getBoundingClientRect();
        next[id] = { x: r.left + r.width * 0.5 - rect.left, y: r.top + r.height * 0.5 - rect.top };
      });
      setAnchorPosByNode(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const t = window.setTimeout(measure, 0);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [nodes, depth, dependencyMode]);

  const removeDependency = (sourceId, targetId) => {
    onNodesChange(
      nodes.map((n) =>
        n.key !== targetId
          ? n
          : { ...n, legacyDependsOn: (n.legacyDependsOn || []).filter((id) => id !== sourceId), orderLinked: false }
      )
    );
  };

  const addDependency = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const tgt = nodes.find((n) => n.key === targetId);
    if (!tgt) return;
    const deps = Array.isArray(tgt.legacyDependsOn) ? [...tgt.legacyDependsOn] : [];
    if (deps.includes(sourceId)) return;
    if (wouldCreateSiblingCycle(nodes, sourceId, targetId)) return;
    deps.push(sourceId);
    onNodesChange(nodes.map((n) => (n.key === targetId ? { ...n, legacyDependsOn: deps, orderLinked: false } : n)));
  };

  const onAnchorClick = (nodeId, existingEdgeTargetId) => {
    if (!dependencyMode) return;
    if (existingEdgeTargetId) {
      removeDependency(nodeId, existingEdgeTargetId);
      if (pendingSourceId === nodeId) setPendingSourceId(null);
      return;
    }
    if (!pendingSourceId) {
      setPendingSourceId(nodeId);
      return;
    }
    if (pendingSourceId === nodeId) {
      setPendingSourceId(null);
      return;
    }
    addDependency(pendingSourceId, nodeId);
    setPendingSourceId(null);
  };

  const onMouseMoveList = (/** @type {MouseEvent} */ e) => {
    if (!dependencyMode || !pendingSourceId || !listRef.current) return;
    const rect = listRef.current.getBoundingClientRect();
    setPointerPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onMouseLeaveList = () => {
    if (!pendingSourceId) return;
    setPointerPos(null);
  };

  const outgoingBySource = new Map();
  for (const e of edges) {
    if (!outgoingBySource.has(e.sourceId)) outgoingBySource.set(e.sourceId, []);
    outgoingBySource.get(e.sourceId).push(e.targetId);
  }

  return (
    <div class={`rpg-node-builder__list-wrap${dependencyMode ? ' rpg-node-builder__list-wrap--dep-mode' : ''}`}>
      <ul
        ref={listRef}
        class={`rpg-node-builder__list${depth > 0 ? ' rpg-node-builder__list--nested' : ''}`}
        onMouseMove={onMouseMoveList}
        onMouseLeave={onMouseLeaveList}
      >
        {nodes.map((node, i) => {
          const canDrag = node.saved;
          const startDrag = (/** @type {DragEvent} */ e) => {
            if (!canDrag) {
              e.preventDefault();
              return;
            }
            const dt = e.dataTransfer;
            if (dt) {
              dt.setData('text/plain', String(i));
              dt.setData('application/x-rpg-node-index', String(i));
              dt.effectAllowed = 'move';
            }
          };
          const readFromIndex = (/** @type {DragEvent} */ e) => {
            const dt = e.dataTransfer;
            if (!dt) return NaN;
            let raw = dt.getData('application/x-rpg-node-index');
            if (!raw) raw = dt.getData('text/plain');
            return Number(raw);
          };
          const outgoingTargets = outgoingBySource.get(node.key) || [];
          return (
            <li
              key={node.key}
              class={`rpg-node-builder__row${canDrag ? ' rpg-node-builder__row--draggable' : ''}`}
              data-dep-node-id={node.key}
              onDragEnter={(e) => {
                e.preventDefault();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = readFromIndex(e);
                if (Number.isNaN(from) || from === i) return;
                onNodesChange(reorderDraftNodes(nodes, from, i));
              }}
            >
              {canDrag ? (
                <span
                  class="rpg-node-builder__drag-handle"
                  title="Zum Sortieren ziehen"
                  draggable
                  onDragStart={(e) => {
                    startDrag(/** @type {DragEvent} */ (e));
                    e.stopPropagation();
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconGrip />
                  {dependencyMode ? (
                    <span class="rpg-node-builder__dep-anchors">
                      {outgoingTargets.map((targetId) => (
                        <button
                          key={`${node.key}->${targetId}`}
                          type="button"
                          class="rpg-node-builder__dep-anchor rpg-node-builder__dep-anchor--used"
                          data-dep-anchor-node={node.key}
                          title="Abhängigkeit lösen"
                          onClick={() => onAnchorClick(node.key, targetId)}
                        />
                      ))}
                      <button
                        type="button"
                        class={`rpg-node-builder__dep-anchor${
                          pendingSourceId === node.key ? ' rpg-node-builder__dep-anchor--active' : ''
                        }`}
                        data-dep-anchor-node={node.key}
                        title="Abhängigkeit starten oder abschließen"
                        onClick={() => onAnchorClick(node.key)}
                      />
                    </span>
                  ) : null}
                </span>
              ) : (
                <span class="rpg-node-builder__drag-placeholder" aria-hidden="true" />
              )}
              <div class="rpg-node-builder__card-wrap">
                <NodeDraftCard
                  draft={node}
                  depth={depth}
                  dependencyMode={dependencyMode}
                  onChange={(next) => {
                    const copy = [...nodes];
                    copy[i] = next;
                    onNodesChange(copy);
                  }}
                  onRemove={() => {
                    const removedId = node.key;
                    const pruned = nodes
                      .filter((_, j) => j !== i)
                      .map((n) => ({
                        ...n,
                        legacyDependsOn: (n.legacyDependsOn || []).filter((dep) => dep !== removedId),
                      }));
                    onNodesChange(pruned);
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {dependencyMode ? (
        <svg class="rpg-node-builder__dep-svg" aria-hidden="true">
          {edges.map((e) => {
            const p1 = anchorPosByNode[e.sourceId];
            const p2 = anchorPosByNode[e.targetId];
            if (!p1 || !p2) return null;
            const mx = p1.x + Math.max(24, Math.abs(p2.y - p1.y) * 0.12);
            const my = (p1.y + p2.y) * 0.5;
            return (
              <path
                key={`${e.sourceId}-${e.targetId}-${e.idx}`}
                d={`M ${p1.x} ${p1.y} L ${mx} ${my} L ${p2.x} ${p2.y}`}
                class="rpg-node-builder__dep-line"
                marker-mid="url(#rpg-node-dep-arrow)"
              />
            );
          })}
          {pendingSourceId && pointerPos && anchorPosByNode[pendingSourceId] ? (
            <path
              d={`M ${anchorPosByNode[pendingSourceId].x} ${anchorPosByNode[pendingSourceId].y} L ${
                anchorPosByNode[pendingSourceId].x + 24
              } ${(anchorPosByNode[pendingSourceId].y + pointerPos.y) * 0.5} L ${pointerPos.x} ${pointerPos.y}`}
              class="rpg-node-builder__dep-line rpg-node-builder__dep-line--pending"
            />
          ) : null}
          <defs>
            <marker
              id="rpg-node-dep-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="3"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L6,3 L0,6 z" class="rpg-node-builder__dep-arrow" />
            </marker>
          </defs>
        </svg>
      ) : null}
    </div>
  );
}

/**
 * @param {{
 *   nodes: QuestNodeDraft[];
 *   onNodesChange: (next: QuestNodeDraft[]) => void;
 *   treePickParentKey?: string | null;
 *   onToggleTreePick?: (parentDraftKey: string) => void;
 * }} props
 */
export function RpgQuestNodesBuilder({
  nodes,
  onNodesChange,
  treePickParentKey = null,
  onToggleTreePick,
}) {
  const [dependencyMode, setDependencyMode] = useState(false);
  const canEditDependencies = useMemo(() => hasAnyLevelWithAtLeastTwoNodes(nodes), [nodes]);

  useEffect(() => {
    if (!canEditDependencies && dependencyMode) setDependencyMode(false);
  }, [canEditDependencies, dependencyMode]);

  return (
    <div class="rpg-node-builder">
      <div class="rpg-node-builder__section-head">
        <span class="rpg-node-builder__section-title">Quest-Nodes</span>
        <p class="rpg-node-builder__section-intro">
          Baue den Baum direkt: Ein Node ohne Children ist automatisch ein Leaf.
        </p>
        {canEditDependencies ? (
          <button
            type="button"
            class={`rpg-node-builder__dep-toggle${dependencyMode ? ' rpg-node-builder__dep-toggle--on' : ''}`}
            onClick={() => setDependencyMode((x) => !x)}
          >
            <IconLink />
            Abhängigkeiten bearbeiten
          </button>
        ) : null}
      </div>
      <DraggableNodeList
        nodes={nodes}
        depth={0}
        dependencyMode={dependencyMode}
        onNodesChange={onNodesChange}
      />
      <div class="rpg-node-builder__add-row">
        <button
          type="button"
          class="rpg-node-builder__add-root"
          onClick={() => onNodesChange([...nodes, createNodeDraft()])}
        >
          <IconPlus />
          +Neue Node
        </button>
        {onToggleTreePick ? (
          <button
            type="button"
            class={`rpg-node-builder__add-root${treePickParentKey ? ' rpg-node-builder__add-nested--active' : ''}`}
            onClick={() => onToggleTreePick('__root__')}
          >
            {treePickParentKey ? 'Fertig' : '+Node aus Tree'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
