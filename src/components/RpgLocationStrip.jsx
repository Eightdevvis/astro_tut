import { useMemo, useState } from 'preact/hooks';
import { normalizeRpgLocationState, normalizeRpgLocationCatalog } from '../lib/rpg-location.js';

/**
 * @param {{
 *   location: { city: string; place: string };
 *   onLocationChange: (next: { city: string; place: string }) => void;
 *   catalog: { cityIds: string[]; placeIds: string[] };
 *   onCatalogChange: (next: { cityIds: string[]; placeIds: string[] }) => void;
 *   locations: { id: string; kind: 'city' | 'place'; name: string; description: string; city: string; country: string }[];
 *   onLocationsChange: (next: { id: string; kind: 'city' | 'place'; name: string; description: string; city: string; country: string }[]) => void;
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
  const [addKind, setAddKind] = useState(/** @type {'city' | 'place'} */ ('city'));
  const [modalOpen, setModalOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCity, setAddCity] = useState('');
  const [addCountry, setAddCountry] = useState('');
  const [addDescription, setAddDescription] = useState('');
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
      cityIds: [...safeCatalog.cityIds],
      placeIds: [...safeCatalog.placeIds],
    });
    if (row.kind === 'city') {
      nextCatalog.cityIds = [...new Set([...nextCatalog.cityIds, row.id])];
      onCatalogChange(nextCatalog);
      onLocationChange({ city: row.name, place: '' });
    } else {
      nextCatalog.placeIds = [...new Set([...nextCatalog.placeIds, row.id])];
      if (row.city) {
        const cityMatch = locations.find((x) => x.kind === 'city' && x.name === row.city);
        if (cityMatch) nextCatalog.cityIds = [...new Set([...nextCatalog.cityIds, cityMatch.id])];
        onLocationChange({ city: row.city || current.city, place: row.name });
      } else {
        onLocationChange({ city: current.city, place: row.name });
      }
      onCatalogChange(nextCatalog);
    }
  };

  const onSelectCity = (value) => {
    if (value === '__add_city__') {
      setAddKind('city');
      setModalOpen(true);
      return;
    }
    onLocationChange({ city: value || current.city, place: '' });
  };

  const onSelectPlace = (value) => {
    if (value === '__add_place__') {
      setAddKind('place');
      setModalOpen(true);
      return;
    }
    onLocationChange({ city: current.city, place: value || '' });
  };

  const addNew = async () => {
    if (!addName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/rpg/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          kind: addKind,
          name: addName.trim(),
          city: addKind === 'place' ? addCity.trim() : addName.trim(),
          country: addCountry.trim(),
          description: addDescription.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.location) return;
      const row = data.location;
      const nextLocations = [...locations.filter((x) => x.id !== row.id), row];
      onLocationsChange(nextLocations);
      pickExisting(row);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('rpg-location-updated', {
            detail: row.kind === 'city' ? { city: row.name, place: '' } : { city: row.city || current.city, place: row.name },
          })
        );
      }
      setAddName('');
      setAddCity('');
      setAddCountry('');
      setAddDescription('');
      setModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={`rpg-location-strip ${className}`.trim()}>
      <div class="rpg-location-strip__panel">
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
            <h3 class="rpg-location-modal__title">{addKind === 'city' ? 'Stadt hinzufuegen' : 'Ort hinzufuegen'}</h3>
            <input class="rpg-location-strip__input" value={addName} onInput={(e) => setAddName(e.currentTarget.value)} placeholder={addKind === 'city' ? 'Stadtname' : 'Ortsname'} />
            {addKind === 'place' ? (
              <input class="rpg-location-strip__input" value={addCity} onInput={(e) => setAddCity(e.currentTarget.value)} placeholder="Stadt" />
            ) : null}
            <input class="rpg-location-strip__input" value={addCountry} onInput={(e) => setAddCountry(e.currentTarget.value)} placeholder="Land (optional)" />
            <input class="rpg-location-strip__input" value={addDescription} onInput={(e) => setAddDescription(e.currentTarget.value)} placeholder="Beschreibung (optional)" />
            <div class="rpg-location-modal__actions">
              <button type="button" class="rpg-location-strip__small-btn" onClick={() => setModalOpen(false)}>
                Abbrechen
              </button>
              <button type="button" class="rpg-location-strip__save" disabled={busy} onClick={addNew}>
                {busy ? '...' : 'Hinzufuegen'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
