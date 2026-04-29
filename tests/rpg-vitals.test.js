/**
 * Tests fuer rpg-vitals.js — insbesondere reconcileRpgVitals.
 *
 * reconcileRpgVitals ist der kritischste Buchungspfad im RPG-System:
 * Er bestimmt, wann Heart-/Mana-Punkte gebucht werden und stellt sicher,
 * dass jeder Reward genau einmal gebucht wird (Idempotenz).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import {
  reconcileRpgVitals,
  normalizeRpgVitalsState,
  gainHeartEnergy,
  gainManaEnergy,
  applyPointsReward,
  RPG_VITAL_MAX_POINTS,
  RPG_VITAL_BASE_HEART,
  RPG_VITAL_BASE_MANA,
} from '../src/lib/rpg-vitals.js';

// -- Hilfs-Factories fuer Test-Quests --

/** Erstellt eine minimale Quest mit children. */
function makeQuest(id, children, rewards) {
  return {
    id,
    parentId: null,
    title: id,
    description: '',
    children,
    ...(rewards ? { rewards } : {}),
  };
}

/** Erstellt einen Leaf-Node mit optionalem Points-Reward. */
function leafNode(id, parentId, reward) {
  return {
    id,
    parentId,
    title: id,
    children: [],
    // Einzelnes Reward als Array wrappen (kanonisches Format)
    ...(reward ? { rewards: [reward] } : {}),
  };
}

/** Frischer Vitals-State (Default: heart=25, mana=25). */
function freshVitals() {
  return normalizeRpgVitalsState(null);
}

// ============================================================
// normalizeRpgVitalsState
// ============================================================

test('normalizeRpgVitalsState returns defaults for null', () => {
  const v = normalizeRpgVitalsState(null);
  assert.equal(v.heart, RPG_VITAL_BASE_HEART);
  assert.equal(v.mana, RPG_VITAL_BASE_MANA);
  assert.deepEqual(v.appliedNodeRewardIds, []);
});

test('normalizeRpgVitalsState clamps values to 0..50', () => {
  const v = normalizeRpgVitalsState({ heart: -10, mana: 999 });
  assert.equal(v.heart, 0);
  assert.equal(v.mana, RPG_VITAL_MAX_POINTS);
});

test('normalizeRpgVitalsState migriert V2-Schluessel auf das Phase-2-Format', () => {
  // Phase-2-Migration: alte Schluessel werden idempotent transformiert.
  //   node:<questId>:<nodeId>     -> node:<nodeId>
  //   quest:<questId>:reward:<i>  -> node:<questId>:reward:<i>
  const v = normalizeRpgVitalsState({
    heart: 30,
    mana: 20,
    appliedNodeRewardIds: ['node:q1:a', 'quest:q1:reward:0'],
  });
  assert.equal(v.heart, 30);
  assert.equal(v.mana, 20);
  assert.deepEqual(v.appliedNodeRewardIds, ['node:a', 'node:q1:reward:0']);
});

test('normalizeRpgVitalsState ist idempotent fuer bereits migrierte Phase-2-Schluessel', () => {
  const v = normalizeRpgVitalsState({
    heart: 25,
    mana: 25,
    appliedNodeRewardIds: ['node:a', 'node:q1:reward:0'],
  });
  assert.deepEqual(v.appliedNodeRewardIds, ['node:a', 'node:q1:reward:0']);
});

test('normalizeRpgVitalsState reads legacy appliedRewardIds und migriert ebenfalls', () => {
  const v = normalizeRpgVitalsState({
    heart: 25,
    mana: 25,
    appliedRewardIds: ['node:q1:a'],
  });
  // Migration: node:q1:a -> node:a
  assert.deepEqual(v.appliedNodeRewardIds, ['node:a']);
});

test('normalizeRpgVitalsState dedupliziert nach Migration (zwei V2-Keys -> ein V3-Key)', () => {
  // Zwei verschiedene Quests, derselbe nodeId — V2 hatte unterschiedliche Keys,
  // V3 bekommt einen Key. Der zweite wird verworfen (Idempotenz beim ersten Trip).
  const v = normalizeRpgVitalsState({
    heart: 25,
    mana: 25,
    appliedNodeRewardIds: ['node:q1:shared', 'node:q2:shared'],
  });
  assert.deepEqual(v.appliedNodeRewardIds, ['node:shared']);
});

// ============================================================
// gainHeartEnergy / gainManaEnergy / applyPointsReward
// ============================================================

test('gainHeartEnergy adds positive amount and clamps at max', () => {
  const state = freshVitals();
  const after = gainHeartEnergy(state, 30);
  // 25 + 30 = 55, aber max ist 50
  assert.equal(after.heart, RPG_VITAL_MAX_POINTS);
  assert.equal(after.mana, state.mana); // mana unveraendert
});

test('gainManaEnergy drains with negative amount and clamps at 0', () => {
  const state = freshVitals();
  const after = gainManaEnergy(state, -100);
  assert.equal(after.mana, 0);
  assert.equal(after.heart, state.heart); // heart unveraendert
});

test('applyPointsReward routes heart and mana correctly', () => {
  const state = freshVitals();
  const afterHeart = applyPointsReward(state, 'heart', 5);
  assert.equal(afterHeart.heart, 30);
  assert.equal(afterHeart.mana, 25);

  const afterMana = applyPointsReward(state, 'mana', -5);
  assert.equal(afterMana.heart, 25);
  assert.equal(afterMana.mana, 20);
});

test('gainHeartEnergy ignores NaN/Infinity amounts', () => {
  const state = freshVitals();
  assert.equal(gainHeartEnergy(state, NaN).heart, state.heart);
  assert.equal(gainHeartEnergy(state, Infinity).heart, state.heart);
  assert.equal(gainManaEnergy(state, undefined).mana, state.mana);
});

// ============================================================
// reconcileRpgVitals — Node-Rewards
// ============================================================

test('reconcileRpgVitals: no rewards → no change', () => {
  // Graph mit Nodes ohne Rewards
  const graph = makeRpgGraph(
    [makeQuest('q1', [leafNode('a', 'q1')])],
    []
  );
  const nodeDone = { q1: { a: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, false);
  assert.equal(result.state.heart, RPG_VITAL_BASE_HEART);
  assert.equal(result.state.mana, RPG_VITAL_BASE_MANA);
});

test('reconcileRpgVitals: node with heart reward, node done → reward applied', () => {
  // Node mit +5 Heart Reward
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 5 }),
    ])],
    []
  );
  // Phase 2: nodeDone ist flach (Record<nodeId, boolean>)
  const nodeDone = { a: true };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, true);
  assert.equal(result.state.heart, 30); // 25 + 5
  assert.equal(result.state.mana, RPG_VITAL_BASE_MANA);
  // Phase 2: Key ohne questId-Praefix
  assert.ok(result.state.appliedNodeRewardIds.includes('node:a'));
});

test('reconcileRpgVitals: node NOT done → reward NOT applied', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('a', 'q1', { type: 'points', pointKind: 'mana', amount: 10 }),
    ])],
    []
  );
  const nodeDone = { q1: {} }; // a ist nicht done
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, false);
  assert.equal(result.state.mana, RPG_VITAL_BASE_MANA);
});

test('reconcileRpgVitals: idempotent — zweiter Aufruf aendert nichts', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 3 }),
    ])],
    []
  );
  const nodeDone = { q1: { a: true } };

  // Erster Aufruf: Reward wird gebucht
  const first = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(first.changed, true);
  assert.equal(first.state.heart, 28);

  // Zweiter Aufruf mit Ergebnis des ersten: keine Aenderung
  const second = reconcileRpgVitals(graph, nodeDone, first.state);
  assert.equal(second.changed, false);
  assert.equal(second.state.heart, 28);
});

test('reconcileRpgVitals: already applied reward key → skipped', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 5 }),
    ])],
    []
  );
  const nodeDone = { q1: { a: true } };
  // State hat den Key schon → wird nicht erneut gebucht
  const preApplied = normalizeRpgVitalsState({
    heart: 30,
    mana: 25,
    appliedNodeRewardIds: ['node:q1:a'],
  });
  const result = reconcileRpgVitals(graph, nodeDone, preApplied);
  assert.equal(result.changed, false);
  assert.equal(result.state.heart, 30); // unveraendert, nicht 35
});

test('reconcileRpgVitals: multiple node rewards accumulated', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 3 }),
      leafNode('b', 'q1', { type: 'points', pointKind: 'mana', amount: -2 }),
    ])],
    []
  );
  // Phase 2: flaches nodeDone
  const nodeDone = { a: true, b: true };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, true);
  assert.equal(result.state.heart, 28); // 25 + 3
  assert.equal(result.state.mana, 23); // 25 - 2
  // Phase 2: Keys ohne questId
  assert.ok(result.state.appliedNodeRewardIds.includes('node:a'));
  assert.ok(result.state.appliedNodeRewardIds.includes('node:b'));
});

test('reconcileRpgVitals: clamping at 0 and 50', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1', [
      leafNode('drain', 'q1', { type: 'points', pointKind: 'mana', amount: -999 }),
      leafNode('overflow', 'q1', { type: 'points', pointKind: 'heart', amount: 999 }),
    ])],
    []
  );
  const nodeDone = { q1: { drain: true, overflow: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.state.mana, 0);
  assert.equal(result.state.heart, RPG_VITAL_MAX_POINTS);
});

// ============================================================
// reconcileRpgVitals — Quest-Rewards
// ============================================================

test('reconcileRpgVitals: quest reward applied when quest completed', () => {
  // Quest mit einem Leaf + Quest-Level Points Reward.
  // rewards werden als flache Objekte gespeichert (nicht { entry: ... }),
  // normalizeRewardRow baut daraus das { entry, unlockAtPercent? } Objekt.
  const graph = makeRpgGraph(
    [makeQuest('q1',
      [leafNode('a', 'q1')],
      [{ type: 'points', pointKind: 'mana', amount: 7 }]
    )],
    []
  );
  // Phase 2: flaches nodeDone
  const nodeDone = { a: true };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, true);
  assert.equal(result.state.mana, 32); // 25 + 7
  // Phase 2: 'quest:<id>:reward:<i>' wurde durch 'node:<id>:reward:<i>' ersetzt
  assert.ok(result.state.appliedNodeRewardIds.includes('node:q1:reward:0'));
});

test('reconcileRpgVitals: quest reward NOT applied when quest incomplete', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1',
      [leafNode('a', 'q1'), leafNode('b', 'q1')],
      [{ type: 'points', pointKind: 'heart', amount: 10 }]
    )],
    []
  );
  // Nur 'a' done, 'b' offen → Quest nicht complete
  const nodeDone = { q1: { a: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.state.heart, RPG_VITAL_BASE_HEART);
  // Quest-Reward darf nicht gebucht sein
  assert.ok(!result.state.appliedNodeRewardIds.includes('quest:q1:reward:0'));
});

test('reconcileRpgVitals: combined node + quest rewards', () => {
  // Node Reward (+3 heart) + Quest Reward (+4 mana)
  const graph = makeRpgGraph(
    [makeQuest('q1',
      [leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 3 })],
      [{ type: 'points', pointKind: 'mana', amount: 4 }]
    )],
    []
  );
  const nodeDone = { q1: { a: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.changed, true);
  assert.equal(result.state.heart, 28); // 25 + 3
  assert.equal(result.state.mana, 29); // 25 + 4
  assert.equal(result.state.appliedNodeRewardIds.length, 2);
});

test('reconcileRpgVitals: text rewards are ignored (only points matter)', () => {
  const graph = makeRpgGraph(
    [makeQuest('q1',
      [leafNode('a', 'q1', { type: 'text', text: 'Toll gemacht!' })],
      [{ type: 'text', text: 'Titel: Held' }]
    )],
    []
  );
  const nodeDone = { q1: { a: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  // Text-Rewards haben keinen Einfluss auf Vitals
  assert.equal(result.state.heart, RPG_VITAL_BASE_HEART);
  assert.equal(result.state.mana, RPG_VITAL_BASE_MANA);
});

test('reconcileRpgVitals: empty graph → no change', () => {
  const graph = makeRpgGraph([], []);
  const result = reconcileRpgVitals(graph, {}, freshVitals());
  assert.equal(result.changed, false);
});

test('reconcileRpgVitals: multiple quests with independent rewards', () => {
  const graph = makeRpgGraph(
    [
      makeQuest('q1', [
        leafNode('a', 'q1', { type: 'points', pointKind: 'heart', amount: 2 }),
      ]),
      makeQuest('q2', [
        leafNode('b', 'q2', { type: 'points', pointKind: 'mana', amount: 3 }),
      ]),
    ],
    []
  );
  const nodeDone = { q1: { a: true }, q2: { b: true } };
  const result = reconcileRpgVitals(graph, nodeDone, freshVitals());
  assert.equal(result.state.heart, 27); // 25 + 2
  assert.equal(result.state.mana, 28); // 25 + 3
  assert.equal(result.state.appliedNodeRewardIds.length, 2);
});
