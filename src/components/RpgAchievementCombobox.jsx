/**
 * RpgAchievementCombobox — Live-Suchfeld für Achievement-Katalog.
 *
 * Tipp-Verhalten: sofortiges clientseitiges Debounce → Fetch /api/rpg/achievements?q=...
 * Dropdown zeigt Treffer + "neu anlegen"-Option.
 * Sobald ein Achievement ausgewählt wurde, wird es als Pill angezeigt (mit ×-Button).
 */

import { useState, useRef, useEffect } from 'preact/hooks';

/**
 * @param {{
 *   achievementId: string;
 *   achievementTitle: string;
 *   onChange: (id: string, title: string) => void;
 *   disabled?: boolean;
 * }} props
 */
export default function RpgAchievementCombobox({ achievementId, achievementTitle, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(/** @type {{ id: string; title: string }[]} */ ([]));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const debounceRef = useRef(/** @type {number | null} */ (null));
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  // Klick außerhalb → Dropdown schließen
  useEffect(() => {
    if (!open) return;
    function onDown(ev) {
      if (containerRef.current && !containerRef.current.contains(ev.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Fetch-Debounce beim Tippen
  function handleInput(ev) {
    const val = ev.currentTarget.value;
    setQuery(val);
    setCreateError('');
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/rpg/achievements?q=${encodeURIComponent(val.trim())}&limit=8`,
          { credentials: 'same-origin' }
        );
        const data = await res.json();
        setResults(Array.isArray(data.achievements) ? data.achievements : []);
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 220);
  }

  // Achievement aus Dropdown auswählen
  function handleSelect(id, title) {
    onChange(id, title);
    setOpen(false);
    setQuery('');
    setResults([]);
  }

  // Neues Achievement anlegen
  async function handleCreate() {
    const title = query.trim();
    if (!title) return;
    setBusy(true);
    setCreateError('');
    try {
      const res = await fetch('/api/rpg/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (data.achievement) {
        handleSelect(data.achievement.id, data.achievement.title);
      } else {
        setCreateError(data.error || 'Fehler beim Anlegen');
      }
    } catch {
      setCreateError('Netzwerkfehler');
    } finally {
      setBusy(false);
    }
  }

  // Ausgewähltes Achievement als Pill anzeigen
  if (achievementId) {
    return (
      <div class="rpg-achievement-combobox rpg-achievement-combobox--selected">
        <span class="rpg-achievement-combobox__pill">
          🏆 {achievementTitle || achievementId}
        </span>
        {!disabled && (
          <button
            type="button"
            class="rpg-achievement-combobox__clear"
            aria-label="Achievement entfernen"
            onClick={() => onChange('', '')}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // Kein exakter Treffer → "anlegen"-Option zeigen
  const exactMatch = results.some(
    (r) => r.title.toLowerCase() === query.toLowerCase()
  );
  const showCreate = query.trim() && !exactMatch;
  const showEmpty = !busy && results.length === 0 && !showCreate;

  return (
    <div ref={containerRef} class="rpg-achievement-combobox">
      <input
        type="text"
        class="rpg-graph-editor__input rpg-achievement-combobox__input"
        value={query}
        placeholder="Achievement suchen oder neu anlegen …"
        onInput={handleInput}
        onFocus={() => {
          setOpen(true);
          // Beim ersten Fokus ohne Query: Vorschläge laden
          if (!query && results.length === 0) {
            setBusy(true);
            fetch('/api/rpg/achievements?limit=8', { credentials: 'same-origin' })
              .then((r) => r.json())
              .then((d) => setResults(Array.isArray(d.achievements) ? d.achievements : []))
              .catch(() => {})
              .finally(() => setBusy(false));
          }
        }}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
      />
      {open && (
        <ul class="rpg-achievement-combobox__dropdown" role="listbox">
          {busy && (
            <li class="rpg-achievement-combobox__state">…</li>
          )}
          {!busy && results.map((r) => (
            <li
              key={r.id}
              class="rpg-achievement-combobox__option"
              role="option"
              onPointerDown={(ev) => { ev.preventDefault(); handleSelect(r.id, r.title); }}
            >
              🏆 {r.title}
            </li>
          ))}
          {!busy && showCreate && (
            <li
              class="rpg-achievement-combobox__option rpg-achievement-combobox__option--create"
              role="option"
              onPointerDown={(ev) => { ev.preventDefault(); handleCreate(); }}
            >
              + „{query.trim()}" neu anlegen
            </li>
          )}
          {!busy && showEmpty && (
            <li class="rpg-achievement-combobox__state">
              {query ? 'Keine Treffer' : 'Noch keine Achievements'}
            </li>
          )}
          {createError && (
            <li class="rpg-achievement-combobox__state rpg-achievement-combobox__state--error">
              {createError}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
