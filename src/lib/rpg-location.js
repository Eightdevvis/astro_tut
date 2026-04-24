export const RPG_DEFAULT_LOCATION = Object.freeze({
  city: 'Berlin',
  place: '',
});

export const RPG_LOCATION_KIND_CITY = 'city';
export const RPG_LOCATION_KIND_PLACE = 'place';
export const RPG_LOCATION_KIND_COUNTRY = 'country';

function cleanPart(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

/**
 * @param {unknown} raw
 * @returns {{ city: string; place: string }}
 */
export function normalizeRpgLocationState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...RPG_DEFAULT_LOCATION };
  }
  const city = cleanPart(raw.city);
  const place = cleanPart(raw.place);
  return {
    city: city || RPG_DEFAULT_LOCATION.city,
    place,
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeQuestCityLocation(raw) {
  return cleanPart(raw);
}

/**
 * @param {unknown} raw
 */
export function normalizeStepPlaceLocation(raw) {
  return cleanPart(raw);
}

function slug(s) {
  return cleanPart(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {'country' | 'city' | 'place'} kind
 * @param {string} name
 * @param {string} city
 * @param {string} country
 */
export function buildRpgLocationId(kind, name, city = '', country = '') {
  const a = slug(name) || 'location';
  const b = slug(city);
  const c = slug(country);
  const tail = [b, c].filter(Boolean).join('-');
  return tail ? `${kind}:${a}:${tail}` : `${kind}:${a}`;
}

/**
 * @param {unknown} raw
 * @returns {{ countryIds: string[]; cityIds: string[]; placeIds: string[] }}
 */
export function normalizeRpgLocationCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { countryIds: [], cityIds: [], placeIds: [] };
  }
  const countryIds = Array.isArray(raw.countryIds)
    ? raw.countryIds.map((x) => cleanPart(x)).filter(Boolean)
    : [];
  const cityIds = Array.isArray(raw.cityIds) ? raw.cityIds.map((x) => cleanPart(x)).filter(Boolean) : [];
  const placeIds = Array.isArray(raw.placeIds) ? raw.placeIds.map((x) => cleanPart(x)).filter(Boolean) : [];
  return {
    countryIds: [...new Set(countryIds)],
    cityIds: [...new Set(cityIds)],
    placeIds: [...new Set(placeIds)],
  };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 */
export function collectLocationEntriesFromGraph(graph) {
  /** @type {{ kind: 'city' | 'place'; name: string; city: string; country: string; description: string }[]} */
  const out = [];
  for (const q of graph?.quests || []) {
    const qCity = normalizeQuestCityLocation(q.cityLocation);
    if (qCity) {
      out.push({
        kind: RPG_LOCATION_KIND_CITY,
        name: qCity,
        city: qCity,
        country: '',
        description: '',
      });
    }
    const walk = (steps) => {
      for (const s of steps || []) {
        const stepCity = normalizeQuestCityLocation(s.cityLocation) || qCity;
        const place = normalizeStepPlaceLocation(s.placeLocation);
        if (stepCity) {
          out.push({
            kind: RPG_LOCATION_KIND_CITY,
            name: stepCity,
            city: stepCity,
            country: '',
            description: '',
          });
        }
        if (place) {
          out.push({
            kind: RPG_LOCATION_KIND_PLACE,
            name: place,
            city: stepCity,
            country: '',
            description: '',
          });
        }
        if (Array.isArray(s.children) && s.children.length) walk(s.children);
      }
    };
    walk(q.children);
  }
  return out;
}

const MAX_USER_LOCATION_PICKER_ROWS = 400;

/**
 * Gespeicherte Orts-Zeilen im User-Payload (Picker/Dropdown), begrenzt und bereinigt.
 * @param {unknown} raw
 * @returns {{ id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string }[]}
 */
export function normalizeRpgUserLocationRows(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {{ id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string }[]} */
  const out = [];
  for (let i = 0; i < raw.length && out.length < MAX_USER_LOCATION_PICKER_ROWS; i++) {
    const x = raw[i];
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = /** @type {Record<string, unknown>} */ (x);
    const id = cleanPart(o.id);
    if (!id) continue;
    const rawKind = cleanPart(o.kind);
    const kind = rawKind === 'country' ? 'country' : rawKind === 'place' ? 'place' : 'city';
    const name = cleanPart(o.name);
    if (!name) continue;
    out.push({
      id,
      kind,
      name,
      description: cleanPart(o.description),
      city: cleanPart(o.city),
      country: cleanPart(o.country),
    });
  }
  return out;
}

/**
 * Orte für Dropdown: nur Einträge aus `locationCatalog` + gespeicherten User-Zeilen,
 * mit Kanonisierung aus dem globalen Katalog (`globalRows`).
 *
 * @param {{ locationCatalog?: unknown; locations?: unknown } | null | undefined} storedSlice
 * @param {{ id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string; updatedAt: string }[]} globalRows
 */
export function resolveRpgUserPickerLocations(storedSlice, globalRows) {
  const catalog = normalizeRpgLocationCatalog(storedSlice?.locationCatalog);
  /** @type {Set<string>} */
  const wanted = new Set([...catalog.countryIds, ...catalog.cityIds, ...catalog.placeIds]);
  const storedRows = normalizeRpgUserLocationRows(storedSlice?.locations);
  for (const r of storedRows) wanted.add(r.id);

  const byId = new Map(globalRows.map((r) => [r.id, r]));
  /** @type {{ id: string; kind: 'country' | 'city' | 'place'; name: string; description: string; city: string; country: string; updatedAt: string }[]} */
  const out = [];
  for (const id of wanted) {
    const g = byId.get(id);
    if (g) {
      out.push(g);
      continue;
    }
    const snap = storedRows.find((r) => r.id === id);
    if (snap) {
      out.push({
        id: snap.id,
        kind: snap.kind,
        name: snap.name,
        description: snap.description,
        city: snap.city,
        country: snap.country,
        updatedAt: '',
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
