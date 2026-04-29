/**
 * Tests fuer V3-Schema (DAG-Foundation, Phase 1).
 *
 * Deckt ab:
 * - migrateRpgGraphToV3 idempotent
 * - V1 → V2 → V3 Migrationskette
 * - V3-canonical (nach stripGraphCompatFields) hat keine children/parentId
 * - Edge-basierte Helper: getChildIds, getParentIds, getChildNodes, getParentNodes,
 *   getRootNodeIds, addParentChildEdge (idempotent), removeParentChildEdge,
 *   hasDagCycle (direkt + indirekt)
 * - Multi-Parent: ein Node mit zwei parent_of-Edges → denormalize liefert
 *   kopierten Sub-Tree pro Parent
 * - denormalizeGraphForCompat liefert backward-kompatibles Format
 * - 'parent_of' wird beim Einlesen als Alias für 'structure' akzeptiert
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRpgGraph,
  graphNodes,
  graphEdges,
  isParentChildRelation,
  denormalizeGraphForCompat,
} from '../src/lib/rpg-quests-data.js';
import {
  migrateRpgGraphToV3,
  stripGraphCompatFields,
  RPG_PAYLOAD_SCHEMA_VERSION,
} from '../src/lib/rpg-payload-schema.js';
import {
  getChildIds,
  getParentIds,
  getChildNodes,
  getParentNodes,
  getRootNodeIds,
  addParentChildEdge,
  removeParentChildEdge,
  hasDagCycle,
} from '../src/lib/rpg-quest-graph.js';

// ============================================================================
// Schema-Version
// ============================================================================

test('RPG_PAYLOAD_SCHEMA_VERSION ist 3 (V3)', () => {
  assert.equal(RPG_PAYLOAD_SCHEMA_VERSION, 3);
});

// ============================================================================
// Edge-Alias 'parent_of'
// ============================================================================

test("'parent_of' wird als Alias für 'structure' akzeptiert", () => {
  // Edge-Normalizer mappt parent_of → structure (canonical), so dass alle
  // bestehenden Filter (=== 'structure') weiter greifen.
  const g = makeRpgGraph(
    [
      { id: 'p', title: 'P', children: [] },
      { id: 'c', title: 'C', children: [] },
    ],
    [{ from: 'p', to: 'c', relation: 'parent_of' }]
  );
  const edges = graphEdges(g);
  assert.equal(edges.length, 1);
  // Nach Normalisierung ist relation === 'structure'
  assert.equal(edges[0].relation, 'structure');
  assert.equal(isParentChildRelation(edges[0]), true);
});

test("isParentChildRelation erkennt beide Werte", () => {
  assert.equal(isParentChildRelation({ from: 'a', to: 'b', relation: 'structure' }), true);
  assert.equal(isParentChildRelation({ from: 'a', to: 'b', relation: 'parent_of' }), true);
  assert.equal(isParentChildRelation({ from: 'a', to: 'b', relation: 'dependency' }), false);
  assert.equal(isParentChildRelation(null), false);
});

// ============================================================================
// migrateRpgGraphToV3 — Idempotenz
// ============================================================================

test('migrateRpgGraphToV3 ist idempotent', () => {
  const v2 = makeRpgGraph(
    [
      {
        id: 'q1',
        parentId: null,
        title: 'Quest 1',
        children: [
          { id: 'a', parentId: 'q1', title: 'A', children: [] },
          { id: 'b', parentId: 'q1', title: 'B', children: [] },
        ],
      },
    ],
    []
  );
  const once = migrateRpgGraphToV3(v2);
  const twice = migrateRpgGraphToV3(once);
  // Strukturell identisch (gleiche Nodes, gleiche Edges)
  assert.deepStrictEqual(stripGraphCompatFields(once), stripGraphCompatFields(twice));
});

test('migrateRpgGraphToV3 auf bereits V3-canonical liefert unverändertes Ergebnis', () => {
  // V3-canonical: flache Nodes, alle Edges in graph.edges
  const v3canonical = {
    nodes: [
      { id: 'q1', title: 'Quest 1' },
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    edges: [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
    ],
  };
  const migrated = migrateRpgGraphToV3(v3canonical);
  const stripped = stripGraphCompatFields(migrated);
  assert.equal(stripped.nodes.length, 3);
  assert.equal(stripped.edges.length, 2);
});

// ============================================================================
// Migrations-Kette V1 → V2 → V3
// ============================================================================

test('V1 (Legacy) → V2 → V3 Migration funktioniert', () => {
  // V1: 'quests' statt 'nodes', 'label' statt 'title', nested children
  const v1 = {
    quests: [
      {
        id: 'q1',
        label: 'Legacy Quest',
        children: [
          { id: 'a', label: 'Legacy Child', children: [] },
        ],
        questRewards: [{ type: 'text', text: 'Reward' }],
      },
    ],
    edges: [],
  };
  const v3 = migrateRpgGraphToV3(v1);
  // title statt label
  const q1 = graphNodes(v3).find((n) => n.id === 'q1');
  assert.ok(q1, 'q1 sollte existieren');
  assert.equal(q1.title, 'Legacy Quest');
  // rewards-Array (kanonisch) statt questRewards
  assert.ok(Array.isArray(q1.rewards));
  // Compat-View: q1 hat children
  assert.equal(q1.children.length, 1);
  assert.equal(q1.children[0].id, 'a');
  assert.equal(q1.children[0].title, 'Legacy Child');
});

// ============================================================================
// V3 canonical hat keine children/parentId
// ============================================================================

test('V3-canonical (stripGraphCompatFields) hat keine children/parentId Felder', () => {
  const v2 = makeRpgGraph(
    [
      {
        id: 'q1',
        parentId: null,
        title: 'Q1',
        children: [{ id: 'a', parentId: 'q1', title: 'A', children: [] }],
      },
    ],
    []
  );
  const v3 = migrateRpgGraphToV3(v2);
  const canonical = stripGraphCompatFields(v3);
  // Alle Nodes sind im Top-Level
  assert.equal(canonical.nodes.length, 2);
  for (const n of canonical.nodes) {
    assert.equal(Object.prototype.hasOwnProperty.call(n, 'children'), false,
      `Node ${n.id} sollte kein children-Feld haben`);
    assert.equal(Object.prototype.hasOwnProperty.call(n, 'parentId'), false,
      `Node ${n.id} sollte kein parentId-Feld haben`);
  }
  // Edge q1 → a existiert (relation: structure)
  assert.equal(canonical.edges.length, 1);
  assert.equal(canonical.edges[0].from, 'q1');
  assert.equal(canonical.edges[0].to, 'a');
  assert.ok(isParentChildRelation(canonical.edges[0]));
});

test('V3 nodes haben tiefe Struktur korrekt aufgelöst', () => {
  // Tiefe 3: q1 → a → b → c
  const v2 = makeRpgGraph(
    [
      {
        id: 'q1',
        parentId: null,
        title: 'Q1',
        children: [{
          id: 'a', parentId: 'q1', title: 'A',
          children: [{
            id: 'b', parentId: 'a', title: 'B',
            children: [{ id: 'c', parentId: 'b', title: 'C', children: [] }],
          }],
        }],
      },
    ],
    []
  );
  const canonical = stripGraphCompatFields(migrateRpgGraphToV3(v2));
  assert.equal(canonical.nodes.length, 4);
  // 3 structure-Edges erwartet: q1→a, a→b, b→c
  const structureEdges = canonical.edges.filter(isParentChildRelation);
  assert.equal(structureEdges.length, 3);
  const pairs = structureEdges.map((e) => `${e.from}→${e.to}`).sort();
  assert.deepStrictEqual(pairs, ['a→b', 'b→c', 'q1→a']);
});

// ============================================================================
// Edge-basierte Helper
// ============================================================================

function buildSimpleGraph() {
  // q1 (Root)
  //   ├─ a
  //   └─ b
  // q2 (Root, mit dependency q1 → q2)
  //   └─ c
  return makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Q1' },
      q2: { id: 'q2', title: 'Q2' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
      { from: 'q2', to: 'c', relation: 'parent_of' },
      { from: 'q1', to: 'q2', relation: 'dependency' },
    ]
  );
}

test('getChildIds liefert direkte Children via parent_of-Edges', () => {
  const g = buildSimpleGraph();
  assert.deepStrictEqual(getChildIds(g, 'q1').sort(), ['a', 'b']);
  assert.deepStrictEqual(getChildIds(g, 'q2'), ['c']);
  assert.deepStrictEqual(getChildIds(g, 'a'), []);
  assert.deepStrictEqual(getChildIds(g, 'unknown'), []);
});

test('getParentIds liefert direkte Parents', () => {
  const g = buildSimpleGraph();
  assert.deepStrictEqual(getParentIds(g, 'a'), ['q1']);
  assert.deepStrictEqual(getParentIds(g, 'c'), ['q2']);
  assert.deepStrictEqual(getParentIds(g, 'q1'), []); // Root ohne Parent
});

test('getChildNodes liefert vollständig aufgelöste Children', () => {
  const g = buildSimpleGraph();
  const kids = getChildNodes(g, 'q1');
  assert.equal(kids.length, 2);
  assert.ok(kids.some((n) => n.id === 'a'));
  assert.ok(kids.some((n) => n.id === 'b'));
});

test('getParentNodes liefert vollständig aufgelöste Parents', () => {
  const g = buildSimpleGraph();
  const parents = getParentNodes(g, 'a');
  assert.equal(parents.length, 1);
  assert.equal(parents[0].id, 'q1');
});

test('getRootNodeIds liefert Nodes ohne eingehende parent_of-Edges', () => {
  const g = buildSimpleGraph();
  const roots = getRootNodeIds(g).sort();
  assert.deepStrictEqual(roots, ['q1', 'q2']);
});

// ============================================================================
// addParentChildEdge / removeParentChildEdge
// ============================================================================

test('addParentChildEdge fügt Edge hinzu', () => {
  const g = makeRpgGraph(
    { q1: { id: 'q1', title: 'Q1' }, q2: { id: 'q2', title: 'Q2' } },
    []
  );
  const next = addParentChildEdge(g, 'q1', 'q2');
  assert.equal(graphEdges(next).filter(isParentChildRelation).length, 1);
  assert.deepStrictEqual(getChildIds(next, 'q1'), ['q2']);
});

test('addParentChildEdge ist idempotent (gleiche Edge nicht doppelt)', () => {
  const g = makeRpgGraph(
    { q1: { id: 'q1', title: 'Q1' }, q2: { id: 'q2', title: 'Q2' } },
    [{ from: 'q1', to: 'q2', relation: 'structure' }]
  );
  const next = addParentChildEdge(g, 'q1', 'q2');
  // Identische Referenz: nichts hat sich geändert
  assert.equal(next, g);
  assert.equal(graphEdges(next).filter(isParentChildRelation).length, 1);
});

test('addParentChildEdge ignoriert Self-Edges', () => {
  const g = makeRpgGraph({ q1: { id: 'q1', title: 'Q1' } }, []);
  const next = addParentChildEdge(g, 'q1', 'q1');
  assert.equal(next, g);
});

test('removeParentChildEdge entfernt Edge', () => {
  const g = makeRpgGraph(
    { q1: { id: 'q1', title: 'Q1' }, q2: { id: 'q2', title: 'Q2' } },
    [{ from: 'q1', to: 'q2', relation: 'structure' }]
  );
  const next = removeParentChildEdge(g, 'q1', 'q2');
  assert.equal(graphEdges(next).filter(isParentChildRelation).length, 0);
});

test('removeParentChildEdge gibt unveränderten Graph wenn Edge nicht existiert', () => {
  const g = makeRpgGraph(
    { q1: { id: 'q1', title: 'Q1' }, q2: { id: 'q2', title: 'Q2' } },
    []
  );
  const next = removeParentChildEdge(g, 'q1', 'q2');
  assert.equal(next, g);
});

// ============================================================================
// hasDagCycle
// ============================================================================

test('hasDagCycle: leerer Graph hat keinen Zyklus', () => {
  assert.equal(hasDagCycle(makeRpgGraph([], [])), false);
});

test('hasDagCycle: linearer Baum hat keinen Zyklus', () => {
  const g = makeRpgGraph(
    {
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'a', to: 'b', relation: 'parent_of' },
      { from: 'b', to: 'c', relation: 'parent_of' },
    ]
  );
  assert.equal(hasDagCycle(g), false);
});

test('hasDagCycle erkennt direkten Zyklus (A → B → A)', () => {
  // Graph manuell bauen, damit der Cycle erhalten bleibt (makeRpgGraph
  // mit Map würde sonst nichts kaputt machen)
  const g = {
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    edges: [
      { from: 'a', to: 'b', relation: 'structure' },
      { from: 'b', to: 'a', relation: 'structure' },
    ],
  };
  assert.equal(hasDagCycle(g), true);
});

test('hasDagCycle erkennt indirekten Zyklus (A → B → C → A)', () => {
  const g = {
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ],
    edges: [
      { from: 'a', to: 'b', relation: 'structure' },
      { from: 'b', to: 'c', relation: 'structure' },
      { from: 'c', to: 'a', relation: 'structure' },
    ],
  };
  assert.equal(hasDagCycle(g), true);
});

test('hasDagCycle ignoriert dependency-Edges', () => {
  // Ein Cycle in dependency-Edges ist kein DAG-Verstoss (parent_of bleibt sauber)
  const g = makeRpgGraph(
    {
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'a', to: 'b', relation: 'dependency' },
      { from: 'b', to: 'a', relation: 'dependency' },
    ]
  );
  assert.equal(hasDagCycle(g), false);
});

// ============================================================================
// Multi-Parent (das Hauptfeature von V3)
// ============================================================================

test('Multi-Parent: V3 erlaubt einen Node mit mehreren parent_of-Edges', () => {
  // child hat ZWEI Parents: p1 und p2
  const g = makeRpgGraph(
    {
      p1: { id: 'p1', title: 'P1' },
      p2: { id: 'p2', title: 'P2' },
      child: { id: 'child', title: 'Child' },
    },
    [
      { from: 'p1', to: 'child', relation: 'parent_of' },
      { from: 'p2', to: 'child', relation: 'parent_of' },
    ]
  );
  assert.deepStrictEqual(getParentIds(g, 'child').sort(), ['p1', 'p2']);
  assert.equal(hasDagCycle(g), false);
});

test('denormalizeGraphForCompat: Multi-Parent → kopierter Sub-Tree pro Parent', () => {
  // p1 und p2 sind beide Roots. child ist Kind von beiden.
  const g = {
    nodes: [
      { id: 'p1', title: 'P1' },
      { id: 'p2', title: 'P2' },
      { id: 'child', title: 'Child' },
    ],
    edges: [
      { from: 'p1', to: 'child', relation: 'structure' },
      { from: 'p2', to: 'child', relation: 'structure' },
    ],
  };
  const view = denormalizeGraphForCompat(g);
  // Beide Roots vorhanden
  const rootIds = view.nodes.map((n) => n.id).sort();
  assert.deepStrictEqual(rootIds, ['p1', 'p2']);
  // Beide Roots haben das Child als Kopie
  for (const root of view.nodes) {
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].id, 'child');
    // parentId der Child-Kopie zeigt auf den jeweiligen Parent
    assert.equal(root.children[0].parentId, root.id);
  }
});

test('denormalizeGraphForCompat: V3-canonical → Compat-View mit children/parentId', () => {
  const g = {
    nodes: [
      { id: 'q1', title: 'Q1' },
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    edges: [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
    ],
  };
  const view = denormalizeGraphForCompat(g);
  assert.equal(view.nodes.length, 1);
  const root = view.nodes[0];
  assert.equal(root.id, 'q1');
  assert.equal(root.parentId, null);
  assert.equal(root.children.length, 2);
  for (const child of root.children) {
    assert.equal(child.parentId, 'q1');
    assert.equal(Array.isArray(child.children), true);
  }
});

test('denormalizeGraphForCompat: Cycle-Schutz', () => {
  // Edge-Cycle a → b → a
  const g = {
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    edges: [
      { from: 'a', to: 'b', relation: 'structure' },
      { from: 'b', to: 'a', relation: 'structure' },
    ],
  };
  // Sollte nicht in Endlosrekursion gehen — beide Nodes sind in einem Cycle,
  // also keiner ist klassischer Root. Ergebnis: leere roots oder eine Wahl
  // (je nach Implementation). Wichtig ist: kein Stack-Overflow.
  const view = denormalizeGraphForCompat(g);
  // Im Cycle-Fall hat jeder Node mindestens einen Parent → keine Roots erkannt.
  assert.equal(view.nodes.length, 0);
});

// ============================================================================
// Persistenz-Format-Invariante
// ============================================================================

test('PUT-Roundtrip: Compat-View → stripGraphCompatFields → V3-canonical (flach)', () => {
  // Simuliert den PUT-Pfad: Client schickt einen V2-Tree, Server normalisiert
  // via migrateRpgGraphToV3 (Compat-View) und persistiert via stripGraphCompatFields.
  const v2Input = {
    nodes: [
      {
        id: 'q1',
        parentId: null,
        title: 'Q1',
        children: [
          { id: 'a', parentId: 'q1', title: 'A', children: [] },
          { id: 'b', parentId: 'q1', title: 'B', children: [
            { id: 'b1', parentId: 'b', title: 'B1', children: [] },
          ] },
        ],
      },
    ],
    edges: [],
  };
  const compatGraph = migrateRpgGraphToV3(v2Input);
  const persisted = stripGraphCompatFields(compatGraph);
  // 4 Nodes flach: q1, a, b, b1
  assert.equal(persisted.nodes.length, 4);
  for (const n of persisted.nodes) {
    assert.equal(Object.prototype.hasOwnProperty.call(n, 'children'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(n, 'parentId'), false);
  }
  // 3 structure-Edges: q1→a, q1→b, b→b1
  const struct = persisted.edges.filter(isParentChildRelation);
  assert.equal(struct.length, 3);
});

test('migrateRpgGraphToV3 + stripGraphCompatFields: Multi-Parent bleibt erhalten', () => {
  // Wenn der Eingangsgraph schon Multi-Parent hat, muss V3 das beibehalten
  const input = {
    nodes: [
      { id: 'p1', title: 'P1' },
      { id: 'p2', title: 'P2' },
      { id: 'child', title: 'Child' },
    ],
    edges: [
      { from: 'p1', to: 'child', relation: 'parent_of' },
      { from: 'p2', to: 'child', relation: 'parent_of' },
    ],
  };
  const v3 = migrateRpgGraphToV3(input);
  const canonical = stripGraphCompatFields(v3);
  assert.equal(canonical.nodes.length, 3);
  const structureEdges = canonical.edges.filter(isParentChildRelation);
  // Beide parent_of-Edges müssen erhalten bleiben
  assert.equal(structureEdges.length, 2);
});
