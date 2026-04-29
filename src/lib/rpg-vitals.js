import {
  walkNodesPreOrder,
  isNodeCompleteInQuest,
  getNodeRewardRows,
} from './rpg-quest-nodes.js';
import { isQuestCompleted } from './rpg-quest-graph.js';
import { graphNodes } from './rpg-quests-data.js';

export const RPG_VITAL_MAX_POINTS = 50;
export const RPG_VITAL_BASE_HEART = 25;
export const RPG_VITAL_BASE_MANA = 25;

/**
 * @typedef {{
 *   heart: number;
 *   mana: number;
 *   appliedNodeRewardIds: string[];
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
 * Migriert einen einzelnen appliedNodeRewardId-Key vom V2-Format zu Phase-2-V3.
 *
 * Mapping:
 *   - `node:<questId>:<nodeId>`         → `node:<nodeId>`
 *   - `node:<questId>:<nodeId>:<idx>`   → `node:<nodeId>:<idx>`
 *   - `quest:<questId>:reward:<idx>`    → `node:<questId>:reward:<idx>`
 *     (im DAG ist die "Quest" ein normaler Node — Reward-Buchung gehoert zu ihm)
 *   - alles andere bleibt unveraendert (idempotent fuer bereits migrierte Keys).
 *
 * @param {string} key
 * @returns {string}
 */
function migrateAppliedRewardKey(key) {
  if (typeof key !== 'string' || !key) return key;
  if (key.startsWith('quest:')) {
    // 'quest:<questId>:reward:<idx>' → 'node:<questId>:reward:<idx>'
    const parts = key.split(':');
    if (parts.length === 4 && parts[2] === 'reward') {
      return `node:${parts[1]}:reward:${parts[3]}`;
    }
    return key;
  }
  if (key.startsWith('node:')) {
    const parts = key.split(':');
    // Format-Erkennung:
    //   V2-single: node:<questId>:<nodeId>             (3 Teile, letztes nicht-numerisch)
    //   V2-multi:  node:<questId>:<nodeId>:<idx>       (4 Teile, letztes numerisch)
    //   V3-single: node:<nodeId>                        (2 Teile)
    //   V3-multi:  node:<nodeId>:<idx>                  (3 Teile, letztes numerisch)
    //   V3-quest:  node:<nodeId>:reward:<idx>           (4 Teile, parts[2] === 'reward')
    //
    // Spezialfall: parts[2] === 'reward' bedeutet immer V3-Quest-Reward — bleibt unveraendert.
    if (parts.length === 4 && parts[2] === 'reward') {
      return key; // V3-quest-Reward, bereits korrekt
    }
    if (parts.length === 4) {
      const last = parts[3];
      if (/^\d+$/.test(last)) {
        // V2-multi: node:<questId>:<nodeId>:<idx> → node:<nodeId>:<idx>
        return `node:${parts[2]}:${parts[3]}`;
      }
      return key;
    }
    if (parts.length === 3) {
      const last = parts[2];
      if (!/^\d+$/.test(last)) {
        // V2-single: node:<questId>:<nodeId> → node:<nodeId>
        return `node:${parts[2]}`;
      }
      // bereits V3-multi
      return key;
    }
    return key;
  }
  return key;
}

/**
 * @param {unknown} raw
 * @returns {RpgVitalsState}
 */
export function normalizeRpgVitalsState(raw) {
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const heart = clampPoints(typeof o.heart === 'number' ? o.heart : RPG_VITAL_BASE_HEART);
  const mana = clampPoints(typeof o.mana === 'number' ? o.mana : RPG_VITAL_BASE_MANA);
  const rawApplied = Array.isArray(o.appliedNodeRewardIds)
    ? o.appliedNodeRewardIds
    : Array.isArray(o.appliedRewardIds)
      ? o.appliedRewardIds
      : [];
  // Phase-2-Migration: alte Keys auf das neue Schema heben.
  // Idempotent — bereits migrierte Keys bleiben unveraendert.
  const seen = new Set();
  /** @type {string[]} */
  const appliedNodeRewardIds = [];
  for (const x of rawApplied) {
    if (typeof x !== 'string' || !x.trim()) continue;
    const migrated = migrateAppliedRewardKey(x.trim());
    if (seen.has(migrated)) continue;
    seen.add(migrated);
    appliedNodeRewardIds.push(migrated);
  }
  return { heart, mana, appliedNodeRewardIds };
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
 * Schreibt genau einmal gut, sobald ein Node mit points-Reward erledigt ist.
 * Kein automatisches Zurückbuchen beim Ent-Haken.
 *
 * Phase 2: nodeDone ist flach. Alle Reward-Keys leben jetzt im einheitlichen
 * Namespace `node:<nodeId>` bzw. `node:<nodeId>:<idx>`. Der frueher
 * verwendete Quest-Key (`quest:<id>:reward:<i>`) wurde durch
 * `node:<id>:reward:<i>` ersetzt — die "Quest" ist im DAG nur ein Node ohne
 * Parent.
 *
 * @param {import('./rpg-quests-data.js').RpgGraph} graph
 * @param {Record<string, unknown>} nodeDone — flach (V3) oder verschachtelt (V2-Compat)
 * @param {unknown} rawState
 * @returns {{ state: RpgVitalsState; changed: boolean }}
 */
export function reconcileRpgVitals(graph, nodeDone, rawState) {
  const state = normalizeRpgVitalsState(rawState);
  const applied = new Set(state.appliedNodeRewardIds);
  let changed = false;
  /** @type {RpgVitalsState} */
  let acc = {
    heart: state.heart,
    mana: state.mana,
    appliedNodeRewardIds: state.appliedNodeRewardIds,
  };

  for (const q of graphNodes(graph)) {
    walkNodesPreOrder(q.children || [], (s) => {
      // Einheitlich via getNodeRewardRows — liest sowohl 'rewards' (kanonisch) als auch
      // Legacy-Felder ('questRewards', 'reward').
      const subRows = getNodeRewardRows(s);
      for (let ri = 0; ri < subRows.length; ri++) {
        const ent = subRows[ri]?.entry;
        if (!ent || ent.type !== 'points') continue;
        if (!isNodeCompleteInQuest(q, s.id, nodeDone)) continue;
        // Phase-2-Key: kein questId-Praefix mehr. Single-Reward bleibt ohne Index,
        // multi-Reward bekommt den Index-Suffix.
        const key = subRows.length === 1 && ri === 0
          ? `node:${s.id}`
          : `node:${s.id}:${ri}`;
        if (applied.has(key)) continue;
        applied.add(key);
        acc = applyPointsReward(acc, ent.pointKind, ent.amount);
        changed = true;
      }
    });

    if (isQuestCompleted(q, nodeDone)) {
      const rows = getNodeRewardRows(q);
      for (let i = 0; i < rows.length; i++) {
        const ent = rows[i]?.entry;
        if (!ent || ent.type !== 'points') continue;
        // Phase-2-Key: 'quest:<id>:reward:<i>' → 'node:<id>:reward:<i>'.
        // Im DAG ist die "Quest" ein Node, also gehoert die Reward-Buchung
        // in den node-Namespace.
        const key = `node:${q.id}:reward:${i}`;
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
    appliedNodeRewardIds: [...applied],
  };
  if (
    next.heart !== state.heart ||
    next.mana !== state.mana ||
    next.appliedNodeRewardIds.length !== state.appliedNodeRewardIds.length
  ) {
    changed = true;
  }
  return { state: next, changed };
}
