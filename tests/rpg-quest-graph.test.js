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
import { makeRpgGraph, graphNodes, graphEdges, isParentChildRelation } from '../src/lib/rpg-quests-data.js';
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
  setNodePosition,
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

test('questMap differenziert Quests mit identischem Titel ueber die ID', () => {
  const g = makeRpgGraph(
    [
      quest('q-alpha', [leaf('a')], { title: 'Zentrale' }),
      quest('q-beta', [leaf('b')], { title: 'Zentrale' }),
    ],
    [depEdge('q-alpha', 'q-beta')]
  );
  const m = questMap(g);
  assert.equal(m.size, 2);
  assert.equal(m.get('q-alpha').title, 'Zentrale');
  assert.equal(m.get('q-beta').title, 'Zentrale');
  // Die Dependency muss trotz gleichem Titel strikt per ID aufgeloest werden.
  const inc = buildIncomingMap(g);
  assert.deepStrictEqual(inc.get('q-beta'), ['q-alpha']);
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

test('upsertQuestInGraph ergänzt structure-Edges aus nested children', () => {
  // Regression: wenn ein Node mit Children upserted wird, müssen die
  // parent->child-Kanten explizit in edges auftauchen, damit Rebuilds den
  // Subtree nicht verlieren.
  const g = makeRpgGraph([], []);
  const next = upsertQuestInGraph(
    g,
    quest('q1', [leaf('a'), leaf('b')]),
    []
  );
  const structure = graphEdges(next).filter(isParentChildRelation).map((e) => `${e.from}->${e.to}`).sort();
  assert.deepStrictEqual(structure, ['q1->a', 'q1->b']);
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

test('buildInitialNodeMapFromGraph liest done-Flags aus Nodes (flach, Phase 2)', () => {
  const g = makeRpgGraph([
    quest('q1', [
      { id: 'a', parentId: 'q1', title: 'A', children: [], done: true },
      { id: 'b', parentId: 'q1', title: 'B', children: [] },
    ]),
  ], []);
  const m = buildInitialNodeMapFromGraph(g);
  // Phase 2: flaches Format — Schluessel ist die Node-ID, nicht die Quest-ID
  assert.equal(m.a, true);
  assert.equal(m.b, undefined);
});

// =============================================================================
// mergeNodeDoneBase (Phase 2: flaches Format)
// =============================================================================

test('mergeNodeDoneBase merged Server mit lokal (flach)', () => {
  // Phase 2: flaches Format Record<nodeId, boolean>
  const server = { a: true };
  const local = { b: true, c: true };
  const merged = mergeNodeDoneBase(server, local);
  assert.equal(merged.a, true);
  assert.equal(merged.b, true);
  assert.equal(merged.c, true);
});

test('mergeNodeDoneBase: lokal ueberschreibt Server (flach)', () => {
  // Phase 2: flach. Wegen flach-only Speicherung (nur true) verliert der
  // Server-Eintrag fuer 'a' nicht — local has nothing for 'a'.
  const server = { a: true };
  const local = { b: true };
  const merged = mergeNodeDoneBase(server, local);
  assert.equal(merged.a, true);
  assert.equal(merged.b, true);
});

test('mergeNodeDoneBase akzeptiert verschachtelten V2-Input und flacht ab', () => {
  // V2-Compat: Mischformen werden idempotent flach.
  const server = { q1: { a: true } };
  const local = { q1: { b: true } };
  const merged = mergeNodeDoneBase(server, local);
  assert.equal(merged.a, true);
  assert.equal(merged.b, true);
  // Quest-ID darf nicht als Top-Level-Eintrag mehr auftauchen
  assert.equal(merged.q1, undefined);
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

test('validateNodeDone akzeptiert flache Struktur (Phase 2)', () => {
  // Phase 2: flaches Format — nur Top-Level boolean
  const r = validateNodeDone({ a: true, b: false });
  assert.equal(r.ok, true);
  // false-Eintraege werden nicht uebernommen — nur true bleibt erhalten
  assert.deepStrictEqual(r.value, { a: true });
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

test('validateNodeDone lehnt verschachtelte (V2) Eingabe ab', () => {
  // Phase 2: erwartet flach. Verschachtelte Eingabe muss VORHER via
  // migrateNodeDoneToFlat flach gemacht werden (Server tut das).
  const r = validateNodeDone({ q1: { a: 'yes' } });
  assert.equal(r.ok, false);
});

test('validateNodeDone lehnt nicht-boolean Werte ab', () => {
  const r = validateNodeDone({ a: 'yes' });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('boolean'));
});

test('validateNodeDone lehnt Object-Werte als Top-Level ab (Phase 2 erwartet flach)', () => {
  const r = validateNodeDone({ q1: [true, false] });
  assert.equal(r.ok, false);
});

// =============================================================================
// setNodePosition (Drag-and-Drop, 2026-05-04)
// =============================================================================

test('setNodePosition setzt x/y auf einen Top-Level-Node', () => {
  const g = makeRpgGraph(
    { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
    []
  );
  const next = setNodePosition(g, 'a', 100, 200);
  const a = graphNodes(next).find((n) => n.id === 'a');
  assert.equal(a.x, 100);
  assert.equal(a.y, 200);
  // Andere Nodes unveraendert
  const b = graphNodes(next).find((n) => n.id === 'b');
  assert.equal(b.x, undefined);
  assert.equal(b.y, undefined);
});

test('setNodePosition mit null/undefined entfernt x/y (Reset auf Auto-Layout)', () => {
  const g = makeRpgGraph(
    { a: { id: 'a', title: 'A', x: 50, y: 60 } },
    []
  );
  const cleared = setNodePosition(g, 'a', null, null);
  const a = graphNodes(cleared).find((n) => n.id === 'a');
  assert.equal(a.x, undefined);
  assert.equal(a.y, undefined);
});

test('setNodePosition mit NaN/Infinity entfernt x/y (defensiv)', () => {
  const g = makeRpgGraph(
    { a: { id: 'a', title: 'A', x: 50, y: 60 } },
    []
  );
  const cleared = setNodePosition(g, 'a', NaN, Infinity);
  const a = graphNodes(cleared).find((n) => n.id === 'a');
  assert.equal(a.x, undefined);
  assert.equal(a.y, undefined);
});

test('setNodePosition liefert SAME Reference wenn keine Aenderung noetig', () => {
  const g = makeRpgGraph({ a: { id: 'a', title: 'A' } }, []);
  // Versuch x/y zu loeschen wo keine sind → keine Aenderung erwartet
  const same = setNodePosition(g, 'a', null, null);
  assert.equal(same, g, 'Kein Change → gleiche Referenz, vermeidet unnoetige Re-Renders');
});

test('setNodePosition mit unbekannter ID liefert unveraenderten Graph', () => {
  const g = makeRpgGraph({ a: { id: 'a', title: 'A' } }, []);
  const same = setNodePosition(g, 'unknown', 10, 20);
  assert.equal(same, g);
});

test('setNodePosition wirkt auf Sub-Nodes (Compat-View: b nested in a.children)', () => {
  // makeRpgGraph baut Compat-View: a ist top-level, b haengt nested in
  // a.children weil parent_of-Edge a→b existiert. setNodePosition muss
  // tief rein und b erreichen koennen.
  const g = makeRpgGraph(
    {
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [{ from: 'a', to: 'b', relation: 'parent_of' }]
  );
  const next = setNodePosition(g, 'b', 80, 90);
  // b wird nested unter a gefunden
  const a = graphNodes(next).find((n) => n.id === 'a');
  const b = a?.children?.find((c) => c.id === 'b');
  assert.equal(b?.x, 80, `b.x sollte 80 sein, war ${b?.x}`);
  assert.equal(b?.y, 90);
});
