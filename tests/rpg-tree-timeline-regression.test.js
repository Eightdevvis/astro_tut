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
import { applyTreePickEdges } from '../src/lib/rpg-graph-editor-ops.js';

function root(id, children = []) {
  return { id, title: id, parentId: null, children };
}

function leaf(id) {
  return { id, title: id, parentId: null, children: [] };
}

function base() {
  return makeRpgGraph(
    {
      '1': root('1', [leaf('2'), leaf('3')]),
      '2': leaf('2'),
      '3': leaf('3'),
      '11': root('11', []),
      x: root('x', [leaf('y')]),
      y: leaf('y'),
    },
    [
      { from: '1', to: '2', relation: 'structure' },
      { from: '1', to: '3', relation: 'structure' },
      { from: 'x', to: 'y', relation: 'structure' },
    ]
  );
}

test('timeline-01: initial subtree children exist', () => {
  const g = base();
  assert.deepStrictEqual(getChildIds(g, '1').sort(), ['2', '3']);
});

test('timeline-02: link root 1 under 11 keeps 2/3', () => {
  const g = addParentChildEdge(base(), '11', '1');
  assert.deepStrictEqual(getChildIds(g, '11'), ['1']);
  assert.deepStrictEqual(getChildIds(g, '1').sort(), ['2', '3']);
});

test('timeline-03: shared child has two parents after link', () => {
  const g = addParentChildEdge(base(), '11', '1');
  assert.deepStrictEqual(getParentIds(g, '1').sort(), ['11']);
});

test('timeline-04: linked subtree leaves are not roots', () => {
  const g = addParentChildEdge(base(), '11', '1');
  const roots = getRootNodeIds(g);
  assert.equal(roots.includes('2'), false);
  assert.equal(roots.includes('3'), false);
});

test('timeline-05: remove link 11->1 preserves subtree under 1', () => {
  const linked = addParentChildEdge(base(), '11', '1');
  const unlinked = removeParentChildEdge(linked, '11', '1');
  assert.deepStrictEqual(getChildIds(unlinked, '11'), []);
  assert.deepStrictEqual(getChildIds(unlinked, '1').sort(), ['2', '3']);
});

test('timeline-06: relink after remove is stable', () => {
  const linked = addParentChildEdge(base(), '11', '1');
  const unlinked = removeParentChildEdge(linked, '11', '1');
  const relinked = addParentChildEdge(unlinked, '11', '1');
  assert.deepStrictEqual(getChildIds(relinked, '11'), ['1']);
  assert.deepStrictEqual(getChildIds(relinked, '1').sort(), ['2', '3']);
});

test('timeline-07: repeated add is idempotent', () => {
  const g = addParentChildEdge(base(), '11', '1');
  const again = addParentChildEdge(g, '11', '1');
  assert.equal(again, g);
});

test('timeline-08: repeated remove is idempotent', () => {
  const g = addParentChildEdge(base(), '11', '1');
  const once = removeParentChildEdge(g, '11', '1');
  const twice = removeParentChildEdge(once, '11', '1');
  assert.equal(twice, once);
});

test('timeline-09: applyTreePickEdges adds link and keeps subtree', () => {
  const out = applyTreePickEdges(base(), [{ parentId: '11', childId: '1' }]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, '11'), ['1']);
  assert.deepStrictEqual(getChildIds(out.graph, '1').sort(), ['2', '3']);
});

test('timeline-10: applyTreePickEdges duplicate picks remain single edge', () => {
  const out = applyTreePickEdges(base(), [
    { parentId: '11', childId: '1' },
    { parentId: '11', childId: '1' },
  ]);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepStrictEqual(getChildIds(out.graph, '11'), ['1']);
});

test('timeline-11: add second parent then remove first keeps node reachable', () => {
  const linked = addParentChildEdge(base(), '11', '1');
  const movedLike = removeParentChildEdge(linked, '11', '1');
  assert.deepStrictEqual(getChildIds(movedLike, '1').sort(), ['2', '3']);
});

test('timeline-12: upsert root update keeps existing structure edges', () => {
  const g = addParentChildEdge(base(), '11', '1');
  const next = upsertQuestInGraph(
    g,
    {
      ...root('1', [leaf('2'), leaf('3')]),
      title: 'one-updated',
    },
    []
  );
  assert.deepStrictEqual(getChildIds(next, '1').sort(), ['2', '3']);
});

test('timeline-13: upsert with added child extends structure edges', () => {
  const g = base();
  const next = upsertQuestInGraph(
    g,
    root('1', [leaf('2'), leaf('3'), leaf('4')]),
    []
  );
  assert.deepStrictEqual(getChildIds(next, '1').sort(), ['2', '3', '4']);
});

test('timeline-14: upsert followed by link keeps new child too', () => {
  const g1 = upsertQuestInGraph(base(), root('1', [leaf('2'), leaf('3'), leaf('4')]), []);
  const g2 = addParentChildEdge(g1, '11', '1');
  assert.deepStrictEqual(getChildIds(g2, '1').sort(), ['2', '3', '4']);
});

test('timeline-15: cycle attempt via applyTreePickEdges is rejected', () => {
  const g = makeRpgGraph(
    [root('a', [leaf('b')]), leaf('c')],
    [{ from: 'b', to: 'c', relation: 'structure' }]
  );
  const out = applyTreePickEdges(g, [{ parentId: 'c', childId: 'a' }]);
  assert.equal(out.ok, false);
});

test('timeline-16: remove unrelated edge does not mutate other subtree', () => {
  const g = addParentChildEdge(base(), '11', '1');
  const next = removeParentChildEdge(g, 'x', 'y');
  assert.deepStrictEqual(getChildIds(next, '1').sort(), ['2', '3']);
});

test('timeline-17: three-step timeline add-remove-add remains stable', () => {
  const g1 = addParentChildEdge(base(), '11', '1');
  const g2 = removeParentChildEdge(g1, '11', '1');
  const g3 = addParentChildEdge(g2, '11', '1');
  assert.deepStrictEqual(getChildIds(g3, '1').sort(), ['2', '3']);
  assert.deepStrictEqual(getChildIds(g3, '11'), ['1']);
});

test('timeline-18: shared leaf keeps both parents after second link', () => {
  const g1 = addParentChildEdge(base(), '11', '2');
  assert.deepStrictEqual(getParentIds(g1, '2').sort(), ['1', '11']);
});

test('timeline-19: removing one parent from shared leaf keeps the other', () => {
  const g1 = addParentChildEdge(base(), '11', '2');
  const g2 = removeParentChildEdge(g1, '11', '2');
  assert.deepStrictEqual(getParentIds(g2, '2').sort(), ['1']);
});

test('timeline-20: complex sequence keeps DAG acyclic', () => {
  const g1 = addParentChildEdge(base(), '11', '1');
  const g2 = addParentChildEdge(g1, '11', '2');
  const g3 = removeParentChildEdge(g2, '11', '2');
  const g4 = upsertQuestInGraph(g3, root('1', [leaf('2'), leaf('3'), leaf('4')]), []);
  assert.equal(hasDagCycle(g4), false);
});
