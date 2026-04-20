import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from '../lib/rpg-location.js';

/**
 * @param {{
 *   location: { city: string; place: string };
 *   onLocationChange: (next: { city: string; place: string }) => void;
 *   catalog: { countryIds?: string[]; cityIds: string[]; placeIds: string[] };
 *   onCatalogChange: (next: { countryIds?: string[]; cityIds: string[]; placeIds: string[] }) => void;
 *   locations: { id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string }[];
 *   onLocationsChange: (next: { id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string }[]) => void;
 *   className?: string;
 * }} props
 */
export default function RpgLocationStrip({
  location,
  onLocationChange,
  catalog,
  onCatalogChange,
  locations,
  onLocationsChange,
  className = '',
}) {
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState(/** @type {'search' | 'create'} */ ('search'));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(() => /** @type {any[]} */ ([]));
  const [createCountry, setCreateCountry] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createPlace, setCreatePlace] = useState('');
  const [createFocus, setCreateFocus] = useState(/** @type {null | 'country' | 'city' | 'place'} */ (null));
  const [createFieldSuggestions, setCreateFieldSuggestions] = useState(() => /** @type {any[]} */ ([]));
  const [busyCreateField, setBusyCreateField] = useState(false);
  const createBlurTRef = useRef(/** @type {number | null} */ (null));
  const [busySearch, setBusySearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const safeCatalog = normalizeRpgLocationCatalog(catalog);
  const current = normalizeRpgLocationState(location);

  const byId = useMemo(() => new Map(locations.map((x) => [x.id, x])), [locations]);
  const cityOptions = useMemo(
    () =>
      safeCatalog.cityIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [safeCatalog.cityIds, byId]
  );
  const placeOptions = useMemo(
    () =>
      safeCatalog.placeIds
        .map((id) => byId.get(id))
        .filter((x) => !!x && (!current.city || !x.city || x.city === current.city))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [safeCatalog.placeIds, byId, current.city]
  );
  const pickExisting = (row) => {
    const nextCatalog = normalizeRpgLocationCatalog({
      countryIds: [...(safeCatalog.countryIds || [])],
      cityIds: [...safeCatalog.cityIds],
      placeIds: [...safeCatalog.placeIds],
    });
    if (row.kind === 'country') {
      nextCatalog.countryIds = [...new Set([...(nextCatalog.countryIds || []), row.id])];
      onCatalogChange(nextCatalog);
      return;
    }
    if (row.kind === 'city') {
      nextCatalog.cityIds = [...new Set([...nextCatalog.cityIds, row.id])];
      if (row.country) {
        const countryMatch = locations.find((x) => x.kind === 'country' && x.name === row.country);
        if (countryMatch) nextCatalog.countryIds = [...new Set([...(nextCatalog.countryIds || []), countryMatch.id])];
      }
      onCatalogChange(nextCatalog);
      onLocationChange({ city: row.name, place: '' });
    } else {
      nextCatalog.placeIds = [...new Set([...nextCatalog.placeIds, row.id])];
      if (row.city) {
        const cityMatch = locations.find((x) => x.kind === 'city' && x.name === row.city);
        if (cityMatch) nextCatalog.cityIds = [...new Set([...nextCatalog.cityIds, cityMatch.id])];
        if (row.country) {
          const countryMatch = locations.find((x) => x.kind === 'country' && x.name === row.country);
          if (countryMatch) nextCatalog.countryIds = [...new Set([...(nextCatalog.countryIds || []), countryMatch.id])];
        }
        onLocationChange({ city: row.city || current.city, place: row.name });
      } else {
        onLocationChange({ city: current.city, place: row.name });
      }
      onCatalogChange(nextCatalog);
    }
  };

  const onSelectCity = (value) => {
    if (value === '__add_city__') {
      setModalMode('search');
      setModalOpen(true);
      return;
    }
    onLocationChange({ city: value || current.city, place: '' });
  };

  const onSelectPlace = (value) => {
    if (value === '__add_place__') {
      setModalMode('search');
      setModalOpen(true);
      return;
    }
    onLocationChange({ city: current.city, place: value || '' });
  };

  const addHierarchy = async () => {
    if (!createCountry.trim() || !createCity.trim() || !createPlace.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/rpg/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action: 'upsertHierarchy',
          countryName: createCountry.trim(),
          cityName: createCity.trim(),
          placeName: createPlace.trim(),
          description: '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.place || !data.city || !data.country) return;
      const nextLocations = [...locations];
      for (const row of [data.country, data.city, data.place]) {
        const idx = nextLocations.findIndex((x) => x.id === row.id);
        if (idx >= 0) nextLocations[idx] = row;
        else nextLocations.push(row);
      }
      onLocationsChange(nextLocations);
      pickExisting(data.place);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('rpg-location-updated', {
            detail: { city: data.place.city || current.city, place: data.place.name },
          })
        );
      }
      setCreateCountry('');
      setCreateCity('');
      setCreatePlace('');
      setCreateFocus(null);
      setCreateFieldSuggestions([]);
      setModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!modalOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setBusySearch(false);
      return;
    }
    if (modalMode !== 'search') {
      setBusySearch(false);
      return;
    }
    const q = searchQuery.trim();
    if (!q.length) {
      setSearchResults([]);
      setBusySearch(false);
      return;
    }
    const ac = new AbortController();
    setBusySearch(true);
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams();
        p.set('q', q);
        const res = await fetch(`/api/rpg/locations?${p.toString()}`, {
          credentials: 'same-origin',
          signal: ac.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.suggestions)) setSearchResults(data.suggestions);
        else setSearchResults([]);
      } finally {
        setBusySearch(false);
      }
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [modalOpen, modalMode, searchQuery]);

  useEffect(() => {
    if (!modalOpen || modalMode !== 'create') {
      setCreateFieldSuggestions([]);
      setBusyCreateField(false);
      return;
    }
    if (!createFocus) {
      setCreateFieldSuggestions([]);
      return;
    }
    const qRaw =
      createFocus === 'country' ? createCountry : createFocus === 'city' ? createCity : createPlace;
    const q = qRaw.trim();
    if (!q.length) {
      setCreateFieldSuggestions([]);
      setBusyCreateField(false);
      return;
    }
    const ac = new AbortController();
    setBusyCreateField(true);
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams();
        p.set('q', q);
        p.set('kind', createFocus);
        if (createFocus !== 'country' && createCountry.trim()) p.set('inCountry', createCountry.trim());
        if (createFocus === 'place' && createCity.trim()) p.set('inCity', createCity.trim());
        const res = await fetch(`/api/rpg/locations?${p.toString()}`, {
          credentials: 'same-origin',
          signal: ac.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.suggestions)) setCreateFieldSuggestions(data.suggestions);
        else setCreateFieldSuggestions([]);
      } finally {
        setBusyCreateField(false);
      }
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [modalOpen, modalMode, createFocus, createCountry, createCity, createPlace]);

  const scheduleCreateBlur = () => {
    if (createBlurTRef.current != null) window.clearTimeout(createBlurTRef.current);
    createBlurTRef.current = window.setTimeout(() => {
      createBlurTRef.current = null;
      setCreateFocus(null);
    }, 160);
  };

  const cancelCreateBlur = () => {
    if (createBlurTRef.current != null) {
      window.clearTimeout(createBlurTRef.current);
      createBlurTRef.current = null;
    }
  };

  useEffect(() => {
    if (!modalOpen) {
      setCreateCountry('');
      setCreateCity('');
      setCreatePlace('');
      setCreateFocus(null);
      setCreateFieldSuggestions([]);
    }
  }, [modalOpen]);

  useEffect(() => {
    if (!expanded) return;
    const onDocPointerDown = (/** @type {PointerEvent} */ e) => {
      const root = rootRef.current;
      if (!root) return;
      const target = /** @type {Node | null} */ (e.target);
      if (target && !root.contains(target)) setExpanded(false);
    };
    const onEsc = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [expanded]);

  return (
    <div class={`rpg-location-strip ${expanded ? 'rpg-location-strip--expanded' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        class="rpg-location-strip__toggle"
        aria-label={expanded ? 'Location-Panel einklappen' : 'Location-Panel ausklappen'}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.35" />
          <path d="M12 4.7l2.1 5.2 5.2 2.1-5.2 2.1-2.1 5.2-2.1-5.2-5.2-2.1 5.2-2.1z" fill="currentColor" />
        </svg>
      </button>
      <div
        class={`rpg-location-strip__panel${expanded ? '' : ' rpg-location-strip__panel--collapsed'}`}
        aria-hidden={!expanded}
      >
        <span class="rpg-location-strip__prefix">Location:</span>
        <select class="rpg-location-strip__select" value={current.city} onChange={(e) => onSelectCity(e.currentTarget.value)}>
          <option value="__add_city__">+ Stadt hinzufuegen</option>
          {[...new Set([current.city, ...cityOptions.map((c) => c.name)].filter(Boolean))].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select class="rpg-location-strip__select" value={current.place} onChange={(e) => onSelectPlace(e.currentTarget.value)}>
          <option value="__add_place__">+ Ort hinzufuegen</option>
          <option value="">-</option>
          {[...new Set(placeOptions.map((p) => p.name).filter(Boolean))].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {modalOpen ? (
        <div class="rpg-location-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div class="rpg-location-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 class="rpg-location-modal__title">Location hinzufuegen</h3>
            <div class="rpg-location-modal__switch">
              <button type="button" class={`rpg-location-strip__small-btn${modalMode === 'search' ? ' is-active' : ''}`} onClick={() => setModalMode('search')}>
                Suchen
              </button>
              <button type="button" class={`rpg-location-strip__small-btn${modalMode === 'create' ? ' is-active' : ''}`} onClick={() => setModalMode('create')}>
                Neu anlegen
              </button>
            </div>
            {modalMode === 'search' ? (
              <div class="rpg-location-modal__search">
                <label class="rpg-location-modal__search-label" for="rpg-location-search-q">
                  Suche in Land, Stadt und Ort
                </label>
                <input
                  id="rpg-location-search-q"
                  class="rpg-location-modal__search-input"
                  type="search"
                  autocomplete="off"
                  value={searchQuery}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  placeholder="z. B. Deutschland, Berlin, Bahnhof …"
                />
                <div class="rpg-location-modal__search-results" role="listbox" aria-label="Suchergebnisse">
                  {busySearch ? <p class="rpg-location-modal__hint">Suche...</p> : null}
                  {!busySearch && !searchQuery.trim() ? (
                    <p class="rpg-location-modal__hint">Tippe etwas ein — Treffer erscheinen nach Relevanz sortiert.</p>
                  ) : null}
                  {!busySearch && searchQuery.trim() && searchResults.length === 0 ? (
                    <p class="rpg-location-modal__hint">Keine Treffer. Unter „Neu anlegen“ kannst du den Ort anlegen.</p>
                  ) : null}
                  {searchResults.map((row) => {
                    const kindLabel = row.kind === 'country' ? 'Land' : row.kind === 'city' ? 'Stadt' : 'Ort';
                    const sub =
                      row.kind === 'country'
                        ? ''
                        : row.kind === 'city'
                          ? row.country || ''
                          : [row.city, row.country].filter(Boolean).join(', ');
                    return (
                      <button
                        key={row.id}
                        type="button"
                        role="option"
                        class="rpg-location-modal__result"
                        onClick={() => {
                          const fullRow = {
                            id: row.id,
                            kind: row.kind,
                            name: row.name,
                            description: row.description || '',
                            city: row.city || '',
                            country: row.country || '',
                          };
                          const nextLocations = [...locations.filter((x) => x.id !== fullRow.id), fullRow];
                          onLocationsChange(nextLocations);
                          pickExisting(fullRow);
                          setModalOpen(false);
                        }}
                      >
                        <span class="rpg-location-modal__result-main">
                          <span class="rpg-location-modal__result-kind">{kindLabel}</span>
                          <span class="rpg-location-modal__result-name">{row.name}</span>
                        </span>
                        {sub ? <span class="rpg-location-modal__result-sub">{sub}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div class="rpg-location-create">
                <p class="rpg-location-modal__hint rpg-location-create__intro">
                  Ort, Stadt, Land — pro Zeile tippen; passende Katalog-Eintraege erscheinen darunter (Ort-Leiste matcht nur Ortsnamen). Du kannst auch frei tippen und mit dem Button speichern.
                </p>
                <div class="rpg-location-create__row">
                  <label class="rpg-location-create__label" for="rpg-loc-create-place">
                    Ort
                  </label>
                  <div class="rpg-location-create__field">
                    <input
                      id="rpg-loc-create-place"
                      class="rpg-location-create__input"
                      type="text"
                      autocomplete="off"
                      value={createPlace}
                      onInput={(e) => setCreatePlace(e.currentTarget.value)}
                      onFocus={() => {
                        cancelCreateBlur();
                        setCreateFocus('place');
                      }}
                      onBlur={scheduleCreateBlur}
                      placeholder="z. B. Hauptbahnhof"
                    />
                    {createFocus === 'place' && createPlace.trim().length > 0 ? (
                      <div class="rpg-location-create__dd" role="listbox" aria-label="Vorschlaege Ort">
                        {busyCreateField ? <div class="rpg-location-create__dd-hint">Suche...</div> : null}
                        {!busyCreateField && createFieldSuggestions.length === 0 ? (
                          <div class="rpg-location-create__dd-hint">Keine Treffer im Katalog.</div>
                        ) : null}
                        {!busyCreateField &&
                          createFieldSuggestions.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              role="option"
                              class="rpg-location-create__dd-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                cancelCreateBlur();
                                setCreatePlace(row.name);
                                if (row.city) setCreateCity(row.city);
                                if (row.country) setCreateCountry(row.country);
                                setCreateFocus(null);
                                setCreateFieldSuggestions([]);
                              }}
                            >
                              <span class="rpg-location-create__dd-name">{row.name}</span>
                              <span class="rpg-location-create__dd-meta">
                                {[row.city, row.country].filter(Boolean).join(', ') || 'Ort'}
                              </span>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div class="rpg-location-create__row">
                  <label class="rpg-location-create__label" for="rpg-loc-create-city">
                    Stadt
                  </label>
                  <div class="rpg-location-create__field">
                    <input
                      id="rpg-loc-create-city"
                      class="rpg-location-create__input"
                      type="text"
                      autocomplete="off"
                      value={createCity}
                      onInput={(e) => setCreateCity(e.currentTarget.value)}
                      onFocus={() => {
                        cancelCreateBlur();
                        setCreateFocus('city');
                      }}
                      onBlur={scheduleCreateBlur}
                      placeholder="z. B. Berlin"
                    />
                    {createFocus === 'city' && createCity.trim().length > 0 ? (
                      <div class="rpg-location-create__dd" role="listbox" aria-label="Vorschlaege Stadt">
                        {busyCreateField ? <div class="rpg-location-create__dd-hint">Suche...</div> : null}
                        {!busyCreateField && createFieldSuggestions.length === 0 ? (
                          <div class="rpg-location-create__dd-hint">Keine Treffer im Katalog.</div>
                        ) : null}
                        {!busyCreateField &&
                          createFieldSuggestions.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              role="option"
                              class="rpg-location-create__dd-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                cancelCreateBlur();
                                setCreateCity(row.name);
                                if (row.country) setCreateCountry(row.country);
                                setCreateFocus(null);
                                setCreateFieldSuggestions([]);
                              }}
                            >
                              <span class="rpg-location-create__dd-name">{row.name}</span>
                              <span class="rpg-location-create__dd-meta">{row.country || 'Stadt'}</span>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div class="rpg-location-create__row">
                  <label class="rpg-location-create__label" for="rpg-loc-create-country">
                    Land
                  </label>
                  <div class="rpg-location-create__field">
                    <input
                      id="rpg-loc-create-country"
                      class="rpg-location-create__input"
                      type="text"
                      autocomplete="off"
                      value={createCountry}
                      onInput={(e) => setCreateCountry(e.currentTarget.value)}
                      onFocus={() => {
                        cancelCreateBlur();
                        setCreateFocus('country');
                      }}
                      onBlur={scheduleCreateBlur}
                      placeholder="z. B. Deutschland"
                    />
                    {createFocus === 'country' && createCountry.trim().length > 0 ? (
                      <div class="rpg-location-create__dd" role="listbox" aria-label="Vorschlaege Land">
                        {busyCreateField ? <div class="rpg-location-create__dd-hint">Suche...</div> : null}
                        {!busyCreateField && createFieldSuggestions.length === 0 ? (
                          <div class="rpg-location-create__dd-hint">Keine Treffer im Katalog.</div>
                        ) : null}
                        {!busyCreateField &&
                          createFieldSuggestions.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              role="option"
                              class="rpg-location-create__dd-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                cancelCreateBlur();
                                setCreateCountry(row.name);
                                setCreateFocus(null);
                                setCreateFieldSuggestions([]);
                              }}
                            >
                              <span class="rpg-location-create__dd-name">{row.name}</span>
                              <span class="rpg-location-create__dd-meta">Land</span>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            <div class="rpg-location-modal__actions">
              <button type="button" class="rpg-location-strip__small-btn" onClick={() => setModalOpen(false)}>
                Abbrechen
              </button>
              {modalMode === 'create' ? (
                <button
                  type="button"
                  class="rpg-location-strip__save"
                  disabled={busy || !createCountry.trim() || !createCity.trim() || !createPlace.trim()}
                  onClick={addHierarchy}
                >
                  {busy ? '...' : 'Neu anlegen und speichern'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
