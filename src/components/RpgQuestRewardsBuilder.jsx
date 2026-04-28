/**
 * RpgQuestRewardsBuilder — Editor-Formular fuer Quest-Belohnungen.
 *
 * Extrahiert aus RpgQuestNodesBuilder.jsx, um die Anti-Monolith-Regel
 * (max ~800-1000 LOC) einzuhalten. Rein praesentation + lokale State-Updates
 * auf den uebergebenen rows-Array.
 */
import { createEmptyRewardRow } from '../lib/rpg-quest-editor-draft.js';
import { RPG_ITEM_CATEGORY_IDS } from '../lib/rpg-item-categories.js';

/** @typedef {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow} QuestRewardDraftRow */

/** UI-Labels fuer Item-Kategorien */
const ITEM_CAT_UI = /** @type {Record<string, string>} */ ({
  alltag: 'Alltag',
  studium: 'Studium',
  arbeit: 'Arbeit',
  gesundheit: 'Gesundheit',
  beziehungen: 'Beziehungen',
  organisation: 'Organisation',
  sonstiges: 'Sonstiges',
});

function IconPlus() {
  return (
    <span class="rpg-node-builder__plus" aria-hidden="true">
      +
    </span>
  );
}

/**
 * Formular-Block fuer Quest-Belohnungen (Text, Item, Punkte).
 * Jede Zeile hat Kind-Wechsel, typ-spezifische Felder, Unlock-Schwelle und Loeschen-Button.
 *
 * @param {{
 *   rows: QuestRewardDraftRow[];
 *   onRowsChange: (next: QuestRewardDraftRow[]) => void;
 * }} props
 */
export default function RpgQuestRewardsBuilder({ rows, onRowsChange }) {
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
              {/* Kind-Umschalter: Text / Item / Punkte */}
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

              {/* Typ-spezifische Felder */}
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

              {/* Unlock-Schwelle */}
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
