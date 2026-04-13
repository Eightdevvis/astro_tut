import {
  walkStepsPreOrder,
  normalizeRewardEntry,
  isStepNodeComplete,
  getQuestRewardRows,
} from './rpg-quest-steps.js';
import { isQuestCompleted } from './rpg-quest-graph.js';

export const RPG_VITAL_MAX_POINTS = 50;
export const RPG_VITAL_BASE_HEART = 25;
export const RPG_VITAL_BASE_MANA = 25;

/**
 * @typedef {{
 *   heart: number;
 *   mana: number;
 *   appliedStepRewardIds: string[];
 * }} RpgVitalsState
 */

/**
 * @param {number} n
 */
function clampPoints(n) {
  return Math.max(0, Math.min(RPG_VITAL_MAX_POINTS, Math.round(n)));
}

/**
 * Zentrale Buchungsfunktion: Manakonto verändern.
 * @param {RpgVitalsState} state
 * @param {number} amount
 * @returns {RpgVitalsState}
 */
export function gainManaEnergy(state, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return state;
  return { ...state, mana: clampPoints(state.mana + Math.trunc(n)) };
}

/**
 * Zentrale Buchungsfunktion: Herz-/Lebenskonto verändern.
 * @param {RpgVitalsState} state
 * @param {number} amount
 * @returns {RpgVitalsState}
 */
export function gainHeartEnergy(state, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return state;
  return { ...state, heart: clampPoints(state.heart + Math.trunc(n)) };
}

/**
 * Einheitlicher Einstieg für Punkt-Rewards.
 * @param {RpgVitalsState} state
 * @param {'heart'|'mana'} pointKind
 * @param {number} amount
 * @returns {RpgVitalsState}
 */
export function applyPointsReward(state, pointKind, amount) {
  if (pointKind === 'mana') return gainManaEnergy(state, amount);
  return gainHeartEnergy(state, amount);
}

/**
 * @param {unknown} raw
 * @returns {RpgVitalsState}
 */
export function normalizeRpgVitalsState(raw) {
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const heart = clampPoints(typeof o.heart === 'number' ? o.heart : RPG_VITAL_BASE_HEART);
  const mana = clampPoints(typeof o.mana === 'number' ? o.mana : RPG_VITAL_BASE_MANA);
  const rawApplied = Array.isArray(o.appliedStepRewardIds)
    ? o.appliedStepRewardIds
    : Array.isArray(o.appliedRewardIds)
      ? o.appliedRewardIds
      : [];
  const appliedStepRewardIds = rawApplied
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim());
  return { heart, mana, appliedStepRewardIds };
}

/**
 * @param {RpgVitalsState} state
 */
export function toRpgVitalsView(state) {
  return {
    heart: state.heart,
    mana: state.mana,
    heartFill: state.heart / RPG_VITAL_MAX_POINTS,
    manaFill: state.mana / RPG_VITAL_MAX_POINTS,
  };
}

/**
 * Schreibt genau einmal gut, sobald ein Schritt mit points-Reward erledigt ist.
 * Kein automatisches Zurückbuchen beim Ent-Haken.
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {Record<string, Record<string, boolean>>} stepDone
 * @param {unknown} rawState
 * @returns {{ state: RpgVitalsState; changed: boolean }}
 */
export function reconcileRpgVitals(graph, stepDone, rawState) {
  const state = normalizeRpgVitalsState(rawState);
  const applied = new Set(state.appliedStepRewardIds);
  let changed = false;
  /** @type {RpgVitalsState} */
  let acc = {
    heart: state.heart,
    mana: state.mana,
    appliedStepRewardIds: state.appliedStepRewardIds,
  };

  for (const q of graph?.quests || []) {
    walkStepsPreOrder(q.steps || [], (s) => {
      const ent = normalizeRewardEntry(s.reward);
      if (!ent || ent.type !== 'points') return;
      if (!isStepNodeComplete(q, s.id, stepDone)) return;
      const key = `step:${q.id}:${s.id}`;
      if (applied.has(key)) return;
      applied.add(key);
      acc = applyPointsReward(acc, ent.pointKind, ent.amount);
      changed = true;
    });

    if (isQuestCompleted(q, stepDone)) {
      const rows = getQuestRewardRows(q);
      for (let i = 0; i < rows.length; i++) {
        const ent = rows[i]?.entry;
        if (!ent || ent.type !== 'points') continue;
        const key = `quest:${q.id}:reward:${i}`;
        if (applied.has(key)) continue;
        applied.add(key);
        acc = applyPointsReward(acc, ent.pointKind, ent.amount);
        changed = true;
      }
    }
  }

  const next = {
    heart: clampPoints(acc.heart),
    mana: clampPoints(acc.mana),
    appliedStepRewardIds: [...applied],
  };
  if (
    next.heart !== state.heart ||
    next.mana !== state.mana ||
    next.appliedStepRewardIds.length !== state.appliedStepRewardIds.length
  ) {
    changed = true;
  }
  return { state: next, changed };
}
