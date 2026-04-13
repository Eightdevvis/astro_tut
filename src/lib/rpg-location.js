export const RPG_DEFAULT_LOCATION = Object.freeze({
  city: 'Berlin',
  place: '',
});

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
