/**
 * Tests fuer Phase 3: Tree-Pick = reine Edge-Operation.
 *
 * Hintergrund: Beim Tree-Pick wählt der User im Quest-Baum eine existierende
 * Node aus, die als zusätzliches Child unter einem anderen Parent eingehängt
 * werden soll. Vorher (Phase 2 und früher): Draft-Kopie → neue ID via
 * `draftNodesToQuestNodes` → Duplikat im Graph. Phase 3 ersetzt das durch
 * `applyTreePickEdges` (idempotente parent_of-Edges, kein Move, kein Klonen)
 * mit Cycle-Prevention.
 *
 * Diese Tests decken die Helper aus `rpg-graph-editor-ops.js` ab —
 * `splitDraftsForTreePick`, `applyTreePickEdges`, `collectAllNodeIds`,
 * `collectSubtreeIds`. Die Editor-Komponente selbst (RpgQuestGraphEditor.jsx)
 * orchestriert nur und ist hier nicht Test-Subjekt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph, graphEdges, isParentChildRelation } from '../src/lib/rpg-quests-data.js';
import {
  applyTreePickEdges,
  splitDraftsForTreePick,
  collectAllNodeIds,
  collectSubtreeIds,
  pruneStaleParentEdgesForContainer,
} from '../src/lib/rpg-graph-editor-ops.js';
import { getChildIds, getParentIds } from '../src/lib/rpg-quest-graph.js';

// =============================================================================
// Helper
// =============================================================================

/** q1→a,b; a→c — alles unter einem Root (c liegt im Container-Subtree von q1). */
function buildSingleQuestWithNestedC() {
  return makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Q1' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
      { from: 'a', to: 'c', relation: 'parent_of' },
    ]
  );
}

function buildBaseGraph() {
  // Layout:
  //   q1 ──parent_of──> a
  //   q1 ──parent_of──> b
  //   q2 ──parent_of──> c
  return makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Quest 1' },
      q2: { id: 'q2', title: 'Quest 2' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
      c: { id: 'c', title: 'C' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
      { from: 'q2', to: 'c', relation: 'parent_of' },
    ]
  );
}

function parentOfEdges(g) {
  return graphEdges(g).filter(isParentChildRelation);
}

// =============================================================================
// applyTreePickEdges: reine Edge-Operation
// =============================================================================

test('Tree-Pick: existing child added to new parent — node has 2 parent_of edges, no duplication', () => {
  // Bug-Reproduktion: User pickt `c` (aktuell Child von q2) als zusaetzliches
  // Child unter q1. Erwartung: c hat hinterher 2 parent_of-Edges (q1→c, q2→c),
  // KEIN Duplikat-Node, q2 behält sein Child c.
  const g = buildBaseGraph();
  const out = applyTreePickEdges(g, [{ parentId: 'q1', childId: 'c' }]);
  assert.equal(out.ok, true);
  const next = out.graph;

  // Multi-Parent: c hat jetzt q1 UND q2 als Parents
  assert.deepStrictEqual(getParentIds(next, 'c').sort(), ['q1', 'q2']);
  // q1 hat jetzt a, b, c als Children
  assert.deepStrictEqual(getChildIds(next, 'q1').sort(), ['a', 'b', 'c']);
  // q2 hat IMMER NOCH c als Child (Original bleibt)
  assert.deepStrictEqual(getChildIds(next, 'q2'), ['c']);
  // Genau eine zusätzliche parent_of-Edge (insgesamt 4 statt 3)
  assert.equal(parentOfEdges(next).length, 4);
});

test('Tree-Pick: existing root added to new parent — root remains in graph (NOT moved out), gets parent_of edge', () => {
  // Bug-Reproduktion 2: User pickt `q2` (aktuell Root) als Child unter q1.
  // Erwartung: q2 bleibt als Node im Graph (kein Verschieben/Löschen),
  // bekommt zusätzlich q1 als Parent. q2 ist dann nicht mehr Root, aber
  // sein Subtree (c) bleibt unter q2 hängen.
  const g = buildBaseGraph();
  const out = applyTreePickEdges(g, [{ parentId: 'q1', childId: 'q2' }]);
  assert.equal(out.ok, true);
  const next = out.graph;

  // q2 hat jetzt q1 als Parent
  assert.deepStrictEqual(getParentIds(next, 'q2'), ['q1']);
  // q2 ist immer noch im Graph (nicht entfernt) — wegen Compat-View landet er
  // jetzt als nested child unter q1 (nicht mehr im Top-Level nodes-Array).
  // collectAllNodeIds sammelt rekursiv und muss q2 weiterhin finden.
  const allIds = collectAllNodeIds(next);
  assert.ok(allIds.has('q2'), 'q2 muss weiterhin im Graph existieren (nested unter q1)');
  // q2 hat IMMER NOCH c als Child
  assert.deepStrictEqual(getChildIds(next, 'q2'), ['c']);
  // q1 hat jetzt a, b, q2 als Children
  assert.deepStrictEqual(getChildIds(next, 'q1').sort(), ['a', 'b', 'q2']);
});

test('Tree-Pick: idempotent edge adds (selecting twice doesn\'t double the edge)', () => {
  // User pickt c zweimal in derselben Save-Aktion (Edge-Liste enthält Duplikat).
  // Erwartung: der Graph hat hinterher GENAU EINE q1→c-Edge.
  const g = buildBaseGraph();
  const out = applyTreePickEdges(g, [
    { parentId: 'q1', childId: 'c' },
    { parentId: 'q1', childId: 'c' },
  ]);
  assert.equal(out.ok, true);
  const next = out.graph;
  const q1cEdges = parentOfEdges(next).filter((e) => e.from === 'q1' && e.to === 'c');
  assert.equal(q1cEdges.length, 1);
});

test('Tree-Pick: cycle prevention (selecting an ancestor as child fails)', () => {
  // Setup: q1 → a → x. User editiert x und versucht q1 als Child anzuhängen
  // (würde q1 → a → x → q1 erzeugen — Zyklus).
  const g = makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Quest 1' },
      a: { id: 'a', title: 'A' },
      x: { id: 'x', title: 'X' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'a', to: 'x', relation: 'parent_of' },
    ]
  );
  const out = applyTreePickEdges(g, [{ parentId: 'x', childId: 'q1' }]);
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.reason, 'cycle');
    assert.deepStrictEqual(out.conflict, { parentId: 'x', childId: 'q1' });
  }
});

test('Tree-Pick: applyTreePickEdges leerer Edge-Liste ist no-op', () => {
  const g = buildBaseGraph();
  const out = applyTreePickEdges(g, []);
  assert.equal(out.ok, true);
  // Gleiche Anzahl Edges wie vorher
  assert.equal(parentOfEdges(out.graph).length, parentOfEdges(g).length);
});

test('Tree-Pick: applyTreePickEdges ignoriert Self-Edges (parentId === childId)', () => {
  const g = buildBaseGraph();
  const out = applyTreePickEdges(g, [{ parentId: 'q1', childId: 'q1' }]);
  assert.equal(out.ok, true);
  assert.equal(parentOfEdges(out.graph).length, parentOfEdges(g).length);
});

// =============================================================================
// splitDraftsForTreePick: Trennung Tree-Pick-Drafts vs. echte neue Drafts
// =============================================================================

test('splitDraftsForTreePick: Draft mit stableId == existierender Graph-Node-ID → wird zu Edge', () => {
  // User hat im Editor unter dem Container q1 einen Tree-Pick auf `c` gemacht.
  // Im Editor-Draft erscheint c als „child draft mit stableId='c'".
  // Erwartung: split → cleanDrafts hat c NICHT, treePickEdges enthält {q1, c}.
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  // Container q1 hat eigene Subtree-IDs: q1, a, b
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  const drafts = [
    { key: 'k-a', stableId: 'a', title: 'A' },
    { key: 'k-b', stableId: 'b', title: 'B' },
    { key: 'k-c', stableId: 'c', title: 'C (tree-picked)' }, // tree-pick
    { key: 'k-new', title: 'Neuer Schritt' }, // brand new
  ];

  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'q1', existingIds, selfSubtreeIds);

  // c ist raus, a + b + new sind drin (gehören zum Subtree resp. neu)
  const cleanKeys = cleanDrafts.map((d) => d.key).sort();
  assert.deepStrictEqual(cleanKeys, ['k-a', 'k-b', 'k-new']);
  // genau eine Tree-Pick-Edge: q1 → c
  assert.deepStrictEqual(treePickEdges, [{ parentId: 'q1', childId: 'c' }]);
});

test('splitDraftsForTreePick: nested Tree-Pick auf tieferer Ebene', () => {
  // User editiert q1, hat im Builder unter dem Sub-Draft `a` (existing) einen
  // Tree-Pick auf `c` gemacht. Erwartung: Edge {parentId: 'a', childId: 'c'}.
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  const drafts = [
    {
      key: 'k-a',
      stableId: 'a',
      title: 'A',
      children: [{ key: 'k-c', stableId: 'c', title: 'C (tree-picked under a)' }],
    },
  ];
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'q1', existingIds, selfSubtreeIds);
  // a bleibt, aber seine children-Liste ist leer (c rausgepickt)
  assert.equal(cleanDrafts.length, 1);
  assert.deepStrictEqual(cleanDrafts[0].children, []);
  assert.deepStrictEqual(treePickEdges, [{ parentId: 'a', childId: 'c' }]);
});

test('splitDraftsForTreePick: stableId aus dem eigenen Subtree wird NICHT als Tree-Pick erkannt', () => {
  // Wenn der User einen seiner eigenen Sub-Nodes in den Drafts hat (übliches
  // Bearbeiten), darf das NICHT als Tree-Pick interpretiert werden — das wäre
  // ein Self-Loop. Nur Drafts MIT stableId aus dem Graph UND außerhalb des
  // eigenen Subtrees gelten als Tree-Pick.
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  // Draft `a` ist ein eigenes Sub-Node von q1 — nicht Tree-Pick!
  const drafts = [{ key: 'k-a', stableId: 'a', title: 'A (legitimate edit)' }];
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'q1', existingIds, selfSubtreeIds);
  assert.equal(cleanDrafts.length, 1);
  assert.equal(cleanDrafts[0].stableId, 'a');
  assert.equal(treePickEdges.length, 0);
});

test('splitDraftsForTreePick: pickedFromTree erzwingt Edge auch wenn stableId im Container-Subtree liegt', () => {
  // Regression: Multi-Parent innerhalb derselben Root-Quest — ohne Flag würde
  // `c` im verschachtelten Save doppelt vorkommen (PUT 400).
  const g = buildSingleQuestWithNestedC();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);
  assert.equal(selfSubtreeIds.has('c'), true);

  const drafts = [{ key: 'k-c', stableId: 'c', title: 'C', pickedFromTree: true }];
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'b', existingIds, selfSubtreeIds);
  assert.equal(cleanDrafts.length, 0);
  assert.deepStrictEqual(treePickEdges, [{ parentId: 'b', childId: 'c' }]);
});

test('splitDraftsForTreePick: gleiche Situation ohne pickedFromTree bleibt normaler Draft', () => {
  const g = buildSingleQuestWithNestedC();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  const drafts = [{ key: 'k-c', stableId: 'c', title: 'C' }];
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'b', existingIds, selfSubtreeIds);
  assert.equal(cleanDrafts.length, 1);
  assert.equal(treePickEdges.length, 0);
});

test('splitDraftsForTreePick: Draft ohne stableId (brand-new) → einfach durchgereicht', () => {
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  const drafts = [{ key: 'k-new', title: 'Frische Sub-Quest' }];
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'q1', existingIds, selfSubtreeIds);
  assert.equal(cleanDrafts.length, 1);
  assert.equal(cleanDrafts[0].title, 'Frische Sub-Quest');
  assert.equal(treePickEdges.length, 0);
});

// =============================================================================
// Editor-Save Roundtrip: Drafts → Save → Edges korrekt
// =============================================================================

test('Editor-Save: nested drafts → flat nodes + edges roundtrip (Tree-Pick + Multi-Parent)', () => {
  // Voller Roundtrip: User editiert q1, fügt einen brandneuen Sub-Draft hinzu
  // UND macht einen Tree-Pick auf c (von q2). Nach split + apply:
  //   - cleanDrafts: nur der neue Sub-Draft (unter q1 via children-Mechanik)
  //   - treePickEdges: q1 → c hinzugefügt, idempotent
  //   - Original-Edges bleiben erhalten (q1→a, q1→b, q2→c)
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  const container = g.nodes.find((n) => n.id === 'q1');
  const selfSubtreeIds = collectSubtreeIds(container);

  const drafts = [
    { key: 'k-a', stableId: 'a', title: 'A' }, // bleibt, ist Subtree von q1
    { key: 'k-b', stableId: 'b', title: 'B' }, // bleibt
    { key: 'k-c', stableId: 'c', title: 'C tree-picked' }, // → Edge
  ];

  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(drafts, 'q1', existingIds, selfSubtreeIds);
  // cleanDrafts hat keine c (keine Duplikation)
  assert.ok(!cleanDrafts.some((d) => d.stableId === 'c'));

  const out = applyTreePickEdges(g, treePickEdges);
  assert.equal(out.ok, true);
  // Nach Apply: q1→c existiert, q2→c bleibt
  const edges = parentOfEdges(out.graph);
  assert.ok(edges.some((e) => e.from === 'q1' && e.to === 'c'));
  assert.ok(edges.some((e) => e.from === 'q2' && e.to === 'c'));
  // Kein Duplikat: c kommt nur einmal im flachen Set vor (auch wenn nested in
  // Compat-View unter zwei Parents kopiert — Node-Identität zählt über die ID).
  // Wir prüfen beide Pfade: keine zusätzlichen IDs wie "c-2" entstehen.
  const allIds = collectAllNodeIds(out.graph);
  assert.ok(allIds.has('c'));
  assert.ok(!allIds.has('c-2'));
});

test('Editor-Save: Tree-Pick auf neuen brand-new Container (Create-Path)', () => {
  // Create-Pfad: parentStableIdOfContainer == die NEUE Container-ID, die noch
  // nicht im Graph ist. existingIds enthält sie also nicht. Ein Tree-Pick-Draft
  // (stableId='c') führt zu einer Edge {newContainerId, c}.
  const g = buildBaseGraph();
  const existingIds = collectAllNodeIds(g);
  // Bei Create gibt es noch keinen container — Subtree ist leer
  const selfSubtreeIds = new Set();

  const drafts = [{ key: 'k-c', stableId: 'c', title: 'C (linked)' }];
  const newContainerId = 'new-container-id';
  const { cleanDrafts, treePickEdges } = splitDraftsForTreePick(
    drafts,
    newContainerId,
    existingIds,
    selfSubtreeIds
  );
  assert.equal(cleanDrafts.length, 0);
  assert.deepStrictEqual(treePickEdges, [{ parentId: newContainerId, childId: 'c' }]);
});

// =============================================================================
// Helpers: collectAllNodeIds, collectSubtreeIds
// =============================================================================

test('collectAllNodeIds sammelt sowohl Top-Level als auch nested Nodes', () => {
  const g = buildBaseGraph();
  // Compat-View hat nested children — collectAllNodeIds muss alle finden
  const ids = collectAllNodeIds(g);
  assert.ok(ids.has('q1'));
  assert.ok(ids.has('q2'));
  assert.ok(ids.has('a'));
  assert.ok(ids.has('b'));
  assert.ok(ids.has('c'));
});

test('collectSubtreeIds sammelt nur den eigenen Subtree (nicht andere Roots)', () => {
  const g = buildBaseGraph();
  const q1 = g.nodes.find((n) => n.id === 'q1');
  const ids = collectSubtreeIds(q1);
  // q1, a, b — KEINE q2, c
  assert.ok(ids.has('q1'));
  assert.ok(ids.has('a'));
  assert.ok(ids.has('b'));
  assert.ok(!ids.has('q2'));
  assert.ok(!ids.has('c'));
});

// =============================================================================
// Editor-Save: Remove-Child verhält sich konsistent mit Edge-Modell
// =============================================================================

test('Editor-Save: removing a child via UI also removes the parent_of edge (Phase-3 helper)', () => {
  // Phase 3: Beim Builder-Remove eines Childs muss die parent_of-Edge
  // mitgehen — sonst zeigt der Compat-View das Child weiterhin unter dem
  // Container. Heute hat `upsertQuestInGraph` keinen Auto-Cleanup für
  // structure-Edges (Multi-Parent-Schutz). Stattdessen kümmert sich
  // `pruneStaleParentEdgesForContainer` im Editor-Save darum: alle
  // `from === container.id`-Edges, deren `to` nicht mehr im neuen Subtree
  // ist, werden entfernt. Multi-Parent-Edges anderer Parents bleiben unberührt.
  const g = makeRpgGraph(
    {
      q1: { id: 'q1', title: 'Q1' },
      q5: { id: 'q5', title: 'Q5' },
      a: { id: 'a', title: 'A' },
      b: { id: 'b', title: 'B' },
    },
    [
      { from: 'q1', to: 'a', relation: 'parent_of' },
      { from: 'q1', to: 'b', relation: 'parent_of' },
      { from: 'q5', to: 'b', relation: 'parent_of' }, // multi-parent: q5 hat b auch
    ]
  );
  // User entfernt b aus q1: neue Subtree-IDs sind nur {q1, a}
  const newSubtreeIds = new Set(['q1', 'a']);
  // Helper anwenden: q1→b weg, q5→b bleibt (Multi-Parent-Schutz)
  const next = pruneStaleParentEdgesForContainer(g, 'q1', newSubtreeIds);
  // q1 hat jetzt nur a als Child
  assert.deepStrictEqual(getChildIds(next, 'q1'), ['a']);
  // b hat aber immer noch q5 als Parent (Multi-Parent erhalten)
  assert.deepStrictEqual(getParentIds(next, 'b'), ['q5']);
});

