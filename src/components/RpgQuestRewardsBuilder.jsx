/**
 * RpgQuestRewardsBuilder — Editor-Formular fuer Quest-Belohnungen.
 *
 * Extrahiert aus RpgQuestNodesBuilder.jsx, um die Anti-Monolith-Regel
 * (max ~800-1000 LOC) einzuhalten. Rein praesentation + lokale State-Updates
 * auf den uebergebenen rows-Array.
 */
import { createEmptyRewardRow } from '../lib/rpg-quest-editor-draft.js';
import RpgAchievementCombobox from './RpgAchievementCombobox.jsx';
import RpgItemCombobox from './RpgItemCombobox.jsx';

/** @typedef {import('../lib/rpg-quest-editor-draft.js').QuestRewardDraftRow} QuestRewardDraftRow */


function IconPlus() {
  return (
    <span class="rpg-node-builder__plus" aria-hidden="true">
      +
    </span>
  );
}

/**
 * Formular-Block fuer Quest-Belohnungen (Text, Item, Punkte, Achievement).
 * Jede Zeile hat Kind-Wechsel, typ-spezifische Felder und einen Loeschen-Button.
 *
 * @param {{
 *   rows: QuestRewardDraftRow[];
 *   onRowsChange: (next: QuestRewardDraftRow[]) => void;
 *   itemCatalog?: Record<string, { title?: string; category?: string; description?: string }>;
 * }} props
 */
export default function RpgQuestRewardsBuilder({ rows, onRowsChange, itemCatalog = {} }) {
  return (
    <div class="rpg-reward-builder">
      <div class="rpg-node-builder__section-head">
        <span class="rpg-node-builder__section-title">Belohnungen der Quest</span>
        <p class="rpg-node-builder__section-intro">
          Optional. Belohnungen auf Quest-Ebene werden nach Abschluss der gesamten Quest freigeschaltet.
          Belohnungen auf Schritt-Ebene werden nach Erledigung des jeweiligen Schritts freigeschaltet.
        </p>
      </div>
      {rows.length === 0 ? (
        <p class="rpg-reward-builder__empty">Noch keine Quest-Belohnungen. Unten kannst du eine hinzufügen.</p>
      ) : (
        <ul class="rpg-reward-builder__list">
          {rows.map((row, i) => (
            <li key={row.key} class="rpg-reward-builder__row">
              {/* Kind-Umschalter: Text / Item / Achievement / Punkte */}
              <div class="rpg-reward-builder__kind">
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'text' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'text' };
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
                    copy[i] = { ...row, kind: 'item' };
                    onRowsChange(copy);
                  }}
                >
                  Item
                </button>
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'achievement' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'achievement' };
                    onRowsChange(copy);
                  }}
                >
                  Achievement
                </button>
                <button
                  type="button"
                  class={`rpg-reward-kind-switch__btn${row.kind === 'points' ? ' rpg-reward-kind-switch__btn--on' : ''}`}
                  onClick={() => {
                    const copy = [...rows];
                    copy[i] = { ...row, kind: 'points' };
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
              ) : row.kind === 'achievement' ? (
                <RpgAchievementCombobox
                  achievementId={row.achievementId}
                  achievementTitle={row.achievementTitle}
                  onChange={(id, title) => {
                    const copy = [...rows];
                    copy[i] = { ...row, achievementId: id, achievementTitle: title };
                    onRowsChange(copy);
                  }}
                />
              ) : row.kind === 'points' ? (
                /* Punkte-Felder: Typ (Herz/Mana) + Wert nebeneinander */
                <div class="rpg-reward-builder__points-fields">
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
                /* Item-Auswahl via Combobox (sucht im itemCatalog) */
                <RpgItemCombobox
                  itemId={row.itemId}
                  displayName={row.displayName}
                  itemCatalog={itemCatalog}
                  onChange={(id, displayName, category, description) => {
                    const copy = [...rows];
                    copy[i] = { ...row, itemId: id, displayName, itemCategory: category, itemDescription: description };
                    onRowsChange(copy);
                  }}
                />
              )}

              {/* × nur zeigen wenn kein Combobox-Selection aktiv — sonst zwei × nebeneinander */}
              {!(row.kind === 'achievement' && row.achievementId) && !(row.kind === 'item' && row.itemId) && (
                <button
                  type="button"
                  class="rpg-reward-builder__del"
                  aria-label="Belohnung entfernen"
                  title="Entfernen"
                  onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
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
