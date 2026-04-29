/**
 * Reward-Logik: Normalisierung, Anzeige, Freischalt-Zeitplan.
 * Reine Funktionen ohne Seiteneffekte — Node/Graph-Abhaengigkeiten
 * liegen in rpg-quest-nodes.js, nicht hier.
 */

/** @typedef {import('./rpg-quests-data.js').RpgRewardEntry} RpgRewardEntry */

/** Stabile IDs fuer Punkt-Typen (UI: Herz bzw. Achtzack-Stern). */
export const RPG_REWARD_POINT_KINDS = /** @type {const} */ (['heart', 'mana']);

/**
 * Normalisiert einen Punkt-Typ-String zu 'heart' | 'mana' | null.
 * @param {unknown} v
 * @returns {'heart' | 'mana' | null}
 */
export function normalizeRewardPointKind(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'heart' || s === 'mana') return s;
  return null;
}

/**
 * Parst eine Punktzahl aus beliebigen Rohdaten.
 * @param {unknown} raw
 * @returns {number | null}
 */
function parseRewardPointsAmount(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/**
 * Anzeige der Punktzahl in Pills (+n / -n / 0).
 * @param {number} n
 */
export function formatRewardPointsAmount(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

/**
 * Normalisiert einen einzelnen Reward-Eintrag aus beliebigen Rohdaten.
 * Akzeptiert Strings (Legacy), Objekte mit/ohne type-Feld.
 * @param {unknown} raw
 * @returns {RpgRewardEntry | null}
 */
export function normalizeRewardEntry(raw) {
  if (raw == null) return null;
  // Legacy: Reward war frueher ein plain String
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? { type: 'text', text } : null;
  }
  if (typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const typRaw = typeof o.type === 'string' ? o.type.trim().toLowerCase() : '';

  // Text-Reward (explizit oder implizit ueber .text Feld)
  if (typRaw === 'text' || (!typRaw && typeof o.text === 'string')) {
    const text = String(o.text ?? '').trim();
    if (!text) return null;
    return { type: 'text', text };
  }

  // Punkte-Reward (heart/mana)
  if (typRaw === 'points') {
    const pointKind = normalizeRewardPointKind(o.pointKind);
    const amount = parseRewardPointsAmount(o.amount);
    if (!pointKind || amount === null) return null;
    return { type: 'points', pointKind, amount };
  }

  // Item-Reward
  if (typRaw === 'item' || (!typRaw && (o.itemId || o.id))) {
    const itemId = String(o.itemId ?? o.id ?? '').trim();
    if (!itemId) return null;
    const dn = typeof o.displayName === 'string' ? o.displayName.trim() : '';
    /** @type {import('./rpg-quests-data.js').RpgRewardItem} */
    const out = { type: 'item', itemId };
    if (dn) out.displayName = dn;
    return out;
  }

  // Achievement-Reward
  if (typRaw === 'achievement' || (!typRaw && o.achievementId)) {
    const achievementId = String(o.achievementId ?? '').trim();
    if (!achievementId) return null;
    const dn = typeof o.displayName === 'string' ? o.displayName.trim() : '';
    /** @type {import('./rpg-quests-data.js').RpgRewardAchievement} */
    const out = { type: 'achievement', achievementId };
    if (dn) out.displayName = dn;
    return out;
  }

  return null;
}

/**
 * Normalisiert ein Array von Reward-Rohdaten.
 * @param {unknown} raw
 * @returns {RpgRewardEntry[]}
 */
export function normalizeRewardEntries(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {RpgRewardEntry[]} */
  const out = [];
  for (const x of raw) {
    const e = normalizeRewardEntry(x);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Kurzer Anzeigename fuer Pills (displayName oder ID als Fallback).
 * @param {RpgRewardEntry} e
 */
function displayLabelForRewardEntry(e) {
  if (e.type === 'text') return e.text;
  if (e.type === 'points') return formatRewardPointsAmount(e.amount);
  const dn = e.displayName?.trim();
  // item und achievement haben beide displayName + eine ID-Fallback-Eigenschaft
  if (e.type === 'achievement') return dn || e.achievementId;
  return dn || e.itemId;
}

/**
 * Titel aus Katalog falls vorhanden, sonst Fallback auf displayLabel.
 * @param {RpgRewardEntry} entry
 * @param {Record<string, { title?: string }> | undefined} catalogById
 */
export function rewardEntryDisplayLabel(entry, catalogById) {
  if (entry.type === 'text') return entry.text;
  if (entry.type === 'points') return formatRewardPointsAmount(entry.amount);
  if (entry.type === 'achievement') {
    const t = catalogById?.[entry.achievementId]?.title?.trim();
    return t || displayLabelForRewardEntry(entry);
  }
  const t = catalogById?.[entry.itemId]?.title?.trim();
  if (t) return t;
  return displayLabelForRewardEntry(entry);
}

// --- Freischalt-Zeitplan (deterministisch pro Node-ID) ---

/**
 * FNV-1a Hash: String -> 32-bit Seed fuer PRNG.
 * @param {string} s
 * @returns {number}
 */
function hashQuestStringToSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates Shuffle mit gegebener PRNG.
 * @param {unknown[]} arr
 * @param {() => number} rand
 */
function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

/**
 * Gleichmaessig verteilte Meilensteine, zufaellig den Entries zugeordnet — stabil pro Node-ID.
 * @param {string} nodeId
 * @param {RpgRewardEntry[]} entries
 * @returns {{ entry: RpgRewardEntry; unlockAtPercent: number }[]}
 */
export function resolveRewardUnlockSchedule(nodeId, entries) {
  const n = entries.length;
  if (n === 0) return [];
  /** @type {number[]} */
  const milestones = [];
  for (let i = 0; i < n; i++) {
    milestones.push(Math.round((100 * (i + 1)) / n));
  }
  const copy = [...milestones];
  // Seed-String bleibt identisch fuer Abwaertskompatibilitaet
  const rand = mulberry32(hashQuestStringToSeed(`rpg-quest-rewards:${nodeId}`));
  shuffleInPlace(copy, rand);
  return entries.map((e, i) => ({
    entry: e,
    unlockAtPercent: copy[i],
  }));
}

// --- Reward-Rows (Entry + optionale Freischalt-Schwelle) ---

/**
 * @param {unknown} raw
 * @returns {number | undefined}
 */
function parseRewardUnlockFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const v = o.unlockAtPercent ?? o.unlock_at_percent;
  if (typeof v === 'number' && Number.isFinite(v)) return clampRewardUnlockPercent(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return clampRewardUnlockPercent(n);
  }
  return undefined;
}

/**
 * Klemmt einen Prozentwert auf 0-100.
 * @param {number} n
 * @returns {number}
 */
function clampRewardUnlockPercent(n) {
  const x = Math.round(n);
  // NaN-Guard: Math.round(NaN) === NaN, und NaN faellt durch beide Vergleiche
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}

/**
 * Eine Reward-Zeile: Entry + optionale Freischalt-Schwelle (0-100).
 * @typedef {{ entry: RpgRewardEntry; unlockAtPercent?: number }} RpgRewardRow
 */

/**
 * Normalisiert ein einzelnes Reward-Rohdatum zu einer Row.
 * @param {unknown} raw
 * @returns {RpgRewardRow | null}
 */
export function normalizeRewardRow(raw) {
  const entry = normalizeRewardEntry(raw);
  if (!entry) return null;
  const unlockAtPercent = parseRewardUnlockFromRaw(raw);
  if (unlockAtPercent !== undefined) return { entry, unlockAtPercent };
  return { entry };
}

/**
 * Normalisiert ein Array von Reward-Rohdaten zu Rows.
 * @param {unknown} raw
 * @returns {RpgRewardRow[]}
 */
export function normalizeRewardRows(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {RpgRewardRow[]} */
  const out = [];
  for (const x of raw) {
    const row = normalizeRewardRow(x);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Persistenz-Objekt fuer einen Reward-Eintrag (zum Speichern in DB/localStorage).
 * @param {RpgRewardRow} row
 * @returns {Record<string, unknown>}
 */
export function rewardRowToStored(row) {
  const e = row.entry;
  /** @type {Record<string, unknown>} */
  let o;
  if (e.type === 'text') {
    o = { type: 'text', text: e.text };
  } else if (e.type === 'points') {
    o = { type: 'points', pointKind: e.pointKind, amount: e.amount };
  } else if (e.type === 'achievement') {
    o = { type: 'achievement', achievementId: e.achievementId };
    if (e.displayName) o.displayName = e.displayName;
  } else {
    o = { type: 'item', itemId: e.itemId };
    if (e.displayName) o.displayName = e.displayName;
  }
  if (typeof row.unlockAtPercent === 'number' && Number.isFinite(row.unlockAtPercent)) {
    o.unlockAtPercent = clampRewardUnlockPercent(row.unlockAtPercent);
  }
  return o;
}

/**
 * Pro Zeile: explizites unlockAtPercent oder Fallback auf deterministischen Auto-Plan.
 * @param {string} nodeId
 * @param {RpgRewardRow[]} rows
 * @returns {{ entry: RpgRewardEntry; unlockAtPercent: number }[]}
 */
export function resolveRewardRowsWithUnlocks(nodeId, rows) {
  const n = rows.length;
  if (n === 0) return [];
  const entries = rows.map((r) => r.entry);
  const auto = resolveRewardUnlockSchedule(nodeId, entries);
  return rows.map((r, i) => ({
    entry: r.entry,
    unlockAtPercent:
      typeof r.unlockAtPercent === 'number' && Number.isFinite(r.unlockAtPercent)
        ? clampRewardUnlockPercent(r.unlockAtPercent)
        : auto[i].unlockAtPercent,
  }));
}

/**
 * Legacy-Hilfe: Flache Strings als Text-Reward-Entries.
 * @param {string[]} lines
 * @returns {RpgRewardEntry[]}
 */
export function stringsToTextRewards(lines) {
  const n = lines.length;
  if (n === 0) return [];
  return lines.map((text) => ({ type: 'text', text }));
}
