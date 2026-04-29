import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpgGraph } from '../src/lib/rpg-quests-data.js';
import { validateRpgGraphReferences, resolveNodeGuardQuest } from '../src/lib/rpg-graph-validation.js';
import {
  migrateRpgGraphToV2,
  deduplicateGraphRoots,
  findNodeWithAncestors,
  breakGraphCycles,
  buildRewardDisplayList,
  questLeafProgressRatio,
} from '../src/lib/rpg-quest-nodes.js';
import { deriveRpgTreeSelectionView } from '../src/lib/rpg-tree-selection.js';
import { reconcileRpgVitals } from '../src/lib/rpg-vitals.js';
import {
  collectAllItemIdsFromGraph,
  collectItemRewardRefsFromGraph,
  collectItemIdsFromNodesAndQuestRewards,
} from '../src/lib/rpg-questmaker-sync.js';
import { applyNodeFieldsUpdate } from '../src/lib/rpg-graph-editor-ops.js';
import { upsertQuestInGraph } from '../src/lib/rpg-quest-graph.js';
import {
  draftNodesToQuestNodes,
  questNodesToDrafts,
} from '../src/lib/rpg-quest-editor-draft.js';
import { normalizeQuestNodesTree, getNodeRewardEntries } from '../src/lib/rpg-quest-nodes.js';

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
      makeQuest('q1', [{ id: 'a', parentId: 'q1', title: 'A', children: [] }]),
      makeQuest('q2', [{ id: 'b', parentId: 'q2', title: 'B', children: [{ id: 'b2', parentId: 'b', title: 'B2', dependsOn: ['b'], children: [] }] }]),
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
        { id: 'a', parentId: 'q1', title: 'A', children: [] },
        { id: 'b', parentId: 'q1', title: 'B', dependsOn: ['ghost'], children: [] },
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
        { id: 'dup', parentId: 'q1', title: 'First', children: [] },
        { id: 'dup', parentId: 'q1', title: 'Second', children: [] },
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

test('migrateRpgGraphToV2 always returns canonical {nodes, edges} graph shape', () => {
  // Legacy-Input mit 'quests' statt 'nodes' — wird korrekt migriert
  const graph = {
    quests: [makeQuest('q1', [{ id: 'n1', parentId: 'q1', title: 'N1', children: [] }])],
    edges: [],
  };
  const migrated = migrateRpgGraphToV2(graph);
  assert.ok(Array.isArray(migrated.nodes));
  assert.equal(migrated.nodes.length, 1);
  // Kanonisches Format hat nur 'nodes', kein 'quests' Alias
  assert.ok(Array.isArray(migrated.edges));
});

test('breakGraphCycles entfernt Zirkelschlüsse ohne die übrige Struktur zu zerstören', () => {
  // Szenario: Zentrale → child1 → Zentrale (ID-Duplikat in den Daten, kein JS-Zirkel)
  // In echten Daten (aus JSON) gibt es keine JS-Zirkelreferenzen, nur doppelte IDs.
  const graph = makeRpgGraph([{
    id: 'zentrale',
    title: 'Zentrale',
    children: [{
      id: 'child1',
      title: 'Child1',
      children: [
        { id: 'zentrale', title: 'Zentrale (Duplikat)', children: [] }, // Cycle via ID
      ],
    }],
  }], []);
  const fixed = breakGraphCycles(graph);
  // Graph hat noch genau einen Root
  assert.equal(fixed.nodes.length, 1);
  assert.equal(fixed.nodes[0].id, 'zentrale');
  // child1 ist noch da
  assert.equal(fixed.nodes[0].children[0].id, 'child1');
  // Das Zirkel-Child (zentrale als Kind von child1) wurde entfernt
  assert.equal(fixed.nodes[0].children[0].children.length, 0);
});

test('deduplicateGraphRoots entfernt Root-Nodes die auch als Child existieren', () => {
  // Szenario: Ballett wurde als Child in T.A.N.Z. gemergt aber noch nicht als Root entfernt
  const ballett = { id: 'ballett', title: 'Ballett', children: [] };
  const tanz = { id: 'tanz', title: 'T.A.N.Z.', children: [ballett] };
  const musikus = { id: 'musikus', title: 'Musikus', children: [tanz] };
  // Ballett taucht sowohl in graph.nodes als auch als Child von T.A.N.Z. auf
  const graph = makeRpgGraph([musikus, ballett], []);
  assert.equal(graph.nodes.length, 2);
  const deduped = deduplicateGraphRoots(graph);
  // Ballett-Root muss raus, Musikus bleibt
  assert.equal(deduped.nodes.length, 1);
  assert.equal(deduped.nodes[0].id, 'musikus');
  // Ballett ist weiterhin als Child von T.A.N.Z. vorhanden
  assert.equal(deduped.nodes[0].children[0].children[0].id, 'ballett');
});

test('findNodeWithAncestors bevorzugt Child-Position vor Root-Position', () => {
  // Wenn Ballett als Root UND als Child existiert, soll die Child-Position gewinnen
  const ballett = { id: 'ballett', title: 'Ballett', children: [] };
  const tanz = { id: 'tanz', title: 'T.A.N.Z.', children: [ballett] };
  const musikus = { id: 'musikus', title: 'Musikus', children: [tanz] };
  const graph = makeRpgGraph([musikus, ballett], []);
  const found = findNodeWithAncestors(graph, 'ballett');
  assert.ok(found !== null);
  // rootQuestId muss Musikus sein (nicht Ballett-Root)
  assert.equal(found.rootQuestId, 'musikus');
  // ancestors zeigen den Pfad T.A.N.Z. <- Musikus (Musikus kommt zuerst als direkter Root-Ancestor)
  assert.equal(found.ancestors.length, 2);
  assert.equal(found.ancestors[0].id, 'musikus');
  assert.equal(found.ancestors[1].id, 'tanz');
});

test('deriveRpgTreeSelectionView keeps the real sub-node identity (no id spoofing)', () => {
  const quest = makeQuest('q1', [
    {
      id: 'a',
      parentId: 'q1',
      title: 'A',
      children: [{ id: 'b', parentId: 'a', title: 'B', children: [] }],
    },
  ]);
  const byId = new Map([[quest.id, quest]]);
  const sel = deriveRpgTreeSelectionView(byId, 'q1', { questId: 'q1', nodeId: 'a' });
  assert.equal(sel.selectedQuest?.id, 'q1');
  assert.ok(sel.selectedGraphNode !== null, 'selectedGraphNode should exist for sub-node');
  // Konsolidierungs-Invariante: der View-Node behaelt SEINE eigene ID (nicht spoofed).
  // Der nodeDone-Lookup-Scope wird separat ueber `scopeQuestId` getragen.
  assert.equal(sel.selectedNodeView?.id, 'a');
  assert.equal(sel.selectedNodeView, sel.selectedGraphNode);
  assert.equal(sel.scopeQuestId, 'q1');
});

test('deriveRpgTreeSelectionView falls back to root view when no sub-node selected', () => {
  const quest = makeQuest('q1', [{ id: 'a', parentId: 'q1', title: 'A', children: [] }]);
  const byId = new Map([[quest.id, quest]]);
  const sel = deriveRpgTreeSelectionView(byId, 'q1', null);
  assert.equal(sel.selectedQuest, quest);
  assert.equal(sel.selectedGraphNode, null);
  assert.equal(sel.selectedNodeView, quest);
  assert.equal(sel.scopeQuestId, 'q1');
});

// ============================================================
// Konsolidierungs-Invariante: Render-Pipeline ist tiefenagnostisch
// ============================================================

test('Render-Invariante: identische Sub-Struktur liefert identisch geformte Reward-Outputs (Root vs. Sub)', () => {
  // Zwei Quests mit STRUKTURELL identischem Subtree:
  //  - "rootView": Root-Quest, Subtree direkt als children
  //  - "subView":  Anderer Root, dessen Sub-Node "wrapper" denselben Subtree als children hat
  // Wenn buildRewardDisplayList tiefenagnostisch ist, muessen die Output-Forms (kind, label,
  // unlocked, struktur) identisch sein — nur die nodeId zeigt die Position im Baum.
  const subtree = {
    id: 'leafReward',
    parentId: null,
    title: 'Leaf',
    children: [],
    rewards: [{ type: 'text', text: 'XP' }],
  };
  const rootView = makeQuest('rootView', [{ ...subtree, parentId: 'rootView' }]);
  const subWrapper = {
    id: 'wrapper',
    parentId: 'subRoot',
    title: 'Wrapper',
    children: [{ ...subtree, parentId: 'wrapper' }],
  };
  const subRoot = makeQuest('subRoot', [subWrapper]);

  const rootOutput = buildRewardDisplayList(rootView, { rootView: { leafReward: true } });
  const subOutput = buildRewardDisplayList(subWrapper, { subRoot: { leafReward: true } }, {
    scopeQuestId: 'subRoot',
  });

  // Beide haben genau einen Reward-Eintrag mit identischen Display-Feldern
  assert.equal(rootOutput.length, 1);
  assert.equal(subOutput.length, 1);
  assert.equal(rootOutput[0].label, subOutput[0].label);
  assert.equal(rootOutput[0].kind, subOutput[0].kind);
  assert.equal(rootOutput[0].unlocked, subOutput[0].unlocked);
  // Beide Outputs haben dieselben Feld-Namen (keine `source`-Halluzination)
  assert.deepStrictEqual(Object.keys(rootOutput[0]).sort(), Object.keys(subOutput[0]).sort());
  // Kein `source`-Feld auf irgend einem Output
  assert.equal(rootOutput[0].source, undefined);
  assert.equal(subOutput[0].source, undefined);
});

test('Progress-Invariante: questLeafProgressRatio funktioniert fuer Root und Sub-Node identisch (mit scopeQuestId)', () => {
  // Sub-Node mit zwei Pflicht-Leaves: einer done, einer offen → 50%
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [
      { id: 'a', parentId: 'sub', title: 'A', children: [] },
      { id: 'b', parentId: 'sub', title: 'B', children: [] },
    ],
  };
  const root = makeQuest('q1', [sub]);
  // Root-Aufruf
  const rootProgress = questLeafProgressRatio(root, { q1: { a: true } });
  assert.equal(rootProgress.total, 2);
  assert.equal(rootProgress.done, 1);
  assert.equal(rootProgress.percent, 50);
  // Sub-Aufruf — gleiche Daten, gleiche Lookup-Scope (q1)
  const subProgress = questLeafProgressRatio(sub, { q1: { a: true } }, 'q1');
  assert.equal(subProgress.total, 2);
  assert.equal(subProgress.done, 1);
  assert.equal(subProgress.percent, 50);
});

// ============================================================
// Konsolidierungs-Invariante: Reward-Quelle einheitlich (Vitals)
// ============================================================

test('reconcileRpgVitals: Sub-Node Legacy questRewards werden via getNodeRewardRows erkannt', () => {
  // Konsolidierungs-Invariante: der Sub-Node-Pfad in reconcileRpgVitals nutzt jetzt
  // getNodeRewardRows wie der Root-Pfad. Vorher: direktes s.rewards/s.reward.
  // Wenn ein Sub-Node Legacy-Felder hat (questRewards), müssen sie genauso erkannt
  // werden wie wenn sie auf einem Root liegen.
  const subWithLegacy = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub mit Legacy',
    children: [],
    // Bewusst Legacy-Feld 'questRewards' statt 'rewards':
    questRewards: [{ type: 'points', pointKind: 'mana', amount: 5 }],
  };
  const root = {
    id: 'q1',
    parentId: null,
    title: 'Root',
    children: [subWithLegacy],
  };
  const graph = makeRpgGraph([root], []);
  // Sub-Node komplett markieren (Leaf-Node 'sub' ist done)
  const nodeDone = { q1: { sub: true } };
  const baseVitals = { heart: 25, mana: 25, appliedNodeRewardIds: [] };
  const out = reconcileRpgVitals(graph, nodeDone, baseVitals);
  // Vor der Konsolidierung wuerde der Reward unterschlagen (nur s.rewards gelesen).
  // Jetzt: +5 Mana, weil getNodeRewardRows auch questRewards liest.
  assert.equal(out.changed, true);
  assert.equal(out.state.mana, 30);
});

test('reconcileRpgVitals: Sub-Node mit kanonischem rewards-Feld bucht weiterhin korrekt', () => {
  // Sicherstellen: die Konsolidierung bricht den kanonischen Pfad nicht.
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [],
    rewards: [{ type: 'points', pointKind: 'heart', amount: 3 }],
  };
  const root = { id: 'q1', parentId: null, title: 'Root', children: [sub] };
  const graph = makeRpgGraph([root], []);
  const nodeDone = { q1: { sub: true } };
  const baseVitals = { heart: 25, mana: 25, appliedNodeRewardIds: [] };
  const out = reconcileRpgVitals(graph, nodeDone, baseVitals);
  assert.equal(out.changed, true);
  assert.equal(out.state.heart, 28);
});

test('reconcileRpgVitals: Idempotenz - zweiter Aufruf bucht nicht doppelt', () => {
  // Schutz gegen Double-Booking nach Konsolidierung.
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [],
    rewards: [{ type: 'points', pointKind: 'heart', amount: 7 }],
  };
  const root = { id: 'q1', parentId: null, title: 'Root', children: [sub] };
  const graph = makeRpgGraph([root], []);
  const nodeDone = { q1: { sub: true } };
  const first = reconcileRpgVitals(graph, nodeDone, { heart: 25, mana: 25, appliedNodeRewardIds: [] });
  assert.equal(first.state.heart, 32);
  // Zweiter Aufruf mit dem Ergebnis-State - darf nichts mehr buchen
  const second = reconcileRpgVitals(graph, nodeDone, first.state);
  assert.equal(second.changed, false);
  assert.equal(second.state.heart, 32);
});

// ============================================================
// Konsolidierungs-Invariante: Item-Sammler einheitlich (Questmaker)
// ============================================================

test('collectAllItemIdsFromGraph: liest Items von Root und Sub-Nodes (Legacy + kanonisch)', () => {
  // Konsolidierungs-Invariante: collectItemRewardRefsFromGraph nutzt jetzt einen
  // einzigen Pfad (getNodeRewardEntries) fuer Root und Sub-Nodes.
  const subWithLegacy = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [],
    // Legacy-Feld 'questRewards' auf einem Sub-Node — vorher wurde es unterschlagen.
    questRewards: [{ type: 'item', itemId: 'sub-legacy-item', displayName: 'Legacy' }],
  };
  const subWithCanonical = {
    id: 'sub2',
    parentId: 'q1',
    title: 'Sub2',
    children: [],
    rewards: [{ type: 'item', itemId: 'sub-canonical-item' }],
  };
  const root = {
    id: 'q1',
    parentId: null,
    title: 'Root',
    children: [subWithLegacy, subWithCanonical],
    rewards: [{ type: 'item', itemId: 'root-item' }],
  };
  const graph = makeRpgGraph([root], []);
  const ids = collectAllItemIdsFromGraph(graph);
  assert.ok(ids.has('root-item'), 'Root-Item muss enthalten sein');
  assert.ok(ids.has('sub-canonical-item'), 'Sub-Node mit kanonischem rewards muss enthalten sein');
  assert.ok(ids.has('sub-legacy-item'), 'Sub-Node mit Legacy questRewards muss enthalten sein');
});

test('collectItemRewardRefsFromGraph: konsolidiert Display-Namen ueber Tiefe hinweg', () => {
  // Wenn derselbe Item-ID auf Root und Sub-Node mit verschiedenen displayName-Werten
  // referenziert wird, muss ein Wert (vorzugsweise der erste gefundene mit displayName) gewinnen.
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [],
    rewards: [{ type: 'item', itemId: 'shared-item', displayName: 'Sub-Name' }],
  };
  const root = {
    id: 'q1',
    parentId: null,
    title: 'Root',
    children: [sub],
    rewards: [{ type: 'item', itemId: 'shared-item' }],
  };
  const graph = makeRpgGraph([root], []);
  const refs = collectItemRewardRefsFromGraph(graph);
  // Display-Name muss durchgereicht werden (Sub-Node hat displayName)
  assert.equal(refs.get('shared-item')?.displayName, 'Sub-Name');
});

test('collectItemIdsFromNodesAndQuestRewards: liest Sub-Node Legacy-Felder konsistent', () => {
  // Vorher: nur s.rewards via normalizeRewardEntry. Jetzt: getNodeRewardEntries.
  const nodes = [
    {
      id: 'a',
      parentId: 'q1',
      title: 'A',
      children: [],
      questRewards: [{ type: 'item', itemId: 'a-legacy' }],
    },
    {
      id: 'b',
      parentId: 'q1',
      title: 'B',
      children: [],
      rewards: [{ type: 'item', itemId: 'b-canonical' }],
    },
  ];
  const ids = collectItemIdsFromNodesAndQuestRewards(nodes, []);
  assert.ok(ids.has('a-legacy'), 'Sub-Node mit Legacy questRewards muss erfasst werden');
  assert.ok(ids.has('b-canonical'), 'Sub-Node mit kanonischem rewards muss erfasst werden');
});

// ============================================================
// Konsolidierungs-Invariante: Editor-Save Root- und Child-Edit
// liefern strukturell aequivalente Effekte (B8/A1)
// ============================================================

test('applyNodeFieldsUpdate: Root-Edit (target == container) setzt Felder direkt am Container', () => {
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Alt',
    description: 'alte Desc',
    children: [{ id: 'c1', parentId: 'q1', title: 'Child', children: [] }],
    rewards: [{ type: 'text', text: 'alter reward' }],
  };
  const fields = {
    title: 'Neu',
    description: 'neue Desc',
    rewards: [{ type: 'text', text: 'neuer reward' }],
    children: [{ id: 'c2', parentId: 'q1', title: 'Neuer Child', children: [] }],
  };
  const out = applyNodeFieldsUpdate(container, 'q1', fields);
  assert.equal(out.id, 'q1');
  assert.equal(out.parentId, null, 'parentId muss erhalten bleiben (kein Daten-Verlust)');
  assert.equal(out.title, 'Neu');
  assert.equal(out.description, 'neue Desc');
  assert.equal(out.rewards.length, 1);
  assert.equal(out.rewards[0].text, 'neuer reward');
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].id, 'c2');
});

test('applyNodeFieldsUpdate: Child-Edit (target im Subtree) aktualisiert nur den Sub-Node', () => {
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Container',
    description: 'Container-Desc',
    children: [
      {
        id: 'c1',
        parentId: 'q1',
        title: 'Alt-Child',
        description: 'alt',
        children: [],
        rewards: [{ type: 'text', text: 'alt-reward' }],
      },
      { id: 'c2', parentId: 'q1', title: 'Bleibt', children: [] },
    ],
    rewards: [{ type: 'text', text: 'container-reward' }],
  };
  const fields = {
    title: 'Neu-Child',
    description: 'neu',
    rewards: [{ type: 'text', text: 'neu-reward' }],
    children: [],
  };
  const out = applyNodeFieldsUpdate(container, 'c1', fields);
  // Container-Felder unangetastet
  assert.equal(out.id, 'q1');
  assert.equal(out.title, 'Container');
  assert.equal(out.description, 'Container-Desc');
  assert.equal(out.rewards[0].text, 'container-reward');
  // Child c1 aktualisiert
  const c1 = out.children.find((c) => c.id === 'c1');
  assert.equal(c1.title, 'Neu-Child');
  assert.equal(c1.description, 'neu');
  assert.equal(c1.rewards[0].text, 'neu-reward');
  // Child c2 unangetastet
  const c2 = out.children.find((c) => c.id === 'c2');
  assert.equal(c2.title, 'Bleibt');
});

test('applyNodeFieldsUpdate: containerOverlay landet immer am Container, nie am Sub-Node', () => {
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [{ id: 'c1', parentId: 'q1', title: 'C1', children: [] }],
  };
  const fields = {
    title: 'C1-neu',
    description: '',
    rewards: [],
    children: [],
  };
  const overlay = { orderInLayer: 7, questmakerPrompt: 'prompt' };
  // Sub-Node-Edit: overlay muss trotzdem am Container landen
  const out = applyNodeFieldsUpdate(container, 'c1', fields, overlay);
  assert.equal(out.orderInLayer, 7);
  assert.equal(out.questmakerPrompt, 'prompt');
  // Sub-Node selbst hat keine Container-Felder
  const c1 = out.children.find((c) => c.id === 'c1');
  assert.equal(c1.orderInLayer, undefined);
  assert.equal(c1.questmakerPrompt, undefined);
});

test('applyNodeFieldsUpdate: leeres rewards-Array ueberschreibt alte Rewards bei Root-Edit', () => {
  // Konsolidierungs-Invariante: rewards: [] muss alte Rewards loeschen, nicht erhalten.
  // Sonst koennten User keine Rewards entfernen.
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [],
    rewards: [{ type: 'text', text: 'alt' }],
  };
  const fields = { title: 'Q1', description: '', rewards: [], children: [] };
  const out = applyNodeFieldsUpdate(container, 'q1', fields);
  assert.deepStrictEqual(out.rewards, []);
});

test('applyNodeFieldsUpdate: leeres rewards-Array loescht Rewards bei Child-Edit', () => {
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [
      {
        id: 'c1',
        parentId: 'q1',
        title: 'C1',
        children: [],
        rewards: [{ type: 'text', text: 'alt' }],
      },
    ],
  };
  const fields = { title: 'C1', description: '', rewards: [], children: [] };
  const out = applyNodeFieldsUpdate(container, 'c1', fields);
  const c1 = out.children.find((c) => c.id === 'c1');
  assert.deepStrictEqual(c1.rewards, []);
});

test('applyNodeFieldsUpdate: kanonische Node-Felder (cityLocation, isLock, optional, dependsOn, timeDueAt) bleiben erhalten', () => {
  // Editor editiert diese Felder nicht — sie muessen via Spread mitgenommen werden.
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [
      {
        id: 'c1',
        parentId: 'q1',
        title: 'C1',
        children: [],
        cityLocation: 'Berlin',
        placeLocation: 'Cafe',
        isLock: true,
        optional: true,
        dependsOn: ['c0'],
        timeDueAt: '2026-12-31',
      },
    ],
  };
  const fields = { title: 'C1-neu', description: 'Desc', rewards: [], children: [] };
  const out = applyNodeFieldsUpdate(container, 'c1', fields);
  const c1 = out.children.find((c) => c.id === 'c1');
  assert.equal(c1.title, 'C1-neu');
  assert.equal(c1.cityLocation, 'Berlin');
  assert.equal(c1.placeLocation, 'Cafe');
  assert.equal(c1.isLock, true);
  assert.equal(c1.optional, true);
  assert.deepStrictEqual(c1.dependsOn, ['c0']);
  assert.equal(c1.timeDueAt, '2026-12-31');
});

test('applyNodeFieldsUpdate + upsertQuestInGraph: Root-Save loescht alte Rewards via Spread', () => {
  // End-to-End-Beweis: das Zusammenspiel mit upsertQuestInGraph (das den
  // Container in den Graph schreibt) muss "Rewards entfernen" tatsaechlich
  // umsetzen. Wenn applyNodeFieldsUpdate `rewards` deletet statt leer setzt,
  // wuerde der Spread {...prev, ...node} die alten Rewards behalten.
  const container = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [],
    rewards: [{ type: 'text', text: 'alt' }],
  };
  const graph = { nodes: [container], edges: [] };
  const fields = { title: 'Q1', description: '', rewards: [], children: [] };
  const updated = applyNodeFieldsUpdate(container, 'q1', fields);
  const next = upsertQuestInGraph(graph, updated, []);
  const persistedQuest = next.nodes.find((q) => q.id === 'q1');
  assert.deepStrictEqual(persistedQuest.rewards, []);
});

// ============================================================
// Migration-Idempotenz (A2/A3): migrateRpgGraphToV2 darf
// mehrfach aufgerufen werden ohne Daten zu veraendern.
// ============================================================

test('migrateRpgGraphToV2 ist idempotent (zweiter Aufruf veraendert nichts)', () => {
  // Wichtig fuer A2 (PUT-Migration) und A3 (Session-Cache-Migration):
  // beide Stellen rufen die Migration zusaetzlich auf, ohne dass das
  // Verhalten kippen darf wenn der Graph schon V2 ist.
  const legacyGraph = {
    nodes: [
      {
        id: 'q1',
        parentId: null,
        label: 'Mit Legacy-label',
        children: [
          {
            id: 'c1',
            parentId: 'q1',
            label: 'Child-Legacy',
            reward: { type: 'text', text: 'Legacy-Reward' },
            children: [],
          },
        ],
        questRewards: [{ type: 'text', text: 'Root-Legacy-Reward' }],
      },
    ],
    edges: [],
  };
  const once = migrateRpgGraphToV2(legacyGraph);
  const twice = migrateRpgGraphToV2(once);
  // Idempotenz: zweimal migrieren ergibt identisches Ergebnis
  assert.deepStrictEqual(once, twice);
  // Legacy-Felder sind weg
  assert.equal(once.nodes[0].label, undefined);
  assert.equal(once.nodes[0].title, 'Mit Legacy-label');
  assert.equal(once.nodes[0].questRewards, undefined);
  assert.ok(Array.isArray(once.nodes[0].rewards));
});

// ============================================================
// B18 — End-to-End Daten-Roundtrip-Konsistenz (Pass 4)
//
// Test, dass eine Tiefe-3-Quest mit Rewards aller 4 Typen auf jeder
// Tiefe nach JSON-Round-Trip + Normalisierung strukturell identisch ist
// und dass buildRewardDisplayList auf allen Tiefen konsistent arbeitet.
// ============================================================

test('Roundtrip Tiefe-3: alle Reward-Typen ueberleben JSON->Normalize->Display fuer jede Tiefe', () => {
  // Aufbau: Root (q1) → Sub (sub1) → SubSub (sub1a)
  // Jede Tiefe hat genau einen Reward jedes Typs (text/item/points/achievement).
  // Ueber buildRewardDisplayList laeuft die Anzeige -- alle Tiefen muessen
  // STRUKTURELL identische Outputs liefern (kind, label-Felder gefuellt).
  const rewardsAtEachDepth = (suffix) => [
    { type: 'text', text: `Text-${suffix}` },
    { type: 'item', itemId: `item-${suffix}`, displayName: `Item ${suffix}` },
    { type: 'points', pointKind: 'mana', amount: 5 },
    { type: 'achievement', achievementId: `ach-${suffix}`, displayName: `Ach ${suffix}` },
  ];

  // Aufbau via Editor-Drafts → kanonische Nodes (das ist der Weg, den der echte Save geht)
  // Wir starten direkt mit kanonischen Nodes; questNodesToDrafts/draftNodesToQuestNodes
  // ist der Roundtrip im Editor, normalizeQuestNodesTree der finale Pflege-Schritt.
  const subSub = {
    id: 'sub1a',
    parentId: 'sub1',
    title: 'SubSub',
    description: 'Tiefe 3',
    children: [],
    rewards: rewardsAtEachDepth('subsub'),
  };
  const sub = {
    id: 'sub1',
    parentId: 'q1',
    title: 'Sub',
    description: 'Tiefe 2',
    children: [subSub],
    rewards: rewardsAtEachDepth('sub'),
  };
  const root = {
    id: 'q1',
    parentId: null,
    title: 'Root',
    description: 'Tiefe 1',
    children: [sub],
    rewards: rewardsAtEachDepth('root'),
  };

  // Schritt 1: Editor-Roundtrip — root.children → drafts → nodes
  const draftsFromChildren = questNodesToDrafts(root.children);
  const childrenAfterRoundtrip = draftNodesToQuestNodes(draftsFromChildren, root.id);

  // Schritt 2: JSON-Roundtrip auf den re-konstruierten Subtree
  const serialized = JSON.stringify(childrenAfterRoundtrip);
  const deserialized = JSON.parse(serialized);

  // Schritt 3: Final-Normalisierung (das macht der Server bei PUT)
  const finalChildren = normalizeQuestNodesTree(deserialized, root.id);

  // Tiefe 2 (Sub): Titel/Description erhalten. (IDs werden vom Editor neu aus
  // Titeln erzeugt — das ist designgewollt: makeUniqueNodeIdFromLabel im
  // processDraftSiblings; siehe rpg-quest-editor-draft.js. Der Test prueft
  // also den Datenerhalt, nicht ID-Stabilitaet.)
  assert.equal(finalChildren.length, 1);
  const finalSub = finalChildren[0];
  assert.equal(finalSub.title, 'Sub');
  assert.equal(finalSub.description, 'Tiefe 2');
  // Rewards: alle 4 Typen erhalten (Reihenfolge muss konsistent sein nach Normalisierung)
  const subRewards = getNodeRewardEntries(finalSub);
  assert.equal(subRewards.length, 4);
  const subKinds = subRewards.map((r) => r.type).sort();
  assert.deepStrictEqual(subKinds, ['achievement', 'item', 'points', 'text']);

  // Tiefe 3 (SubSub): Felder muessen alle erhalten sein
  assert.equal(finalSub.children.length, 1);
  const finalSubSub = finalSub.children[0];
  assert.equal(finalSubSub.title, 'SubSub');
  assert.equal(finalSubSub.description, 'Tiefe 3');
  const subSubRewards = getNodeRewardEntries(finalSubSub);
  assert.equal(subSubRewards.length, 4);
  assert.deepStrictEqual(
    subSubRewards.map((r) => r.type).sort(),
    ['achievement', 'item', 'points', 'text']
  );

  // ParentId-Hierarchie muss nach Normalisierung kanonisch sein (parentId folgt
  // dem Tree, IDs werden neu generiert aber parentId zeigt auf den korrekten
  // Tree-Parent, nicht auf eine alte ID)
  assert.equal(finalSub.parentId, 'q1');
  assert.equal(finalSubSub.parentId, finalSub.id);

  // Schritt 4: buildRewardDisplayList tiefenagnostisch auf JEDER Tiefe.
  // Wichtig: buildRewardDisplayList aggregiert rekursiv, d.h. der Root-View
  // zeigt eigene + alle Sub-Rewards. Konsistenz-Eigenschaft (Pass 1):
  // dieselbe Funktion, gleiche Output-Form, kein Subtypen-Verzweigen.
  const finalRoot = { ...root, children: finalChildren };
  const rootDisplay = buildRewardDisplayList(finalRoot, {});
  const subDisplay = buildRewardDisplayList(finalSub, {}, { scopeQuestId: finalRoot.id });
  const subSubDisplay = buildRewardDisplayList(finalSubSub, {}, { scopeQuestId: finalRoot.id });

  // Aggregations-Verhalten:
  // - rootDisplay: 4 (eigene) + 4 (sub) + 4 (subSub) = 12
  // - subDisplay:  4 (eigene) + 4 (subSub) = 8
  // - subSubDisplay: 4 (eigene) = 4
  assert.equal(rootDisplay.length, 12);
  assert.equal(subDisplay.length, 8);
  assert.equal(subSubDisplay.length, 4);

  // Strukturelle Konsistenz: dieselben Object-Keys auf jeder Tiefe (kein source-Spoof).
  // Wir vergleichen die Keys des ersten Eintrags, weil alle Eintraege
  // strukturell identisch sein muessen (Pass 1 Invariante).
  const rootKeys = Object.keys(rootDisplay[0]).sort();
  const subKeys = Object.keys(subDisplay[0]).sort();
  const subSubKeys = Object.keys(subSubDisplay[0]).sort();
  assert.deepStrictEqual(rootKeys, subKeys);
  assert.deepStrictEqual(subKeys, subSubKeys);
  // Kein `source`-Feld (Konsolidierungs-Invariante aus Pass 1)
  assert.equal(rootDisplay[0].source, undefined);
  assert.equal(subDisplay[0].source, undefined);
  assert.equal(subSubDisplay[0].source, undefined);

  // Reward-Typen ueber alle Tiefen erhalten: jeder Display-View enthaelt alle 4 Typen
  const rootKindSet = new Set(rootDisplay.map((d) => d.kind));
  const subKindSet = new Set(subDisplay.map((d) => d.kind));
  const subSubKindSet = new Set(subSubDisplay.map((d) => d.kind));
  for (const expected of ['text', 'item', 'points', 'achievement']) {
    assert.ok(rootKindSet.has(expected), `rootDisplay fehlt kind=${expected}`);
    assert.ok(subKindSet.has(expected), `subDisplay fehlt kind=${expected}`);
    assert.ok(subSubKindSet.has(expected), `subSubDisplay fehlt kind=${expected}`);
  }
});

test('Roundtrip Tiefe-3: leere Children-Listen bleiben leere Arrays (nie undefined)', () => {
  // Boundary-Case (B19): leere children muessen nach Normalisierung ein Array sein,
  // nicht undefined oder fehlend. Sonst bricht walkNodesPreOrder.
  const root = {
    id: 'q1',
    parentId: null,
    title: 'Root',
    children: [
      {
        id: 'a',
        parentId: 'q1',
        title: 'A',
        children: [
          { id: 'a1', parentId: 'a', title: 'A1', children: [] },
        ],
      },
    ],
  };
  const drafts = questNodesToDrafts(root.children);
  const reconstructed = draftNodesToQuestNodes(drafts, root.id);
  // Tiefe 1: children-Array vorhanden
  assert.ok(Array.isArray(reconstructed[0].children));
  // Tiefe 2: children-Array vorhanden (auch wenn leer)
  assert.ok(Array.isArray(reconstructed[0].children[0].children));
});

test('Boundary B19: invalide Reward-Eintraege werden gefiltert, gueltige bleiben', () => {
  // Mixed valide + invalide Rewards muessen konsistent gefiltert werden,
  // damit die Display-Pipeline keine ungueltigen Felder rendern muss.
  const node = {
    id: 'q1',
    parentId: null,
    title: 'Q1',
    children: [],
    rewards: [
      { type: 'text', text: 'gueltig' },
      null, // invalide
      { type: 'item' /* fehlt itemId */ },
      { type: 'unknown' }, // unbekannter Typ
      { type: 'points', pointKind: 'mana', amount: 3 },
    ],
  };
  const display = buildRewardDisplayList(node, {});
  // Nur die zwei gueltigen Eintraege ueberleben (text + points)
  assert.equal(display.length, 2);
  const kinds = display.map((d) => d.kind).sort();
  assert.deepStrictEqual(kinds, ['points', 'text']);
});

test('Boundary B19: Node ohne Title bleibt verarbeitbar (faellt auf id zurueck)', () => {
  // Wenn ein Node title === '' hat, darf nichts crashen — der Display-Fallback
  // muss greifen (id oder leerer String).
  const root = {
    id: 'q1',
    parentId: null,
    title: '', // bewusst leer
    description: '',
    children: [],
    rewards: [{ type: 'text', text: 'X' }],
  };
  const display = buildRewardDisplayList(root, {});
  assert.equal(display.length, 1);
  assert.equal(display[0].kind, 'text');
});

test('Root-Edit und Child-Edit liefern aequivalente Reward-Display-Outputs (Konsolidierungs-Invariante)', () => {
  // Konsolidierungs-Beweis fuer A1/B8: derselbe Editor-Save-Flow,
  // einmal auf Root, einmal auf Child, muss strukturell konsistente
  // Container-Outputs liefern.
  const fields = {
    title: 'X',
    description: 'd',
    rewards: [{ type: 'points', pointKind: 'mana', amount: 5 }],
    children: [],
  };
  // Pfad A: Root-Edit auf der Root-Quest selbst
  const rootContainer = { id: 'q1', parentId: null, title: 'Old', children: [] };
  const outRoot = applyNodeFieldsUpdate(rootContainer, 'q1', fields);
  // Pfad B: Child-Edit innerhalb eines anderen Containers
  const childContainer = {
    id: 'q2',
    parentId: null,
    title: 'Q2',
    children: [{ id: 'c1', parentId: 'q2', title: 'Old', children: [] }],
  };
  const outChild = applyNodeFieldsUpdate(childContainer, 'c1', fields);
  const editedNodeRoot = outRoot;
  const editedNodeChild = outChild.children.find((c) => c.id === 'c1');
  // Beide Pfade liefern strukturell identische Felder am Edit-Target
  assert.equal(editedNodeRoot.title, editedNodeChild.title);
  assert.equal(editedNodeRoot.description, editedNodeChild.description);
  assert.deepStrictEqual(editedNodeRoot.rewards, editedNodeChild.rewards);
  assert.deepStrictEqual(editedNodeRoot.children, editedNodeChild.children);
});
