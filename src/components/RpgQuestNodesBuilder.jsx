import {
  createEmptyNodeDraft,
  newDraftKey,
  createEmptyRewardRow,
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
 * @typedef {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow} QuestRewardDraftRow
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

function IconLock() {
  return <span class="rpg-node-builder__plus" aria-hidden="true">🔒</span>;
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
 *   onChange: (next: QuestNodeDraft) => void;
 *   onRemove?: () => void;
 * }} props
 */
function NodeDraftCard({ draft, depth, onChange, onRemove }) {
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
            {draft.orderLinked ? (
              <span class="rpg-node-card__badge" title="In der Reihenfolge verknüpft">
                Reihenfolge
              </span>
            ) : null}
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
          class="rpg-graph-editor__input"
          value={draft.title}
          placeholder="Kurz beschreiben, was zu tun ist …"
          onInput={(ev) => update({ title: ev.currentTarget.value })}
        />
      </div>

      <div class="rpg-node-card__order-block">
        <span class="rpg-node-card__field-label">Reihenfolge (gleiche Ebene)</span>
        <div class="rpg-node-order-switch" role="group" aria-label="Abhängigkeit in der Reihenfolge">
          <button
            type="button"
            class={`rpg-node-order-switch__btn${!draft.orderLinked ? ' rpg-node-order-switch__btn--on' : ''}`}
            onClick={() =>
              update({
                orderLinked: false,
                ...(draft.orderLinked ? { legacyDependsOn: undefined } : {}),
              })
            }
          >
            Unabhängig
          </button>
          <button
            type="button"
            class={`rpg-node-order-switch__btn${draft.orderLinked ? ' rpg-node-order-switch__btn--on' : ''}`}
            onClick={() => update({ orderLinked: true, legacyDependsOn: undefined })}
          >
            Abhängig
          </button>
        </div>
        <p class="rpg-node-card__order-hint">
          Abhängig: kann erst erledigt werden, wenn der vorherige <strong>abhängige</strong> Node in dieser Liste fertig ist. Die Reihenfolge
          der gespeicherten Nodes änderst du per Ziehen am Griff.
        </p>
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
        <button
          type="button"
          class="rpg-node-builder__add-nested"
          onClick={() =>
            update({
              children: [...draft.children, { ...createNodeDraft(), isLock: true, optional: false }],
              subnodesOn: true,
              timeLimitOn: false,
              timeDueAt: '',
            })
          }
        >
          <IconLock /> Lock-Node hinzufügen
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
 *   onNodesChange: (next: QuestNodeDraft[]) => void;
 * }} props
 */
function DraggableNodeList({ nodes, depth, onNodesChange }) {
  return (
    <ul class={`rpg-node-builder__list${depth > 0 ? ' rpg-node-builder__list--nested' : ''}`}>
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
        return (
          <li
            key={node.key}
            class={`rpg-node-builder__row${canDrag ? ' rpg-node-builder__row--draggable' : ''}`}
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
              </span>
            ) : (
              <span class="rpg-node-builder__drag-placeholder" aria-hidden="true" />
            )}
            <div class="rpg-node-builder__card-wrap">
              <NodeDraftCard
                draft={node}
                depth={depth}
                onChange={(next) => {
                  const copy = [...nodes];
                  copy[i] = next;
                  onNodesChange(copy);
                }}
                onRemove={() => onNodesChange(nodes.filter((_, j) => j !== i))}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param {{
 *   nodes: QuestNodeDraft[];
 *   onNodesChange: (next: QuestNodeDraft[]) => void;
 * }} props
 */
export function RpgQuestNodesBuilder({ nodes, onNodesChange }) {
  return (
    <div class="rpg-node-builder">
      <div class="rpg-node-builder__section-head">
        <span class="rpg-node-builder__section-title">Quest-Nodes</span>
        <p class="rpg-node-builder__section-intro">
          Baue den Baum direkt: Ein Node ohne Children ist automatisch ein Leaf. „Abhängig“ verknüpft mit dem vorherigen abhängigen Node in derselben Liste.
        </p>
      </div>
      <DraggableNodeList nodes={nodes} depth={0} onNodesChange={onNodesChange} />
      <button
        type="button"
        class="rpg-node-builder__add-root"
        onClick={() => onNodesChange([...nodes, createNodeDraft()])}
      >
        <IconPlus />
        Node hinzufügen
      </button>
      <button
        type="button"
        class="rpg-node-builder__add-root"
        onClick={() => onNodesChange([...nodes, { ...createNodeDraft(), isLock: true, optional: false }])}
      >
        <IconLock />
        Lock-Node hinzufügen
      </button>
    </div>
  );
}

/**
 * @param {{
 *   rows: QuestRewardDraftRow[];
 *   onRowsChange: (next: QuestRewardDraftRow[]) => void;
 * }} props
 */
export function RpgQuestRewardsBuilder({ rows, onRowsChange }) {
  return (
    <div class="rpg-reward-builder">
      <div class="rpg-node-builder__section-head">
        <span class="rpg-node-builder__section-title">Belohnungen der Quest</span>
        <p class="rpg-node-builder__section-intro">
          Optional. Pro Zeile kannst du ein Freischalt‑Prozent (0–100) setzen; leer = automatische Verteilung (fest pro Quest-ID
          pseudo‑zufällig gemischt). Fortschritt zählt inkl. Vorgänger- und Folgequests im Baum.
        </p>
      </div>
      {rows.length === 0 ? (
        <p class="rpg-reward-builder__empty">Noch keine Quest-Belohnungen. Unten kannst du eine hinzufügen.</p>
      ) : (
        <ul class="rpg-reward-builder__list">
          {rows.map((row, i) => (
            <li key={row.key} class="rpg-reward-builder__row">
              <div class="rpg-reward-builder__kind">
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'text' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'text', unlockAtPercent: row.unlockAtPercent ?? '' };
                    onRowsChange(copy);
                  }}
                >
                  Text
                </button>
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'item' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'item', unlockAtPercent: row.unlockAtPercent ?? '' };
                    onRowsChange(copy);
                  }}
                >
                  Item
                </button>
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'points' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'points', unlockAtPercent: row.unlockAtPercent ?? '' };
                    onRowsChange(copy);
                  }}
                >
                  Punkte
                </button>
              </div>
              {row.kind === 'text' ? (
                <input
                  type="text"
                  class="rpg-graph-editor__input rpg-reward-builder__text"
                  value={row.text}
                  placeholder="Kurzbeschreibung der Belohnung"
                  onInput={(ev) => {
                    const copy = [...rows];
                    copy[i] = { ...row, text: ev.currentTarget.value };
                    onRowsChange(copy);
                  }}
                />
              ) : row.kind === 'points' ? (
                <div class="rpg-reward-builder__item-fields">
                  <select
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={row.pointKind === 'mana' ? 'mana' : 'heart'}
                    onChange={(ev) => {
                      const copy = [...rows];
                      copy[i] = {
                        ...row,
                        pointKind: ev.currentTarget.value === 'mana' ? 'mana' : 'heart',
                      };
                      onRowsChange(copy);
                    }}
                  >
                    <option value="heart">Herz (körperlich)</option>
                    <option value="mana">Mana (geistig)</option>
                  </select>
                  <input
                    type="text"
                    inputmode="numeric"
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={row.pointsAmount ?? ''}
                    placeholder="Wert (z. B. 3 oder −2)"
                    title="Ganze Zahl"
                    onInput={(ev) => {
                      const copy = [...rows];
                      copy[i] = { ...row, pointsAmount: ev.currentTarget.value };
                      onRowsChange(copy);
                    }}
                  />
                </div>
              ) : (
                <div class="rpg-reward-builder__item-fields">
                  <input
                    type="text"
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={row.itemId}
                    placeholder="Item-ID"
                    onInput={(ev) => {
                      const copy = [...rows];
                      copy[i] = { ...row, itemId: ev.currentTarget.value };
                      onRowsChange(copy);
                    }}
                  />
                  <input
                    type="text"
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={row.displayName}
                    placeholder="Anzeigename"
                    onInput={(ev) => {
                      const copy = [...rows];
                      copy[i] = { ...row, displayName: ev.currentTarget.value };
                      onRowsChange(copy);
                    }}
                  />
                  <select
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={
                      row.itemCategory && RPG_ITEM_CATEGORY_IDS.includes(/** @type {any} */ (row.itemCategory))
                        ? row.itemCategory
                        : 'sonstiges'
                    }
                    onChange={(ev) => {
                      const copy = [...rows];
                      copy[i] = { ...row, itemCategory: ev.currentTarget.value };
                      onRowsChange(copy);
                    }}
                  >
                    {RPG_ITEM_CATEGORY_IDS.map((cid) => (
                      <option key={cid} value={cid}>
                        {ITEM_CAT_UI[cid] ?? cid}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    class="rpg-graph-editor__input rpg-reward-builder__text"
                    value={row.itemDescription}
                    placeholder="Kurzbeschreibung (neue Items)"
                    onInput={(ev) => {
                      const copy = [...rows];
                      copy[i] = { ...row, itemDescription: ev.currentTarget.value };
                      onRowsChange(copy);
                    }}
                  />
                </div>
              )}
              <div class="rpg-reward-builder__unlock-field">
                <span class="rpg-reward-builder__unlock-label" title="Quest-Fortschritt inkl. Subgraph im Baum">
                  Ab %
                </span>
                <input
                  type="text"
                  inputmode="numeric"
                  class="rpg-graph-editor__input rpg-reward-builder__unlock-input"
                  value={row.unlockAtPercent ?? ''}
                  placeholder="auto"
                  maxLength={3}
                  aria-label="Freischaltung ab Quest-Prozent, leer für automatisch"
                  onInput={(ev) => {
                    const copy = [...rows];
                    copy[i] = { ...row, unlockAtPercent: ev.currentTarget.value };
                    onRowsChange(copy);
                  }}
                />
              </div>
              <button
                type="button"
                class="rpg-reward-builder__del"
                aria-label="Belohnung entfernen"
                title="Entfernen"
                onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        class="rpg-node-builder__add-root rpg-reward-builder__add"
        onClick={() => onRowsChange([...rows, createEmptyRewardRow()])}
      >
        <IconPlus />
        Belohnung hinzufügen
      </button>
    </div>
  );
}
