import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import { validateRpgGraphReferences, resolveNodeGuardQuest } from '../src/lib/rpg-graph-validation.js';
import { migrateRpgGraphToV2 } from '../src/lib/rpg-quest-nodes.js';
import { deriveRpgTreeSelectionView } from '../src/lib/rpg-tree-selection.js';

function makeQuest(id, children) {
  return {
    id,
    parentId: null,
    title: id,
    description: '',
    children,
  };
}

test('validateRpgGraphReferences accepts valid edges and dependsOn', () => {
  const graph = makeRpgGraph(
    [
      makeQuest('q1', [{ id: 'a', parentId: 'q1', label: 'A', children: [] }]),
      makeQuest('q2', [{ id: 'b', parentId: 'q2', label: 'B', children: [{ id: 'b2', parentId: 'b', label: 'B2', dependsOn: ['b'], children: [] }] }]),
    ],
    [{ from: 'q1', to: 'q2' }]
  );
  const got = validateRpgGraphReferences(graph, graph.edges);
  assert.equal(got.ok, true);
});

test('validateRpgGraphReferences rejects dangling quest edge', () => {
  const graph = makeRpgGraph([makeQuest('q1', [])], [{ from: 'q1', to: 'q-missing' }]);
  const got = validateRpgGraphReferences(graph, graph.edges);
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.reason, /Ungültige Kante/);
});

test('validateRpgGraphReferences rejects unknown dependsOn references', () => {
  const graph = makeRpgGraph(
    [
      makeQuest('q1', [
        { id: 'a', parentId: 'q1', label: 'A', children: [] },
        { id: 'b', parentId: 'q1', label: 'B', dependsOn: ['ghost'], children: [] },
      ]),
    ],
    []
  );
  const got = validateRpgGraphReferences(graph, graph.edges);
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.reason, /dependsOn/);
});

test('validateRpgGraphReferences rejects duplicate node ids inside one quest', () => {
  const graph = makeRpgGraph(
    [
      makeQuest('q1', [
        { id: 'dup', parentId: 'q1', label: 'First', children: [] },
        { id: 'dup', parentId: 'q1', label: 'Second', children: [] },
      ]),
    ],
    []
  );
  const got = validateRpgGraphReferences(graph, graph.edges);
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.reason, /doppelte Node-IDs/);
});

test('resolveNodeGuardQuest prefers explicit root quest over pseudo subtree node', () => {
  const pseudoSubtreeNode = { id: 'q1::sub', children: [] };
  const rootQuest = { id: 'q1', children: [] };
  const got = resolveNodeGuardQuest(pseudoSubtreeNode, rootQuest);
  assert.equal(got, rootQuest);
});

test('migrateRpgGraphToV2 always returns canonical nodes+quests graph shape', () => {
  const graph = {
    quests: [makeQuest('q1', [{ id: 'n1', parentId: 'q1', label: 'N1', children: [] }])],
    edges: [],
  };
  const migrated = migrateRpgGraphToV2(graph);
  assert.ok(Array.isArray(migrated.nodes));
  assert.ok(Array.isArray(migrated.quests));
  assert.equal(migrated.nodes, migrated.quests);
  assert.equal(migrated.nodes.length, 1);
});

test('deriveRpgTreeSelectionView builds pseudo-node view for subtree selection', () => {
  const quest = makeQuest('q1', [
    {
      id: 'a',
      parentId: 'q1',
      label: 'A',
      children: [{ id: 'b', parentId: 'a', label: 'B', children: [] }],
    },
  ]);
  const byId = new Map([[quest.id, quest]]);
  const sel = deriveRpgTreeSelectionView(byId, 'q1', { questId: 'q1', nodeId: 'a' });
  assert.equal(sel.selectedRootNode?.id, 'q1');
  assert.equal(sel.selectedIsRootNode, false);
  assert.equal(sel.selectedNodeView?.id, 'q1::a');
});
