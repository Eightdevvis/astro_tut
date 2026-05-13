/**
 * src/lib/site-items.js
 *
 * Pure Helper rund um den Site-Item-Katalog. STRIKT getrennt vom RPG-System
 * (kein Import aus rpg-*; kein gemeinsamer Zustand).
 *
 * Behavior-Werte sind hier zentral definiert, damit Frontend und Server-API
 * dieselbe Liste nutzen — neue Behaviors hier eintragen.
 */

export const ITEM_BEHAVIORS = ['draw', 'place', 'unlock', 'none'];

/**
 * Schlanke Form für Frontend-Konsumenten (kein created_at/sort_order).
 * Public-Endpoint liefert genau diese Form.
 * @typedef {{
 *   id: string,
 *   kind: string,
 *   variant: string,
 *   name: string,
 *   description: string,
 *   behavior: string,
 *   config: Record<string, unknown>,
 * }} SiteItemPublic
 */

/** Volle Form für SuperSettings (alle Spalten). */
export function normalizeDbRow(row) {
  let config = {};
  try {
    const parsed = JSON.parse(String(row?.config_json ?? '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    // kaputtes JSON in der DB → leeres config, nicht crashen
  }
  return {
    id: String(row?.id ?? ''),
    kind: String(row?.kind ?? ''),
    variant: String(row?.variant ?? ''),
    name: String(row?.name ?? ''),
    description: String(row?.description ?? ''),
    behavior: String(row?.behavior ?? 'none'),
    config,
    enabled: Number(row?.enabled ?? 1) ? 1 : 0,
    sortOrder: Number(row?.sort_order ?? 0),
    createdAt: String(row?.created_at ?? ''),
  };
}

/** Schmale Public-Form ohne Admin-Metadaten. */
export function toPublic(item) {
  return {
    id: item.id,
    kind: item.kind,
    variant: item.variant,
    name: item.name,
    description: item.description,
    behavior: item.behavior,
    config: item.config || {},
  };
}

/**
 * Validiert + normalisiert einen einzelnen Item-Eintrag aus dem Admin-PUT.
 * Wirft NICHT — gibt {item, error} zurück, damit der Endpoint einen 400er
 * mit konkretem Hinweis liefern kann.
 */
export function validateIncomingItem(raw) {
  if (!raw || typeof raw !== 'object') {
    return { item: null, error: 'Item ist kein Objekt' };
  }
  const id = String(raw.id ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
    return { item: null, error: `Ungültige ID "${raw.id}" (erlaubt: a-z0-9_-, max 64)` };
  }
  const kind = String(raw.kind ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) {
    return { item: null, error: `Ungültige kind "${raw.kind}"` };
  }
  const name = String(raw.name ?? '').trim();
  if (!name) return { item: null, error: `Name fehlt für "${id}"` };
  const behavior = String(raw.behavior ?? 'none').trim().toLowerCase();
  if (!ITEM_BEHAVIORS.includes(behavior)) {
    return { item: null, error: `Unbekanntes behavior "${behavior}" für "${id}"` };
  }
  let config = raw.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      return { item: null, error: `config kein gültiges JSON bei "${id}"` };
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    config = {};
  }
  return {
    item: {
      id,
      kind,
      variant: String(raw.variant ?? '').trim().toLowerCase(),
      name: name.slice(0, 200),
      description: String(raw.description ?? '').slice(0, 1000),
      behavior,
      config,
      enabled: raw.enabled === false || raw.enabled === 0 ? 0 : 1,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Math.trunc(Number(raw.sortOrder)) : 0,
    },
    error: null,
  };
}
