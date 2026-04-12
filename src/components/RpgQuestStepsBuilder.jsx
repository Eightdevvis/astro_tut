import {
  createEmptyStepDraft,
  newDraftKey,
  createEmptyRewardRow,
  reorderDraftSteps,
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
 * @typedef {import('../lib/rpg-quest-editor-draft.js').QuestStepDraft} QuestStepDraft
 * @typedef {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow} QuestRewardDraftRow
 */

function IconPencil() {
  return (
    <svg class="rpg-step-card__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <span class="rpg-step-builder__plus" aria-hidden="true">
      +
    </span>
  );
}

function IconGrip() {
  return (
    <svg class="rpg-step-builder__grip-svg" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
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
 *   draft: QuestStepDraft;
 *   depth: number;
 *   onChange: (next: QuestStepDraft) => void;
 *   onRemove?: () => void;
 * }} props
 */
function StepDraftCard({ draft, depth, onChange, onRemove }) {
  const update = (/** @type {Partial<QuestStepDraft>} */ partial) => onChange({ ...draft, ...partial });

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
        class={`rpg-step-card rpg-step-card--collapsed rpg-step-card--depth-${Math.min(depth, 4)}`}
        style={{ '--step-depth': String(depth) }}
      >
        <div class="rpg-step-card__collapsed-main">
          <p class="rpg-step-card__preview-title">{titlePreview}</p>
          <div class="rpg-step-card__badges">
            {draft.orderLinked ? (
              <span class="rpg-step-card__badge" title="In der Reihenfolge verknüpft">
                Reihenfolge
              </span>
            ) : null}
            {draft.optional ? (
              <span class="rpg-step-card__badge" title="Optional">
                Optional
              </span>
            ) : null}
            {draft.timeLimitOn && (draft.timeDueAt || '').trim() ? (
              <span class="rpg-step-card__badge rpg-step-card__badge--due" title="Frist">
                bis {draft.timeDueAt}
              </span>
            ) : null}
            {draft.rewardOn &&
            (draft.rewardKind === 'item'
              ? (draft.itemId || '').trim()
              : (draft.rewardText || '').trim()) ? (
              <span class="rpg-step-card__badge" title="Mit Belohnung">
                Belohnung
              </span>
            ) : null}
            {draft.substepsOn && draft.children.length > 0 ? (
              <span class="rpg-step-card__badge">
                {draft.children.length} Unterschritt{draft.children.length === 1 ? '' : 'e'}
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" class="rpg-step-card__edit-btn" onClick={edit} aria-label="Schritt bearbeiten" title="Bearbeiten">
          <IconPencil />
        </button>
      </div>
    );
  }

  return (
    <div
      class={`rpg-step-card rpg-step-card--open rpg-step-card--depth-${Math.min(depth, 4)}`}
      style={{ '--step-depth': String(depth) }}
    >
      <div class="rpg-step-card__field">
        <span class="rpg-step-card__field-label">Titel des Schritts</span>
        <input
          type="text"
          class="rpg-graph-editor__input"
          value={draft.title}
          placeholder="Kurz beschreiben, was zu tun ist …"
          onInput={(ev) => update({ title: ev.currentTarget.value })}
        />
      </div>

      <div class="rpg-step-card__order-block">
        <span class="rpg-step-card__field-label">Reihenfolge (gleiche Ebene)</span>
        <div class="rpg-step-order-switch" role="group" aria-label="Abhängigkeit in der Reihenfolge">
          <button
            type="button"
            class={`rpg-step-order-switch__btn${!draft.orderLinked ? ' rpg-step-order-switch__btn--on' : ''}`}
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
            class={`rpg-step-order-switch__btn${draft.orderLinked ? ' rpg-step-order-switch__btn--on' : ''}`}
            onClick={() => update({ orderLinked: true, legacyDependsOn: undefined })}
          >
            Abhängig
          </button>
        </div>
        <p class="rpg-step-card__order-hint">
          Abhängig: kann erst erledigt werden, wenn der vorherige <strong>abhängige</strong> Schritt in dieser Liste fertig ist. Die Reihenfolge
          der gespeicherten Schritte änderst du per Ziehen am Griff.
        </p>
      </div>

      <label class="rpg-step-card__toggle">
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
                  }),
            });
          }}
        />
        <span>Belohnung für diesen Schritt</span>
      </label>
      {draft.rewardOn ? (
        <div class="rpg-step-card__field rpg-step-card__field--indented rpg-step-card__reward-block">
          <span class="rpg-step-card__field-label">Art</span>
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
          </div>
          {draft.rewardKind === 'text' ? (
            <>
              <span class="rpg-step-card__field-label">Text</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.rewardText}
                placeholder="z. B. Fundstück, kleiner Bonus …"
                onInput={(ev) => update({ rewardText: ev.currentTarget.value })}
              />
            </>
          ) : (
            <>
              <span class="rpg-step-card__field-label">Item-ID</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.itemId}
                placeholder="technische Id (Katalog)"
                onInput={(ev) => update({ itemId: ev.currentTarget.value })}
              />
              <span class="rpg-step-card__field-label">Anzeigename</span>
              <input
                type="text"
                class="rpg-graph-editor__input"
                value={draft.itemDisplayName}
                placeholder="Name in der Reward-Pill"
                onInput={(ev) => update({ itemDisplayName: ev.currentTarget.value })}
              />
              <span class="rpg-step-card__field-label">Kategorie (Katalog)</span>
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
              <span class="rpg-step-card__field-label">Kurzbeschreibung (neue Items)</span>
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

      <label class="rpg-step-card__toggle">
        <input
          type="checkbox"
          checked={draft.optional}
          onChange={(ev) => update({ optional: ev.currentTarget.checked })}
        />
        <span>Optional — zählt nicht für den Pflicht-Abschluss</span>
      </label>

      {!draft.substepsOn ? (
        <>
          <label class="rpg-step-card__toggle">
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
            <span>Zeitbegrenzt — Frist (nur bei Pflichtschritten relevant für die Quest)</span>
          </label>
          {draft.timeLimitOn ? (
            <div class="rpg-step-card__field rpg-step-card__field--indented">
              <span class="rpg-step-card__field-label">Frist (Datum)</span>
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

      <label class="rpg-step-card__toggle">
        <input
          type="checkbox"
          checked={draft.substepsOn}
          onChange={(ev) => {
            const on = ev.currentTarget.checked;
            update({
              substepsOn: on,
              children: on && draft.children.length === 0 ? [] : draft.children,
              ...(on ? { timeLimitOn: false, timeDueAt: '' } : {}),
            });
          }}
        />
        <span>Unterschritte — mehrere kleine Teilschritte unter diesem Titel</span>
      </label>

      {draft.substepsOn ? (
        <div class="rpg-step-card__nest">
          <span class="rpg-step-card__nest-label">Unterschritte</span>
          <DraggableStepList
            steps={draft.children}
            depth={depth + 1}
            onStepsChange={(next) => update({ children: next })}
          />
          <button
            type="button"
            class="rpg-step-builder__add-nested"
            onClick={() =>
              update({
                children: [...draft.children, createEmptyStepDraft(false)],
              })
            }
          >
            <IconPlus /> Unterschritt hinzufügen
          </button>
        </div>
      ) : null}

      <div class="rpg-step-card__actions">
        {onRemove ? (
          <button type="button" class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost rpg-step-card__remove" onClick={onRemove}>
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
          Schritt speichern
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   steps: QuestStepDraft[];
 *   depth: number;
 *   onStepsChange: (next: QuestStepDraft[]) => void;
 * }} props
 */
function DraggableStepList({ steps, depth, onStepsChange }) {
  return (
    <ul class={`rpg-step-builder__list${depth > 0 ? ' rpg-step-builder__list--nested' : ''}`}>
      {steps.map((step, i) => {
        const canDrag = step.saved;
        const startDrag = (/** @type {DragEvent} */ e) => {
          if (!canDrag) {
            e.preventDefault();
            return;
          }
          const dt = e.dataTransfer;
          if (dt) {
            dt.setData('text/plain', String(i));
            dt.setData('application/x-rpg-step-index', String(i));
            dt.effectAllowed = 'move';
          }
        };
        const readFromIndex = (/** @type {DragEvent} */ e) => {
          const dt = e.dataTransfer;
          if (!dt) return NaN;
          let raw = dt.getData('application/x-rpg-step-index');
          if (!raw) raw = dt.getData('text/plain');
          return Number(raw);
        };
        return (
          <li
            key={step.key}
            class={`rpg-step-builder__row${canDrag ? ' rpg-step-builder__row--draggable' : ''}`}
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
              onStepsChange(reorderDraftSteps(steps, from, i));
            }}
          >
            {canDrag ? (
              <span
                class="rpg-step-builder__drag-handle"
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
              <span class="rpg-step-builder__drag-placeholder" aria-hidden="true" />
            )}
            <div class="rpg-step-builder__card-wrap">
              <StepDraftCard
                draft={step}
                depth={depth}
                onChange={(next) => {
                  const copy = [...steps];
                  copy[i] = next;
                  onStepsChange(copy);
                }}
                onRemove={() => onStepsChange(steps.filter((_, j) => j !== i))}
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
 *   steps: QuestStepDraft[];
 *   onStepsChange: (next: QuestStepDraft[]) => void;
 * }} props
 */
export function RpgQuestStepsBuilder({ steps, onStepsChange }) {
  return (
    <div class="rpg-step-builder">
      <div class="rpg-step-builder__section-head">
        <span class="rpg-step-builder__section-title">Schritte</span>
        <p class="rpg-step-builder__section-intro">
          Schritte anlegen, speichern, dann per Griff sortieren. „Abhängig“ verknüpft mit dem vorherigen abhängigen Schritt in derselben Liste.
        </p>
      </div>
      <DraggableStepList steps={steps} depth={0} onStepsChange={onStepsChange} />
      <button
        type="button"
        class="rpg-step-builder__add-root"
        onClick={() => onStepsChange([...steps, { ...createEmptyStepDraft(false), key: newDraftKey() }])}
      >
        <IconPlus />
        Schritt hinzufügen
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
      <div class="rpg-step-builder__section-head">
        <span class="rpg-step-builder__section-title">Belohnungen der Quest</span>
        <p class="rpg-step-builder__section-intro">
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
        class="rpg-step-builder__add-root rpg-reward-builder__add"
        onClick={() => onRowsChange([...rows, createEmptyRewardRow()])}
      >
        <IconPlus />
        Belohnung hinzufügen
      </button>
    </div>
  );
}
