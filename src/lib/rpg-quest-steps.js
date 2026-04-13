/**
 * Rekursive Quest-Schritte: Gruppen, optionale Blätter, dependsOn, Step-Rewards,
 * Quest-Rewards mit Freischalt-Prozent. Fortschritt nur über nicht-optionale Blätter.
 */
import { normalizeQuestCityLocation, normalizeStepPlaceLocation } from './rpg-location.js';

/**
 * Einheitliches Reward-Modell für Step- und Quest-Belohnungen.
 * @typedef {{ type: 'text'; text: string }} RpgQuestRewardText
 * @typedef {{ type: 'item'; itemId: string; displayName?: string }} RpgQuestRewardItem
 * @typedef {{ type: 'points'; pointKind: 'heart' | 'mana'; amount: number }} RpgQuestRewardPoints
 * @typedef {RpgQuestRewardText | RpgQuestRewardItem | RpgQuestRewardPoints} RpgQuestRewardEntry
 */

/** Stabile IDs für Punkt-Typen (UI: Herz bzw. Achtzack-Stern). */
export const RPG_REWARD_POINT_KINDS = /** @type {const} */ (['heart', 'mana']);

/**
 * @param {unknown} v
 * @returns {'heart' | 'mana' | null}
 */
export function normalizeRewardPointKind(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'heart' || s === 'mana') return s;
  return null;
}

/**
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
 * Anzeige der Punktzahl in Pills (+n / −n / 0).
 * @param {number} n
 */
export function formatRewardPointsAmount(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

/**
 * @typedef {{
 *   id: string;
 *   label: string;
 *   optional?: boolean;
 *   substeps?: RpgQuestStepNode[];
 *   dependsOn?: string[];
 *   reward?: RpgQuestRewardEntry;
 *   timeDueAt?: string;
 *   cityLocation?: string;
 *   placeLocation?: string;
 *   done?: boolean;
 *   orderLinked?: boolean;
 * }} RpgQuestStepNode
 */

/**
 * Rohdaten (API/Legacy): Step-Reward war früher ein String; Quest-Rewards `{ text }` ohne `type`.
 * @param {unknown} raw
 * @returns {RpgQuestRewardEntry | null}
 */
export function normalizeRewardEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? { type: 'text', text } : null;
  }
  if (typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const typRaw = typeof o.type === 'string' ? o.type.trim().toLowerCase() : '';

  if (typRaw === 'text' || (!typRaw && typeof o.text === 'string')) {
    const text = String(o.text ?? '').trim();
    if (!text) return null;
    return { type: 'text', text };
  }

  if (typRaw === 'points') {
    const pointKind = normalizeRewardPointKind(o.pointKind);
    const amount = parseRewardPointsAmount(o.amount);
    if (!pointKind || amount === null) return null;
    return { type: 'points', pointKind, amount };
  }

  if (typRaw === 'item' || (!typRaw && (o.itemId || o.id))) {
    const itemId = String(o.itemId ?? o.id ?? '').trim();
    if (!itemId) return null;
    const dn = typeof o.displayName === 'string' ? o.displayName.trim() : '';
    /** @type {RpgQuestRewardItem} */
    const out = { type: 'item', itemId };
    if (dn) out.displayName = dn;
    return out;
  }

  return null;
}

/**
 * Kurzer Anzeigename für Pills (Katalog später; bis dahin displayName oder itemId).
 * @param {RpgQuestRewardEntry} e
 */
export function displayLabelForRewardEntry(e) {
  if (e.type === 'text') return e.text;
  if (e.type === 'points') return formatRewardPointsAmount(e.amount);
  const dn = e.displayName?.trim();
  return dn || e.itemId;
}

/**
 * Item: Titel aus Katalog falls vorhanden, sonst wie {@link displayLabelForRewardEntry}.
 * @param {RpgQuestRewardEntry} entry
 * @param {Record<string, { title?: string }> | undefined} catalogById
 */
export function rewardEntryDisplayLabel(entry, catalogById) {
  if (entry.type === 'text') return entry.text;
  if (entry.type === 'points') return formatRewardPointsAmount(entry.amount);
  const t = catalogById?.[entry.itemId]?.title?.trim();
  if (t) return t;
  return displayLabelForRewardEntry(entry);
}

/**
 * @param {unknown} raw
 * @param {{ n: number }} next
 * @returns {RpgQuestStepNode}
 */
function normalizeOneStep(raw, next) {
  const o = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `s-${next.n++}`;
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : id;
  const optional = !!o.optional;
  const dependsOn = Array.isArray(o.dependsOn)
    ? o.dependsOn.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const rewardRaw = o.reward;
  const rewardNorm = normalizeRewardEntry(rewardRaw);
  const reward = rewardNorm ?? undefined;
  const cityLocation = normalizeQuestCityLocation(o.cityLocation);
  const placeLocation = normalizeStepPlaceLocation(o.placeLocation);
  let timeDueAt;
  const rawDue = typeof o.timeDueAt === 'string' ? o.timeDueAt.trim() : '';
  if (rawDue) {
    const ymd = rawDue.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) timeDueAt = ymd;
    else {
      const t = Date.parse(rawDue);
      if (!Number.isNaN(t)) timeDueAt = new Date(t).toISOString().slice(0, 10);
    }
  }
  const subsRaw = o.substeps;
  /** @type {RpgQuestStepNode | undefined} */
  let out = { id, label, optional };
  if (dependsOn.length) out = { ...out, dependsOn };
  if (reward) out = { ...out, reward };
  if (cityLocation) out = { ...out, cityLocation };
  if (placeLocation) out = { ...out, placeLocation };
  if (timeDueAt) out = { ...out, timeDueAt };
  if (o.orderLinked === true) out = { ...out, orderLinked: true };
  if (Array.isArray(subsRaw) && subsRaw.length > 0) {
    return { ...out, substeps: normalizeStepsArray(subsRaw, next) };
  }
  return out;
}

/**
 * @param {unknown[]} arr
 * @param {{ n: number }} next
 * @returns {RpgQuestStepNode[]}
 */
function normalizeStepsArray(arr, next) {
  return arr.map((x) => normalizeOneStep(x, next));
}

/**
 * @param {unknown} steps
 * @returns {RpgQuestStepNode[]}
 */
export function normalizeQuestStepsTree(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  return normalizeStepsArray(steps, { n: 0 });
}

/**
 * Flache Legacy-Zeilen → normalisierte Blätter ohne Substufen.
 * @param {{ id: string; label: string }[]} flat
 * @returns {RpgQuestStepNode[]}
 */
export function flatLegacyStepsToNormalized(flat) {
  const next = { n: 0 };
  return flat.map((s) => normalizeOneStep({ id: s.id, label: s.label, optional: false }, next));
}

/**
 * @param {string[]} lines
 * @returns {RpgQuestRewardEntry[]}
 */
export function distributeQuestRewardPercents(lines) {
  const n = lines.length;
  if (n === 0) return [];
  return lines.map((text) => ({ type: 'text', text }));
}

/**
 * @param {string} s
 * @returns {number}
 */
export function hashQuestStringToSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
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
 * Standard-Stufen (wie früher gleichmäßig), zufällig den Belohnungszeilen zugeordnet — stabil pro Quest-ID.
 * @param {string} questId
 * @param {RpgQuestRewardEntry[]} entries
 * @returns {{ entry: RpgQuestRewardEntry; unlockAtPercent: number }[]}
 */
export function resolveQuestRewardUnlockSchedule(questId, entries) {
  const n = entries.length;
  if (n === 0) return [];
  /** @type {number[]} */
  const milestones = [];
  for (let i = 0; i < n; i++) {
    milestones.push(Math.round((100 * (i + 1)) / n));
  }
  const copy = [...milestones];
  const rand = mulberry32(hashQuestStringToSeed(`rpg-quest-rewards:${questId}`));
  shuffleInPlace(copy, rand);
  return entries.map((e, i) => ({
    entry: e,
    unlockAtPercent: copy[i],
  }));
}

/**
 * @param {unknown} raw
 * @returns {number | undefined}
 */
export function parseQuestRewardUnlockFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const v = o.unlockAtPercent ?? o.unlock_at_percent;
  if (typeof v === 'number' && Number.isFinite(v)) return clampQuestRewardUnlockPercent(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return clampQuestRewardUnlockPercent(n);
  }
  return undefined;
}

/**
 * @param {number} n
 * @returns {number}
 */
export function clampQuestRewardUnlockPercent(n) {
  const x = Math.round(n);
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}

/**
 * Eine Quest-Belohnungszeile inkl. optionaler Freischalt-Schwelle (0–100).
 * @typedef {{ entry: RpgQuestRewardEntry; unlockAtPercent?: number }} RpgQuestRewardRow
 */

/**
 * @param {unknown} raw
 * @returns {RpgQuestRewardRow | null}
 */
export function normalizeQuestRewardRow(raw) {
  const entry = normalizeRewardEntry(raw);
  if (!entry) return null;
  const unlockAtPercent = parseQuestRewardUnlockFromRaw(raw);
  if (unlockAtPercent !== undefined) return { entry, unlockAtPercent };
  return { entry };
}

/**
 * @param {unknown} raw
 * @returns {RpgQuestRewardRow[]}
 */
export function normalizeQuestRewardRows(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {RpgQuestRewardRow[]} */
  const out = [];
  for (const x of raw) {
    const row = normalizeQuestRewardRow(x);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Persistenz-Objekt (ein Element von `questRewards[]`).
 * @param {RpgQuestRewardRow} row
 * @returns {Record<string, unknown>}
 */
export function questRewardRowToStored(row) {
  const e = row.entry;
  /** @type {Record<string, unknown>} */
  let o;
  if (e.type === 'text') {
    o = { type: 'text', text: e.text };
  } else if (e.type === 'points') {
    o = { type: 'points', pointKind: e.pointKind, amount: e.amount };
  } else {
    o = { type: 'item', itemId: e.itemId };
    if (e.displayName) o.displayName = e.displayName;
  }
  if (typeof row.unlockAtPercent === 'number' && Number.isFinite(row.unlockAtPercent)) {
    o.unlockAtPercent = clampQuestRewardUnlockPercent(row.unlockAtPercent);
  }
  return o;
}

/**
 * Pro Zeile: explizites unlockAtPercent oder Fallback auf deterministischen Auto-Plan.
 * @param {string} questId
 * @param {RpgQuestRewardRow[]} rows
 * @returns {{ entry: RpgQuestRewardEntry; unlockAtPercent: number }[]}
 */
export function resolveQuestRewardRowsWithUnlocks(questId, rows) {
  const n = rows.length;
  if (n === 0) return [];
  const entries = rows.map((r) => r.entry);
  const auto = resolveQuestRewardUnlockSchedule(questId, entries);
  return rows.map((r, i) => ({
    entry: r.entry,
    unlockAtPercent:
      typeof r.unlockAtPercent === 'number' && Number.isFinite(r.unlockAtPercent)
        ? clampQuestRewardUnlockPercent(r.unlockAtPercent)
        : auto[i].unlockAtPercent,
  }));
}

/**
 * @param {unknown} raw
 * @returns {RpgQuestRewardEntry[]}
 */
export function normalizeQuestRewards(raw) {
  return normalizeQuestRewardRows(raw).map((r) => r.entry);
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @param {string} id
 * @returns {RpgQuestStepNode | null}
 */
export function findStepById(steps, id) {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.substeps?.length) {
      const f = findStepById(s.substeps, id);
      if (f) return f;
    }
  }
  return null;
}

/**
 * @param {RpgQuestStepNode} step
 * @returns {boolean}
 */
export function stepIsLeaf(step) {
  return !Array.isArray(step.substeps) || step.substeps.length === 0;
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @param {(s: RpgQuestStepNode) => void} fn
 */
export function walkStepsPreOrder(steps, fn) {
  for (const s of steps) {
    fn(s);
    if (s.substeps?.length) walkStepsPreOrder(s.substeps, fn);
  }
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {string} stepId
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {Set<string>} [visiting]
 */
export function isStepNodeComplete(quest, stepId, stepDone, visiting) {
  const steps = quest.steps || [];
  const node = findStepById(steps, stepId);
  if (!node) return false;
  const qm = stepDone[quest.id] || {};

  if (!stepIsLeaf(node)) {
    const vis = visiting ?? new Set();
    if (vis.has(stepId)) return false;
    vis.add(stepId);
    for (const d of node.dependsOn || []) {
      if (!isStepNodeComplete(quest, d, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    const subs = node.substeps || [];
    for (const ch of subs) {
      if (ch.optional) continue;
      if (!isStepNodeComplete(quest, ch.id, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    vis.delete(stepId);
    return true;
  }

  const vis = visiting ?? new Set();
  if (vis.has(stepId)) return false;

  if (node.optional) {
    if (!qm[node.id]) return false;
    vis.add(stepId);
    for (const d of node.dependsOn || []) {
      if (!isStepNodeComplete(quest, d, stepDone, vis)) {
        vis.delete(stepId);
        return false;
      }
    }
    vis.delete(stepId);
    return true;
  }

  if (!qm[node.id]) return false;
  vis.add(stepId);
  for (const d of node.dependsOn || []) {
    if (!isStepNodeComplete(quest, d, stepDone, vis)) {
      vis.delete(stepId);
      return false;
    }
  }
  vis.delete(stepId);
  return true;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {string} stepId
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {boolean} wantOn
 */
export function canSetStepDone(quest, stepId, stepDone, wantOn) {
  const node = findStepById(quest.steps || [], stepId);
  if (!node || !stepIsLeaf(node)) return false;
  if (!wantOn) return true;
  for (const d of node.dependsOn || []) {
    if (!isStepNodeComplete(quest, d, stepDone)) return false;
  }
  return true;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {RpgQuestStepNode[]} steps
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
function countLeafProgressQuest(quest, steps, stepDone) {
  let total = 0;
  let done = 0;
  for (const s of steps) {
    if (!stepIsLeaf(s)) {
      const sub = countLeafProgressQuest(quest, s.substeps || [], stepDone);
      total += sub.total;
      done += sub.done;
      continue;
    }
    if (s.optional) continue;
    total += 1;
    if (isStepNodeComplete(quest, s.id, stepDone)) done += 1;
  }
  return { total, done };
}

/**
 * @param {RpgQuestStepNode[]} steps
 * @returns {Map<string, RpgQuestStepNode>}
 */
export function buildStepIdMap(steps) {
  /** @type {Map<string, RpgQuestStepNode>} */
  const m = new Map();
  walkStepsPreOrder(steps, (s) => m.set(s.id, s));
  return m;
}

/**
 * Zähler: nicht-optionale Blätter erledigt / Gesamtzahl.
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questLeafProgressRatio(quest, stepDone) {
  const { total, done } = countLeafProgressQuest(quest, quest.steps || [], stepDone);
  if (total === 0) return { total: 0, done: 0, percent: 100 };
  return { total, done, percent: Math.round((done / total) * 100) };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questProgressFromSteps(quest, stepDone) {
  return questLeafProgressRatio(quest, stepDone).percent;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function isQuestCompletedFromSteps(quest, stepDone) {
  const { total, percent } = questLeafProgressRatio(quest, stepDone);
  if (total === 0) return true;
  return percent >= 100;
}

const MS_WEEK = 7 * 86400000;

/**
 * @param {string} isoYmd
 * @returns {number}
 */
function endOfLocalDayMs(isoYmd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoYmd).trim());
  if (!m) {
    const t = Date.parse(isoYmd);
    return Number.isNaN(t) ? 0 : t;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Noch offene Pflichtschritte mit gesetzter Frist (Quest gilt dann als zeitgebunden).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 */
export function questHasIncompleteTimeBoundLeaves(quest, stepDone) {
  let found = false;
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (!stepIsLeaf(s)) return;
    if (s.optional) return;
    if (!s.timeDueAt || !String(s.timeDueAt).trim()) return;
    if (isStepNodeComplete(quest, s.id, stepDone)) return;
    found = true;
  });
  return found;
}

/**
 * Dringend: offene Pflichtschritte mit Frist in weniger als einer Woche oder überfällig (für rotes Baum-Symbol).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {number} [nowMs]
 */
export function questHasUrgentTimeBoundLeaves(quest, stepDone, nowMs = Date.now()) {
  let found = false;
  walkStepsPreOrder(quest.steps || [], (s) => {
    if (!stepIsLeaf(s)) return;
    if (s.optional) return;
    const dueRaw = s.timeDueAt && String(s.timeDueAt).trim();
    if (!dueRaw) return;
    if (isStepNodeComplete(quest, s.id, stepDone)) return;
    const dueEnd = endOfLocalDayMs(dueRaw);
    if (!dueEnd) return;
    const remaining = dueEnd - nowMs;
    if (remaining < MS_WEEK) found = true;
  });
  return found;
}

/**
 * Sammelt Step-Rewards (DFS) und Quest-Rewards mit unlocked-Flag.
 * Quest-Reward-Schwellen: optional gespeichertes `unlockAtPercent` pro Zeile, sonst Auto-Plan (deterministisch pro Quest-ID).
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {number} [progressPercentOverride] — z. B. aus questProgress(..., graph): Vorgänger + Folgequests
 * @param {Record<string, { title?: string }> | undefined} [itemCatalogById] — Questmaker-Katalog (id → Anzeigename)
 */
export function buildRewardDisplayList(quest, stepDone, progressPercentOverride, itemCatalogById) {
  const pct =
    typeof progressPercentOverride === 'number' && Number.isFinite(progressPercentOverride)
      ? progressPercentOverride
      : questLeafProgressRatio(quest, stepDone).percent;
  /** @type {{ label: string; kind: 'text' | 'item' | 'points'; pointKind?: 'heart' | 'mana'; amount?: number; unlocked: boolean; source: 'step' | 'quest'; itemId?: string; unlockAtPercent?: number }[]} */
  const rows = [];
  walkStepsPreOrder(quest.steps || [], (s) => {
    const entry = normalizeRewardEntry(s.reward);
    if (!entry) return;
    const unlocked = isStepNodeComplete(quest, s.id, stepDone);
    const label = rewardEntryDisplayLabel(entry, itemCatalogById);
    const kind = entry.type === 'item' ? 'item' : entry.type === 'points' ? 'points' : 'text';
    rows.push({
      label,
      kind,
      unlocked,
      source: 'step',
      ...(entry.type === 'item' ? { itemId: entry.itemId } : {}),
      ...(entry.type === 'points' ? { pointKind: entry.pointKind, amount: entry.amount } : {}),
    });
  });
  const qr = resolveQuestRewardRowsWithUnlocks(quest.id, getQuestRewardRows(quest));
  for (const r of qr) {
    const unlocked = pct >= r.unlockAtPercent;
    const entry = r.entry;
    const label = rewardEntryDisplayLabel(entry, itemCatalogById);
    const kind = entry.type === 'item' ? 'item' : entry.type === 'points' ? 'points' : 'text';
    rows.push({
      label,
      kind,
      unlocked,
      source: 'quest',
      unlockAtPercent: r.unlockAtPercent,
      ...(entry.type === 'item' ? { itemId: entry.itemId } : {}),
      ...(entry.type === 'points' ? { pointKind: entry.pointKind, amount: entry.amount } : {}),
    });
  }
  return rows;
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} q
 * @returns {RpgQuestRewardRow[]}
 */
export function getQuestRewardRows(q) {
  if (Array.isArray(q.questRewards) && q.questRewards.length > 0) {
    return normalizeQuestRewardRows(q.questRewards);
  }
  const legacy = Array.isArray(q.rewards) ? q.rewards : [];
  return distributeQuestRewardPercents(legacy.map((x) => String(x).trim()).filter(Boolean)).map((e) => ({
    entry: e,
  }));
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} q
 * @returns {RpgQuestRewardEntry[]}
 */
export function getQuestRewardEntries(q) {
  return getQuestRewardRows(q).map((r) => r.entry);
}

/**
 * Migriert eine Quest: `rewards` → `questRewards`, Steps normalisieren.
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} q
 * @returns {import('./rpg-quests-data.js').RpgGraphQuest}
 */
export function migrateQuestToV2Shape(q) {
  const stepsIn = Array.isArray(q.steps) ? q.steps : [];

  const isLegacyFlatRow = (s) =>
    s &&
    typeof s === 'object' &&
    !Array.isArray(/** @type {any} */ (s).substeps)?.length &&
    typeof /** @type {any} */ (s).label === 'string' &&
    !/** @type {any} */ (s).dependsOn?.length &&
    !/** @type {any} */ (s).optional &&
    !/** @type {any} */ (s).reward &&
    !/** @type {any} */ (s).timeDueAt;

  const looksLegacyFlat = stepsIn.length > 0 && stepsIn.every(isLegacyFlatRow);

  let steps;
  if (looksLegacyFlat) {
    steps = flatLegacyStepsToNormalized(
      stepsIn.map((s) => ({ id: /** @type {any} */ (s).id, label: /** @type {any} */ (s).label }))
    );
  } else {
    steps = normalizeQuestStepsTree(stepsIn);
  }

  let questRewardRows = normalizeQuestRewardRows(q.questRewards);
  if (questRewardRows.length === 0 && Array.isArray(q.rewards) && q.rewards.length > 0) {
    questRewardRows = distributeQuestRewardPercents(q.rewards.map((x) => String(x).trim()).filter(Boolean)).map(
      (e) => ({ entry: e })
    );
  }

  const questRewards = questRewardRows.map(questRewardRowToStored);

  const { rewards: _drop, questRewards: _qr, steps: _st, ...rest } = q;
  return {
    ...rest,
    steps,
    questRewards,
  };
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @returns {import('./rpg-quests-data.js').RpgGraph}
 */
export function migrateRpgGraphToV2(graph) {
  const quests = (graph.quests || []).map((q) => migrateQuestToV2Shape(q));
  return { quests, edges: graph.edges || [] };
}
