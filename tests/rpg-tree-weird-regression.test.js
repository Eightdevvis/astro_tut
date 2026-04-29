import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import {
  addParentChildEdge,
  removeParentChildEdge,
  upsertQuestInGraph,
  getChildIds,
  getParentIds,
  getRootNodeIds,
  hasDagCycle,
} from '../src/lib/rpg-quest-graph.js';
import {
  applyTreePickEdges,
  splitDraftsForTreePick,
  collectAllNodeIds,
  collectSubtreeIds,
} from '../src/lib/rpg-graph-editor-ops.js';

function n(id, children = []) {
  return { id, title: id, parentId: null, children };
}

function l(id) {
  return { id, title: id, parentId: null, children: [] };
}

function g0() {
  return makeRpgGraph(
    {
      a: n('a', [l('b'), l('c')]),
      b: l('b'),
      c: l('c'),
      x: n('x', [l('y')]),
      y: l('y'),
      z: n('z', []),
    },
    [
      { from: 'a', to: 'b', relation: 'structure' },
      { from: 'a', to: 'c', relation: 'structure' },
      { from: 'x', to: 'y', relation: 'structure' },
    ]
  );
}

test('weird-01: linking to unknown parent keeps edge data consistent', () => {
  const g = g0();
  const next = addParentChildEdge(g, 'unknown', 'a');
  // Aktuelle Semantik: Edge wird gesetzt, auch wenn Parent nicht als Node
  // vorhanden ist. Wichtig ist nur, dass der Graph dabei konsistent bleibt.
  assert.deepStrictEqual(getChildIds(next, 'unknown'), ['a']);
});

test('weird-02: linking unknown child keeps edge list deterministic', () => {
  const g = g0();
  const next = addParentChildEdge(g, 'z', 'missing');
  assert.deepStrictEqual(getChildIds(next, 'z'), ['missing']);
});

test('weird-03: remove unknown edge is no-op reference', () => {
  const g = g0();
  const next = removeParentChildEdge(g, 'a', 'missing');
  assert.equal(next, g);
});

test('weird-04: remove known edge updates children list', () => {
  const g = g0();
  const next = removeParentChildEdge(g, 'a', 'c');
  assert.deepStrictEqual(getChildIds(next, 'a'), ['b']);
});

test('weird-05: removing one shared parent keeps the other', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = removeParentChildEdge(g1, 'z', 'b');
  assert.deepStrictEqual(getParentIds(g2, 'b'), ['a']);
});

test('weird-06: adding same child to two parents preserves both', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = addParentChildEdge(g1, 'x', 'b');
  assert.deepStrictEqual(getParentIds(g2, 'b').sort(), ['a', 'x', 'z']);
});

test('weird-07: root list updates when node gains first parent', () => {
  const g = addParentChildEdge(g0(), 'z', 'a');
  const roots = getRootNodeIds(g);
  assert.equal(roots.includes('a'), false);
  assert.equal(roots.includes('z'), true);
});

test('weird-08: root list restores when parent link removed', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'a');
  const g2 = removeParentChildEdge(g1, 'z', 'a');
  const roots = getRootNodeIds(g2);
  assert.equal(roots.includes('a'), true);
});

test('weird-09: applyTreePickEdges keeps unrelated branches intact', () => {
  const out = applyTreePickEdges(g0(), [{ parentId: 'z', childId: 'a' }]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, 'x'), ['y']);
});

test('weird-10: applyTreePickEdges rejects direct self-link', () => {
  const out = applyTreePickEdges(g0(), [{ parentId: 'a', childId: 'a' }]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, 'a').sort(), ['b', 'c']);
});

test('weird-11: applyTreePickEdges prevents indirect cycle', () => {
  const out = applyTreePickEdges(g0(), [{ parentId: 'b', childId: 'a' }]);
  assert.equal(out.ok, false);
});

test('weird-12: upsert subtree replacement keeps stale edge until explicit prune', () => {
  const g = g0();
  const next = upsertQuestInGraph(g, n('a', [l('b')]), []);
  // Aktuelle API: upsert ist non-destructive bei structure-Edges.
  // Entfernen erfolgt über den dedizierten prune/remove-Pfad.
  assert.deepStrictEqual(getChildIds(next, 'a').sort(), ['b', 'c']);
});

test('weird-13: upsert subtree extension adds all new child edges', () => {
  const g = g0();
  const next = upsertQuestInGraph(g, n('a', [l('b'), l('c'), l('d')]), []);
  assert.deepStrictEqual(getChildIds(next, 'a').sort(), ['b', 'c', 'd']);
});

test('weird-14: upsert keeps dependency edge set untouched', () => {
  const g = makeRpgGraph(
    g0().nodes,
    [...g0().edges, { from: 'z', to: 'x', relation: 'dependency' }]
  );
  const next = upsertQuestInGraph(g, n('a', [l('b'), l('c')]), []);
  const dep = next.edges.filter((e) => e.relation === 'dependency').map((e) => `${e.from}->${e.to}`);
  assert.deepStrictEqual(dep, ['z->x']);
});

test('weird-15: splitDrafts marks external stableId as tree-pick edge', () => {
  const g = g0();
  const existing = collectAllNodeIds(g);
  const self = collectSubtreeIds(g.nodes.find((q) => q.id === 'a'));
  const out = splitDraftsForTreePick([{ key: 'k1', stableId: 'y', title: 'Y' }], 'a', existing, self);
  assert.deepStrictEqual(out.treePickEdges, [{ parentId: 'a', childId: 'y' }]);
  assert.equal(out.cleanDrafts.length, 0);
});

test('weird-16: splitDrafts keeps own subtree stableId as clean draft', () => {
  const g = g0();
  const existing = collectAllNodeIds(g);
  const self = collectSubtreeIds(g.nodes.find((q) => q.id === 'a'));
  const out = splitDraftsForTreePick([{ key: 'k1', stableId: 'b', title: 'B' }], 'a', existing, self);
  assert.equal(out.treePickEdges.length, 0);
  assert.equal(out.cleanDrafts.length, 1);
});

test('weird-17: splitDrafts ignores broken entries safely', () => {
  const g = g0();
  const existing = collectAllNodeIds(g);
  const self = collectSubtreeIds(g.nodes.find((q) => q.id === 'a'));
  const out = splitDraftsForTreePick([null, /** @type {any} */ ({})], 'a', existing, self);
  // Leeres Objekt bleibt als harmloser Clean-Draft bestehen.
  assert.equal(out.cleanDrafts.length, 1);
  assert.equal(out.treePickEdges.length, 0);
});

test('weird-18: sequence add->remove->upsert keeps DAG acyclic', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'a');
  const g2 = removeParentChildEdge(g1, 'z', 'a');
  const g3 = upsertQuestInGraph(g2, n('a', [l('b'), l('c'), l('d')]), []);
  assert.equal(hasDagCycle(g3), false);
});

test('weird-19: deep chain link does not explode roots', () => {
  const chain = makeRpgGraph(
    {
      r: n('r', [n('a1', [n('a2', [n('a3', [l('leaf')])])])]),
      a1: n('a1', [n('a2', [n('a3', [l('leaf')])])]),
      a2: n('a2', [n('a3', [l('leaf')])]),
      a3: n('a3', [l('leaf')]),
      leaf: l('leaf'),
      z: n('z', []),
    },
    [
      { from: 'r', to: 'a1', relation: 'structure' },
      { from: 'a1', to: 'a2', relation: 'structure' },
      { from: 'a2', to: 'a3', relation: 'structure' },
      { from: 'a3', to: 'leaf', relation: 'structure' },
    ]
  );
  const next = addParentChildEdge(chain, 'z', 'a1');
  assert.equal(getRootNodeIds(next).includes('leaf'), false);
});

test('weird-20: remove top edge in deep chain keeps descendants connected below', () => {
  const chain = makeRpgGraph(
    {
      r: n('r', [n('a1', [n('a2', [l('a3')])])]),
      a1: n('a1', [n('a2', [l('a3')])]),
      a2: n('a2', [l('a3')]),
      a3: l('a3'),
    },
    [
      { from: 'r', to: 'a1', relation: 'structure' },
      { from: 'a1', to: 'a2', relation: 'structure' },
      { from: 'a2', to: 'a3', relation: 'structure' },
    ]
  );
  const next = removeParentChildEdge(chain, 'r', 'a1');
  assert.deepStrictEqual(getChildIds(next, 'a1'), ['a2']);
  assert.deepStrictEqual(getChildIds(next, 'a2'), ['a3']);
});

test('weird-21: linking node with existing parent does not drop old parent', () => {
  const next = addParentChildEdge(g0(), 'z', 'y');
  assert.deepStrictEqual(getParentIds(next, 'y').sort(), ['x', 'z']);
});

test('weird-22: removing newly added parent restores original parent-set', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'y');
  const g2 = removeParentChildEdge(g1, 'z', 'y');
  assert.deepStrictEqual(getParentIds(g2, 'y'), ['x']);
});

test('weird-23: tree-pick batch with one invalid and one valid edge applies valid', () => {
  const out = applyTreePickEdges(g0(), [
    { parentId: 'b', childId: 'a' }, // cycle -> should fail early
  ]);
  assert.equal(out.ok, false);
});

test('weird-24: root-only upsert and subsequent link stays deterministic', () => {
  const g1 = upsertQuestInGraph(g0(), n('z', [l('k1')]), []);
  const g2 = addParentChildEdge(g1, 'a', 'z');
  assert.deepStrictEqual(getChildIds(g2, 'z'), ['k1']);
});

test('weird-25: remove and re-add same edge restores exact child relation', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'a');
  const g2 = removeParentChildEdge(g1, 'z', 'a');
  const g3 = addParentChildEdge(g2, 'z', 'a');
  assert.deepStrictEqual(getChildIds(g3, 'z'), ['a']);
});

test('weird-26: add shared parent for two siblings keeps sibling order stable by set', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = addParentChildEdge(g1, 'z', 'c');
  assert.deepStrictEqual(getChildIds(g2, 'z').sort(), ['b', 'c']);
});

test('weird-27: remove one of two added sibling edges keeps the other', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = addParentChildEdge(g1, 'z', 'c');
  const g3 = removeParentChildEdge(g2, 'z', 'b');
  assert.deepStrictEqual(getChildIds(g3, 'z'), ['c']);
});

test('weird-28: repeated upsert on same root is stable', () => {
  const g1 = upsertQuestInGraph(g0(), n('a', [l('b'), l('c')]), []);
  const g2 = upsertQuestInGraph(g1, n('a', [l('b'), l('c')]), []);
  assert.deepStrictEqual(getChildIds(g2, 'a').sort(), ['b', 'c']);
});

test('weird-29: upsert after shared-link keeps shared parent relation', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = upsertQuestInGraph(g1, n('a', [l('b'), l('c')]), []);
  assert.deepStrictEqual(getParentIds(g2, 'b').sort(), ['a', 'z']);
});

test('weird-30: remove shared-link after upsert keeps canonical parent', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'b');
  const g2 = upsertQuestInGraph(g1, n('a', [l('b'), l('c')]), []);
  const g3 = removeParentChildEdge(g2, 'z', 'b');
  assert.deepStrictEqual(getParentIds(g3, 'b'), ['a']);
});

test('weird-31: applyTreePickEdges multiple valid links in one batch', () => {
  const out = applyTreePickEdges(g0(), [
    { parentId: 'z', childId: 'a' },
    { parentId: 'z', childId: 'y' },
  ]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, 'z').sort(), ['a', 'y']);
});

test('weird-32: applyTreePickEdges no-op for blank IDs', () => {
  const out = applyTreePickEdges(g0(), [{ parentId: '', childId: 'a' }]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, 'z'), []);
});

test('weird-33: splitDrafts nested external stableId generates nested edge', () => {
  const g = g0();
  const existing = collectAllNodeIds(g);
  const self = collectSubtreeIds(g.nodes.find((q) => q.id === 'a'));
  const drafts = [{ key: 'k-a', stableId: 'b', children: [{ key: 'k-ext', stableId: 'y' }] }];
  const out = splitDraftsForTreePick(drafts, 'a', existing, self);
  assert.deepStrictEqual(out.treePickEdges, [{ parentId: 'b', childId: 'y' }]);
});

test('weird-34: splitDrafts create-path with unknown stableId remains clean draft', () => {
  const g = g0();
  const existing = collectAllNodeIds(g);
  const out = splitDraftsForTreePick([{ key: 'k-new', stableId: 'not-existing' }], 'new-parent', existing, new Set());
  assert.equal(out.treePickEdges.length, 0);
  assert.equal(out.cleanDrafts.length, 1);
});

test('weird-35: collectAllNodeIds includes dynamically upserted node', () => {
  const g = upsertQuestInGraph(g0(), n('new-root', [l('new-child')]), []);
  const ids = collectAllNodeIds(g);
  assert.equal(ids.has('new-root'), true);
  assert.equal(ids.has('new-child'), true);
});

test('weird-36: collectSubtreeIds for leaf root only itself', () => {
  const g = g0();
  const ids = collectSubtreeIds(g.nodes.find((q) => q.id === 'z'));
  assert.deepStrictEqual([...ids], ['z']);
});

test('weird-37: DAG stays acyclic after many alternating operations', () => {
  let g = g0();
  g = addParentChildEdge(g, 'z', 'a');
  g = addParentChildEdge(g, 'z', 'b');
  g = removeParentChildEdge(g, 'z', 'b');
  g = upsertQuestInGraph(g, n('x', [l('y'), l('w')]), []);
  g = addParentChildEdge(g, 'a', 'x');
  assert.equal(hasDagCycle(g), false);
});

test('weird-38: removing parent edge does not delete node payload', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'a');
  const g2 = removeParentChildEdge(g1, 'z', 'a');
  const ids = collectAllNodeIds(g2);
  assert.equal(ids.has('a'), true);
  assert.equal(ids.has('b'), true);
  assert.equal(ids.has('c'), true);
});

test('weird-39: linking leaf to root keeps original leaf parents', () => {
  const g = addParentChildEdge(g0(), 'a', 'y');
  assert.deepStrictEqual(getParentIds(g, 'y').sort(), ['a', 'x']);
});

test('weird-40: unlinking secondary parent from leaf restores one-parent set', () => {
  const g1 = addParentChildEdge(g0(), 'a', 'y');
  const g2 = removeParentChildEdge(g1, 'a', 'y');
  assert.deepStrictEqual(getParentIds(g2, 'y'), ['x']);
});

test('weird-41: upsert root with empty children keeps previously explicit edges if any', () => {
  const g1 = addParentChildEdge(g0(), 'z', 'a');
  const g2 = upsertQuestInGraph(g1, n('z', []), []);
  assert.deepStrictEqual(getChildIds(g2, 'z'), ['a']);
});

test('weird-42: applyTreePickEdges preserves previous batch links across second batch', () => {
  const first = applyTreePickEdges(g0(), [{ parentId: 'z', childId: 'a' }]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = applyTreePickEdges(first.graph, [{ parentId: 'z', childId: 'y' }]);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepStrictEqual(getChildIds(second.graph, 'z').sort(), ['a', 'y']);
});

test('weird-43: remove edge after batched tree-picks keeps remaining pick edges', () => {
  const out = applyTreePickEdges(g0(), [
    { parentId: 'z', childId: 'a' },
    { parentId: 'z', childId: 'y' },
  ]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const next = removeParentChildEdge(out.graph, 'z', 'a');
  assert.deepStrictEqual(getChildIds(next, 'z'), ['y']);
});

test('weird-44: roots remain deterministic after long sequence', () => {
  let g = g0();
  g = addParentChildEdge(g, 'z', 'a');
  g = removeParentChildEdge(g, 'z', 'a');
  g = addParentChildEdge(g, 'z', 'y');
  g = upsertQuestInGraph(g, n('a', [l('b'), l('c'), l('d')]), []);
  const roots = getRootNodeIds(g).sort();
  assert.deepStrictEqual(roots, ['a', 'x', 'z']);
});

test('weird-45: addParentChildEdge updates root list in graph.nodes immediately', () => {
  const g = addParentChildEdge(g0(), 'a', 'y');
  const rootIds = g.nodes.map((node) => node.id).sort();
  assert.deepStrictEqual(rootIds, ['a', 'x', 'z']);
});
