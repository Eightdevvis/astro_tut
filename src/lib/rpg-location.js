export const RPG_DEFAULT_LOCATION = Object.freeze({
  city: 'Berlin',
  place: '',
});

export const RPG_LOCATION_KIND_CITY = 'city';
export const RPG_LOCATION_KIND_PLACE = 'place';

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
 * @param {'city' | 'place'} kind
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
 * @returns {{ cityIds: string[]; placeIds: string[] }}
 */
export function normalizeRpgLocationCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { cityIds: [], placeIds: [] };
  }
  const cityIds = Array.isArray(raw.cityIds) ? raw.cityIds.map((x) => cleanPart(x)).filter(Boolean) : [];
  const placeIds = Array.isArray(raw.placeIds) ? raw.placeIds.map((x) => cleanPart(x)).filter(Boolean) : [];
  return {
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
        if (Array.isArray(s.substeps) && s.substeps.length) walk(s.substeps);
      }
    };
    walk(q.steps);
  }
  return out;
}
