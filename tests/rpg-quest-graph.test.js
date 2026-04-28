/**
 * Tests fuer rpg-quest-graph.js — Graph-Operationen, Unlock, Zyklen, Upsert.
 *
 * Deckt ab:
 * - isValidGraphShape (Form-Pruefung)
 * - questMap (ID->Node Map)
 * - buildIncomingMap (Dependency-Graph)
 * - isQuestUnlocked (Freischaltung durch Vorgaenger)
 * - questProgress (lokal vs. aggregiert)
 * - upsertQuestInGraph / removeQuestFromGraph (Mutation)
 * - buildInitialNodeMapFromGraph (initiales nodeDone)
 * - mergeNodeDoneBase (Server/Local Merge)
 * - graphHasCycle (Zyklen-Erkennung)
 * - sanitizeAddedIds (Filter fuer added-IDs)
 * - validateNodeDone (Tiefe Struktur-Validierung)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph, graphNodes, graphEdges } from '../src/lib/rpg-quests-data.js';
import {
  isValidGraphShape,
  questMap,
  buildIncomingMap,
  isQuestUnlocked,
  questProgress,
  isQuestCompleted,
  upsertQuestInGraph,
  removeQuestFromGraph,
  buildInitialNodeMapFromGraph,
  mergeNodeDoneBase,
  graphHasCycle,
  sanitizeAddedIds,
  validateNodeDone,
} from '../src/lib/rpg-quest-graph.js';

// --- Hilfsfunktionen ---

function quest(id, children = [], extras = {}) {
  return { id, parentId: null, title: id, children, ...extras };
}

function leaf(id, extras = {}) {
  return { id, parentId: null, title: id, children: [], ...extras };
}

function depEdge(from, to) {
  return { from, to, relation: 'dependency' };
}

// =============================================================================
// isValidGraphShape
// =============================================================================

test('isValidGraphShape akzeptiert kanonische Graph-Form', () => {
  assert.equal(isValidGraphShape({ nodes: [], edges: [] }), true);
  assert.equal(isValidGraphShape(makeRpgGraph([], [])), true);
});

test('isValidGraphShape akzeptiert Legacy quests-Feld', () => {
  assert.equal(isValidGraphShape({ quests: [], edges: [] }), true);
});

test('isValidGraphShape akzeptiert Legacy nodesById', () => {
  assert.equal(isValidGraphShape({ nodesById: {}, edges: [] }), true);
});

test('isValidGraphShape lehnt ungueltige Formen ab', () => {
  assert.equal(isValidGraphShape(null), false);
  assert.equal(isValidGraphShape(undefined), false);
  assert.equal(isValidGraphShape('string'), false);
  assert.equal(isValidGraphShape({}), false);
  assert.equal(isValidGraphShape({ nodes: [] }), false); // edges fehlt
  assert.equal(isValidGraphShape({ edges: [] }), false); // nodes fehlt
});

// =============================================================================
// questMap
// =============================================================================

test('questMap baut Map aus Graph-Nodes', () => {
  const g = makeRpgGraph([quest('q1'), quest('q2')], []);
  const m = questMap(g);
  assert.equal(m.size, 2);
  assert.equal(m.get('q1').id, 'q1');
  assert.equal(m.get('q2').id, 'q2');
});

// =============================================================================
// buildIncomingMap
// =============================================================================

test('buildIncomingMap baut Dependency-Map', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2'), quest('q3')],
    [depEdge('q1', 'q2'), depEdge('q1', 'q3')]
  );
  const inc = buildIncomingMap(g);
  assert.deepStrictEqual(inc.get('q1'), []);
  assert.deepStrictEqual(inc.get('q2'), ['q1']);
  assert.deepStrictEqual(inc.get('q3'), ['q1']);
});

test('buildIncomingMap ignoriert structure-Kanten', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2')],
    [{ from: 'q1', to: 'q2', relation: 'structure' }]
  );
  const inc = buildIncomingMap(g);
  assert.deepStrictEqual(inc.get('q2'), []);
});

// =============================================================================
// isQuestUnlocked
// =============================================================================

test('isQuestUnlocked: Root ohne Vorgaenger ist immer unlocked', () => {
  const g = makeRpgGraph([quest('q1', [leaf('a')])], []);
  const byId = questMap(g);
  assert.equal(isQuestUnlocked('q1', g, {}, byId), true);
});

test('isQuestUnlocked: Quest mit unfertiger Dependency ist locked', () => {
  const g = makeRpgGraph(
    [quest('q1', [leaf('a')]), quest('q2', [leaf('b')])],
    [depEdge('q1', 'q2')]
  );
  const byId = questMap(g);
  // q1 nicht erledigt -> q2 ist locked
  assert.equal(isQuestUnlocked('q2', g, { q1: {} }, byId), false);
});

test('isQuestUnlocked: Quest mit fertiger Dependency ist unlocked', () => {
  const g = makeRpgGraph(
    [quest('q1', [leaf('a')]), quest('q2', [leaf('b')])],
    [depEdge('q1', 'q2')]
  );
  const byId = questMap(g);
  // q1 erledigt -> q2 ist unlocked
  assert.equal(isQuestUnlocked('q2', g, { q1: { a: true } }, byId), true);
});

// =============================================================================
// questProgress
// =============================================================================

test('questProgress ohne Graph nutzt lokale Children', () => {
  const q = quest('q1', [leaf('a'), leaf('b')]);
  assert.equal(questProgress(q, { q1: { a: true } }, null), 50);
});

test('questProgress mit Graph nutzt aggregierten Fortschritt', () => {
  const g = makeRpgGraph(
    [quest('q1', [leaf('a')]), quest('q2', [leaf('b')])],
    [depEdge('q1', 'q2')]
  );
  const q2 = graphNodes(g).find((q) => q.id === 'q2');
  // Aggregiert: q1 hat 1 Blatt (a), q2 hat 1 Blatt (b) -> 2 total
  const pct = questProgress(q2, { q1: { a: true }, q2: {} }, g);
  assert.equal(pct, 50);
});

// =============================================================================
// isQuestCompleted
// =============================================================================

test('isQuestCompleted prueft alle Pflichtblaetter', () => {
  const q = quest('q1', [leaf('a'), leaf('b')]);
  assert.equal(isQuestCompleted(q, { q1: { a: true, b: true } }), true);
  assert.equal(isQuestCompleted(q, { q1: { a: true } }), false);
});

// =============================================================================
// upsertQuestInGraph / removeQuestFromGraph
// =============================================================================

test('upsertQuestInGraph fuegt neuen Node hinzu', () => {
  const g = makeRpgGraph([quest('q1')], []);
  const next = upsertQuestInGraph(g, quest('q2'), ['q1']);
  assert.equal(graphNodes(next).length, 2);
  // Dependency-Kante q1 -> q2
  const deps = graphEdges(next).filter((e) => e.relation === 'dependency');
  assert.equal(deps.length, 1);
  assert.equal(deps[0].from, 'q1');
  assert.equal(deps[0].to, 'q2');
});

test('upsertQuestInGraph updated existierenden Node', () => {
  const g = makeRpgGraph([quest('q1', [leaf('a')])], []);
  const updated = quest('q1', [leaf('a'), leaf('b')]);
  const next = upsertQuestInGraph(g, updated, []);
  assert.equal(graphNodes(next).length, 1);
  assert.equal(graphNodes(next)[0].children.length, 2);
});

test('upsertQuestInGraph ignoriert Self-Dependency', () => {
  const g = makeRpgGraph([], []);
  const next = upsertQuestInGraph(g, quest('q1'), ['q1']);
  // Keine Kanten, weil Self-Dependency gefiltert wird
  assert.equal(graphEdges(next).filter((e) => e.relation === 'dependency').length, 0);
});

test('removeQuestFromGraph entfernt Node und Kanten', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2'), quest('q3')],
    [depEdge('q1', 'q2'), depEdge('q2', 'q3')]
  );
  const next = removeQuestFromGraph(g, 'q2');
  assert.equal(graphNodes(next).length, 2);
  // Alle Kanten mit q2 muessen weg sein
  const remaining = graphEdges(next);
  assert.ok(remaining.every((e) => e.from !== 'q2' && e.to !== 'q2'));
});

// =============================================================================
// buildInitialNodeMapFromGraph
// =============================================================================

test('buildInitialNodeMapFromGraph liest done-Flags aus Nodes', () => {
  const g = makeRpgGraph([
    quest('q1', [
      { id: 'a', parentId: 'q1', title: 'A', children: [], done: true },
      { id: 'b', parentId: 'q1', title: 'B', children: [] },
    ]),
  ], []);
  const m = buildInitialNodeMapFromGraph(g);
  assert.equal(m.q1.a, true);
  assert.equal(m.q1.b, undefined);
});

// =============================================================================
// mergeNodeDoneBase
// =============================================================================

test('mergeNodeDoneBase merged Server mit lokal', () => {
  const server = { q1: { a: true } };
  const local = { q1: { b: true }, q2: { c: true } };
  const merged = mergeNodeDoneBase(server, local);
  assert.deepStrictEqual(merged.q1, { a: true, b: true });
  assert.deepStrictEqual(merged.q2, { c: true });
});

test('mergeNodeDoneBase: lokal ueberschreibt Server', () => {
  const server = { q1: { a: true } };
  const local = { q1: { a: false } };
  const merged = mergeNodeDoneBase(server, local);
  assert.equal(merged.q1.a, false);
});

// =============================================================================
// graphHasCycle
// =============================================================================

test('graphHasCycle erkennt keinen Zyklus im DAG', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2'), quest('q3')],
    [depEdge('q1', 'q2'), depEdge('q2', 'q3')]
  );
  assert.equal(graphHasCycle(g), false);
});

test('graphHasCycle erkennt einfachen Zyklus', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2')],
    [depEdge('q1', 'q2'), depEdge('q2', 'q1')]
  );
  assert.equal(graphHasCycle(g), true);
});

test('graphHasCycle erkennt indirekten Zyklus', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2'), quest('q3')],
    [depEdge('q1', 'q2'), depEdge('q2', 'q3'), depEdge('q3', 'q1')]
  );
  assert.equal(graphHasCycle(g), true);
});

test('graphHasCycle ignoriert structure-Kanten', () => {
  const g = makeRpgGraph(
    [quest('q1'), quest('q2')],
    [
      { from: 'q1', to: 'q2', relation: 'structure' },
      { from: 'q2', to: 'q1', relation: 'structure' },
    ]
  );
  // Structure-Kanten bilden keinen Zyklus im Dependency-Graph
  assert.equal(graphHasCycle(g), false);
});

test('graphHasCycle: leerer Graph hat keinen Zyklus', () => {
  const g = makeRpgGraph([], []);
  assert.equal(graphHasCycle(g), false);
});

// =============================================================================
// sanitizeAddedIds
// =============================================================================

test('sanitizeAddedIds behaelt nur unlocked und nicht-completed IDs', () => {
  const g = makeRpgGraph(
    [
      quest('q1', [leaf('a')]),  // completed
      quest('q2', [leaf('b')]),  // unlocked, nicht completed
      quest('q3', [leaf('c')]),  // locked (dep auf q1 nicht erfuellt... nein, q1 ist completed)
    ],
    [depEdge('q1', 'q2'), depEdge('q2', 'q3')]
  );
  const nodeDone = { q1: { a: true }, q2: {}, q3: {} };
  const added = new Set(['q1', 'q2', 'q3']);
  const result = sanitizeAddedIds(added, g, nodeDone);
  // q1 ist completed -> raus
  assert.equal(result.has('q1'), false);
  // q2 ist unlocked (q1 done) und nicht completed -> drin
  assert.equal(result.has('q2'), true);
  // q3 ist locked (q2 nicht done) -> raus
  assert.equal(result.has('q3'), false);
});

test('sanitizeAddedIds ignoriert unbekannte IDs', () => {
  const g = makeRpgGraph([quest('q1', [leaf('a')])], []);
  const result = sanitizeAddedIds(new Set(['q1', 'q-missing']), g, { q1: {} });
  assert.equal(result.has('q-missing'), false);
});

// =============================================================================
// validateNodeDone
// =============================================================================

test('validateNodeDone akzeptiert gueltige Struktur', () => {
  const r = validateNodeDone({ q1: { a: true, b: false }, q2: {} });
  assert.equal(r.ok, true);
  assert.deepStrictEqual(r.value, { q1: { a: true, b: false }, q2: {} });
});

test('validateNodeDone akzeptiert leeres Objekt', () => {
  const r = validateNodeDone({});
  assert.equal(r.ok, true);
});

test('validateNodeDone lehnt null/undefined/Array ab', () => {
  assert.equal(validateNodeDone(null).ok, false);
  assert.equal(validateNodeDone(undefined).ok, false);
  assert.equal(validateNodeDone([]).ok, false);
  assert.equal(validateNodeDone('string').ok, false);
});

test('validateNodeDone lehnt nicht-Object innere Werte ab', () => {
  const r = validateNodeDone({ q1: 'invalid' });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('q1'));
});

test('validateNodeDone lehnt nicht-boolean Blatt-Werte ab', () => {
  const r = validateNodeDone({ q1: { a: 'yes' } });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('boolean'));
});

test('validateNodeDone lehnt Array als inneren Wert ab', () => {
  const r = validateNodeDone({ q1: [true, false] });
  assert.equal(r.ok, false);
});

test('validateNodeDone lehnt verschachtelte Objekte ab (nur 2 Ebenen erlaubt)', () => {
  // Zahlenwerte statt boolean -> muss fehlschlagen
  const r = validateNodeDone({ q1: { a: 42 } });
  assert.equal(r.ok, false);
});
