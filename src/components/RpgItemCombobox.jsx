/**
 * RpgItemCombobox — Katalog-basierte Item-Auswahl mit Inline-Anlegen.
 *
 * Analog zu RpgAchievementCombobox, aber rein clientseitig:
 * - Sucht im `itemCatalog`-Prop (kein API-Call nötig)
 * - Zeigt Pill wenn Item ausgewählt
 * - "Neu anlegen"-Formular direkt im Dropdown
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { RPG_ITEM_CATEGORY_IDS } from '../lib/rpg-item-categories.js';
import { normalizeQuestId } from '../lib/rpg-quest-form-helpers.js';

/** UI-Label-Map für Kategorien */
const ITEM_CAT_UI = /** @type {Record<string, string>} */ ({
  alltag: 'Alltag',
  studium: 'Studium',
  arbeit: 'Arbeit',
  gesundheit: 'Gesundheit',
  beziehungen: 'Beziehungen',
  organisation: 'Organisation',
  sonstiges: 'Sonstiges',
});

/**
 * Gibt die ersten N Einträge des Katalogs zurück (als Vorschläge bei leerem Query).
 * @param {Record<string, { title?: string; category?: string; description?: string }>} catalog
 * @param {number} max
 * @returns {{ id: string; title: string; category: string; description: string }[]}
 */
function catalogFirstN(catalog, max) {
  return Object.entries(catalog)
    .slice(0, max)
    .map(([id, v]) => ({
      id,
      title: v.title || id,
      category: v.category || 'sonstiges',
      description: v.description || '',
    }));
}

/**
 * Filtert den Katalog nach Query (in ID oder title, case-insensitive).
 * @param {Record<string, { title?: string; category?: string; description?: string }>} catalog
 * @param {string} query
 * @param {number} max
 * @returns {{ id: string; title: string; category: string; description: string }[]}
 */
function filterCatalog(catalog, query, max) {
  const q = query.trim().toLowerCase();
  if (!q) return catalogFirstN(catalog, max);
  return Object.entries(catalog)
    .filter(([id, v]) => id.includes(q) || (v.title || '').toLowerCase().includes(q))
    .slice(0, max)
    .map(([id, v]) => ({
      id,
      title: v.title || id,
      category: v.category || 'sonstiges',
      description: v.description || '',
    }));
}

/**
 * @param {{
 *   itemId: string;
 *   displayName: string;
 *   itemCatalog: Record<string, { title?: string; category?: string; description?: string }>;
 *   onChange: (id: string, displayName: string, category: string, description: string) => void;
 *   disabled?: boolean;
 * }} props
 */
export default function RpgItemCombobox({ itemId, displayName, itemCatalog, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Inline-Formular für neue Items
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newId, setNewId] = useState('');
  const [newCategory, setNewCategory] = useState('sonstiges');
  const [newDescription, setNewDescription] = useState('');
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Abgeleitete Such-Treffer: max 8, live aus itemCatalog gefiltert
  const results = filterCatalog(itemCatalog, query, 8);

  // Kein exakter Treffer → "+ Neu anlegen" anbieten
  const exactMatch = results.some((r) => r.id === query.trim() || r.title.toLowerCase() === query.trim().toLowerCase());
  const showCreate = !exactMatch;

  // Klick außerhalb → Dropdown und Create-Formular schließen
  useEffect(() => {
    if (!open) return;
    function onDown(ev) {
      if (containerRef.current && !containerRef.current.contains(ev.target)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Wenn Titel im Neu-Formular eingegeben wird → ID automatisch ableiten
  function handleNewTitleInput(ev) {
    const val = ev.currentTarget.value;
    setNewTitle(val);
    // ID wird aus dem Titel abgeleitet (normalizeQuestId = URL-freundlich)
    setNewId(normalizeQuestId(val));
  }

  // Item aus Dropdown auswählen
  function handleSelect(id, title, category, description) {
    onChange(id, title, category, description);
    setOpen(false);
    setQuery('');
    setCreating(false);
  }

  // "+ Neu anlegen" anklicken → Inline-Formular zeigen
  function handleStartCreate(ev) {
    ev.preventDefault();
    setCreating(true);
    setNewTitle(query.trim());
    setNewId(normalizeQuestId(query.trim()));
    setNewCategory('sonstiges');
    setNewDescription('');
  }

  // "Anlegen"-Button im Formular
  function handleConfirmCreate(ev) {
    ev.preventDefault();
    const id = newId.trim();
    const title = newTitle.trim();
    if (!id || !title) return;
    onChange(id, title, newCategory, newDescription.trim());
    setOpen(false);
    setQuery('');
    setCreating(false);
  }

  // "Abbrechen" im Formular
  function handleCancelCreate() {
    setCreating(false);
  }

  // Pill-Ansicht wenn Item bereits ausgewählt
  if (itemId) {
    return (
      <div class="rpg-item-combobox rpg-item-combobox--selected">
        <span class="rpg-item-combobox__pill" title={itemId}>
          📦 {displayName || itemId}
        </span>
        {!disabled && (
          <button
            type="button"
            class="rpg-item-combobox__clear"
            aria-label="Item entfernen"
            onClick={() => onChange('', '', '', '')}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} class="rpg-item-combobox">
      {/* Suchinput */}
      <input
        type="text"
        class="rpg-graph-editor__input rpg-item-combobox__input"
        value={query}
        placeholder="Item suchen oder neu anlegen …"
        onInput={(ev) => {
          setQuery(ev.currentTarget.value);
          setOpen(true);
          setCreating(false);
        }}
        onFocus={() => setOpen(true)}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
      />

      {open && (
        <ul class="rpg-item-combobox__dropdown" role="listbox">
          {/* Gefilterte Katalog-Treffer */}
          {results.map((r) => (
            <li
              key={r.id}
              class="rpg-item-combobox__option"
              role="option"
              onPointerDown={(ev) => {
                ev.preventDefault(); // blur vor click verhindern
                handleSelect(r.id, r.title, r.category, r.description);
              }}
            >
              📦 {r.title}
              {r.title !== r.id && (
                <span class="rpg-item-combobox__state"> ({r.id})</span>
              )}
            </li>
          ))}

          {/* "Neu anlegen"-Eintrag — zeigt Inline-Formular */}
          {showCreate && !creating && (
            <li
              class="rpg-item-combobox__option rpg-item-combobox__option--create"
              role="option"
              onPointerDown={handleStartCreate}
            >
              {query.trim() ? `+ „${query.trim()}" neu anlegen` : '+ Neues Item anlegen'}
            </li>
          )}

          {/* Inline-Formular für neue Items */}
          {creating && (
            <li class="rpg-item-combobox__create-form">
              <div class="rpg-item-combobox__create-row">
                {/* Titel-Input (Pflichtfeld) */}
                <input
                  type="text"
                  class="rpg-graph-editor__input"
                  value={newTitle}
                  placeholder="Titel *"
                  onInput={handleNewTitleInput}
                  required
                />
              </div>
              <div class="rpg-item-combobox__create-row">
                {/* ID abgeleitet aus Titel, aber editierbar */}
                <input
                  type="text"
                  class="rpg-graph-editor__input"
                  value={newId}
                  placeholder="ID"
                  onInput={(ev) => setNewId(ev.currentTarget.value)}
                />
              </div>
              <div class="rpg-item-combobox__create-row">
                {/* Kategorie-Auswahl */}
                <select
                  class="rpg-graph-editor__input"
                  value={newCategory}
                  onChange={(ev) => setNewCategory(ev.currentTarget.value)}
                >
                  {RPG_ITEM_CATEGORY_IDS.map((cid) => (
                    <option key={cid} value={cid}>
                      {ITEM_CAT_UI[cid] ?? cid}
                    </option>
                  ))}
                </select>
              </div>
              <div class="rpg-item-combobox__create-row">
                {/* Beschreibung (optional) */}
                <input
                  type="text"
                  class="rpg-graph-editor__input"
                  value={newDescription}
                  placeholder="Beschreibung (optional)"
                  onInput={(ev) => setNewDescription(ev.currentTarget.value)}
                />
              </div>
              <div class="rpg-item-combobox__create-actions">
                <button
                  type="button"
                  class="rpg-graph-editor__btn rpg-graph-editor__btn--primary"
                  onClick={handleConfirmCreate}
                  disabled={!newTitle.trim() || !newId.trim()}
                >
                  Anlegen
                </button>
                <button
                  type="button"
                  class="rpg-graph-editor__btn rpg-graph-editor__btn--ghost"
                  onClick={handleCancelCreate}
                >
                  Abbrechen
                </button>
              </div>
            </li>
          )}

          {/* Leer-Zustand wenn Katalog leer und kein Create-Formular */}
          {results.length === 0 && !creating && (
            <li class="rpg-item-combobox__state">
              {query ? 'Keine Treffer' : 'Noch keine Items im Katalog'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
