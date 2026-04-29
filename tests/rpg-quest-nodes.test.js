/**
 * Tests fuer rpg-quest-nodes.js — Node-Normalisierung, Completion, Fortschritt, Migration.
 *
 * Deckt ab:
 * - normalizeQuestNodesTree (kanonische Form, Legacy-Felder, Auto-IDs)
 * - isNodeCompleteInQuest (Gruppen, Blaetter, dependsOn, Locks, Zyklen)
 * - canSetNodeDone (Lock-Guards, Dependency-Guards)
 * - questLeafProgressRatio (Fortschrittsberechnung)
 * - migrateRpgGraphToV2 (Legacy-Migration)
 * - buildRewardDisplayList (Reward-Aggregation mit Unlock-Status)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuestNodesTree,
  flatLegacyNodesToNormalized,
  findNodeById,
  nodeIsLeaf,
  isLockNode,
  walkNodesPreOrder,
  buildNodeIdMap,
  isNodeCompleteInQuest,
  canSetNodeDone,
  questLeafProgressRatio,
  questProgressFromNodes,
  isQuestCompletedFromNodes,
  questHasUrgentTimeBoundLeaves,
  buildRewardDisplayList,
  migrateNodeToV2Shape,
  migrateRpgGraphToV2,
  getNodeRewardRows,
  getNodeRewardEntries,
} from '../src/lib/rpg-quest-nodes.js';

// --- Hilfsfunktionen fuer kompakte Test-Daten ---

/** Baut einen minimalen Quest-Root-Node mit Children. */
function quest(id, children = [], extras = {}) {
  return { id, parentId: null, title: id, children, ...extras };
}

/** Baut einen Blatt-Node. */
function leaf(id, extras = {}) {
  return { id, parentId: null, title: id, children: [], ...extras };
}

/** Baut einen Gruppen-Node mit Kindern. */
function group(id, children, extras = {}) {
  return { id, parentId: null, title: id, children, ...extras };
}

// =============================================================================
// normalizeQuestNodesTree
// =============================================================================

test('normalizeQuestNodesTree gibt leeres Array fuer leeren Input', () => {
  assert.deepStrictEqual(normalizeQuestNodesTree([]), []);
  assert.deepStrictEqual(normalizeQuestNodesTree(null), []);
  assert.deepStrictEqual(normalizeQuestNodesTree(undefined), []);
});

test('normalizeQuestNodesTree setzt parentId korrekt', () => {
  const nodes = normalizeQuestNodesTree([
    { id: 'a', title: 'A', children: [{ id: 'b', title: 'B', children: [] }] },
  ], 'root');
  assert.equal(nodes[0].parentId, 'root');
  assert.equal(nodes[0].children[0].parentId, 'a');
});

test('normalizeQuestNodesTree generiert Auto-IDs wenn keine vorhanden', () => {
  const nodes = normalizeQuestNodesTree([
    { title: 'Ohne ID', children: [] },
    { title: 'Auch ohne', children: [] },
  ]);
  // Auto-IDs beginnen mit 's-'
  assert.ok(nodes[0].id.startsWith('s-'), `Erwarte s-Prefix, bekam: ${nodes[0].id}`);
  assert.ok(nodes[1].id.startsWith('s-'), `Erwarte s-Prefix, bekam: ${nodes[1].id}`);
  assert.notEqual(nodes[0].id, nodes[1].id, 'Auto-IDs muessen eindeutig sein');
});

test('normalizeQuestNodesTree akzeptiert Legacy label statt title', () => {
  const nodes = normalizeQuestNodesTree([
    { id: 'x', label: 'Legacy Label', children: [] },
  ]);
  assert.equal(nodes[0].title, 'Legacy Label');
});

test('normalizeQuestNodesTree normalisiert rewards aus verschiedenen Quellen', () => {
  // Neues Format: rewards[]
  const withRewards = normalizeQuestNodesTree([
    { id: 'a', title: 'A', children: [], rewards: [{ type: 'text', text: 'Belohnung' }] },
  ]);
  assert.equal(withRewards[0].rewards.length, 1);
  assert.equal(withRewards[0].rewards[0].text, 'Belohnung');

  // Legacy: einzelnes reward-Objekt
  const withLegacyReward = normalizeQuestNodesTree([
    { id: 'b', title: 'B', children: [], reward: { type: 'text', text: 'Alt' } },
  ]);
  assert.equal(withLegacyReward[0].rewards.length, 1);
  assert.equal(withLegacyReward[0].rewards[0].text, 'Alt');

  // Legacy: questRewards[]
  const withQuestRewards = normalizeQuestNodesTree([
    { id: 'c', title: 'C', children: [], questRewards: [{ type: 'text', text: 'QR' }] },
  ]);
  assert.equal(withQuestRewards[0].rewards.length, 1);
});

test('normalizeQuestNodesTree normalisiert dependsOn', () => {
  const nodes = normalizeQuestNodesTree([
    { id: 'a', title: 'A', children: [], dependsOn: ['x', 'y'] },
  ]);
  assert.deepStrictEqual(nodes[0].dependsOn, ['x', 'y']);
});

test('normalizeQuestNodesTree setzt optional korrekt', () => {
  const nodes = normalizeQuestNodesTree([
    { id: 'a', title: 'A', children: [], optional: true },
    { id: 'b', title: 'B', children: [], optional: false },
    { id: 'c', title: 'C', children: [] },
  ]);
  assert.equal(nodes[0].optional, true);
  assert.equal(nodes[1].optional, false);
  assert.equal(nodes[2].optional, false);
});

test('normalizeQuestNodesTree verarbeitet timeDueAt korrekt', () => {
  // Standard YYYY-MM-DD
  const nodes = normalizeQuestNodesTree([
    { id: 'a', title: 'A', children: [], timeDueAt: '2026-05-01' },
  ]);
  assert.equal(nodes[0].timeDueAt, '2026-05-01');

  // Leere oder fehlende Felder -> kein timeDueAt
  const noDate = normalizeQuestNodesTree([
    { id: 'b', title: 'B', children: [], timeDueAt: '' },
  ]);
  assert.equal(noDate[0].timeDueAt, undefined);
});

test('normalizeQuestNodesTree normalisiert rekursive Children', () => {
  const nodes = normalizeQuestNodesTree([
    {
      id: 'root',
      title: 'Root',
      children: [
        {
          id: 'g1',
          title: 'Gruppe',
          children: [
            { id: 'leaf', title: 'Blatt', children: [] },
          ],
        },
      ],
    },
  ]);
  assert.equal(nodes[0].children[0].parentId, 'root');
  assert.equal(nodes[0].children[0].children[0].parentId, 'g1');
  assert.equal(nodes[0].children[0].children[0].title, 'Blatt');
});

test('normalizeQuestNodesTree akzeptiert subnodes als Alternative zu children', () => {
  const nodes = normalizeQuestNodesTree([
    { id: 'a', title: 'A', subnodes: [{ id: 'b', title: 'B' }] },
  ]);
  assert.equal(nodes[0].children.length, 1);
  assert.equal(nodes[0].children[0].id, 'b');
});

// =============================================================================
// flatLegacyNodesToNormalized
// =============================================================================

test('flatLegacyNodesToNormalized konvertiert flache Legacy-Zeilen', () => {
  const nodes = flatLegacyNodesToNormalized([
    { id: 'a', label: 'Schritt A' },
    { id: 'b', title: 'Schritt B' },
  ]);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].title, 'Schritt A');
  assert.equal(nodes[1].title, 'Schritt B');
  // parentId null weil kein parentId uebergeben
  assert.equal(nodes[0].parentId, null);
});

// =============================================================================
// Hilfsfunktionen: findNodeById, nodeIsLeaf, isLockNode, walkNodesPreOrder
// =============================================================================

test('findNodeById findet Nodes in verschachteltem Baum', () => {
  const tree = [
    group('g1', [leaf('a'), group('g2', [leaf('b'), leaf('c')])]),
    leaf('d'),
  ];
  assert.equal(findNodeById(tree, 'a').id, 'a');
  assert.equal(findNodeById(tree, 'c').id, 'c');
  assert.equal(findNodeById(tree, 'g2').id, 'g2');
  assert.equal(findNodeById(tree, 'missing'), null);
});

test('nodeIsLeaf erkennt Blaetter korrekt', () => {
  assert.equal(nodeIsLeaf(leaf('a')), true);
  assert.equal(nodeIsLeaf(group('g', [leaf('a')])), false);
  assert.equal(nodeIsLeaf({ id: 'x', children: [] }), true);
});

test('isLockNode erkennt Lock-Nodes', () => {
  assert.equal(isLockNode(leaf('a')), false);
  assert.equal(isLockNode({ ...leaf('a'), isLock: true }), true);
  assert.equal(isLockNode(null), false);
  assert.equal(isLockNode(undefined), false);
});

test('walkNodesPreOrder besucht alle Nodes in Pre-Order', () => {
  const tree = [group('a', [leaf('b'), group('c', [leaf('d')])])];
  const visited = [];
  walkNodesPreOrder(tree, (n) => visited.push(n.id));
  assert.deepStrictEqual(visited, ['a', 'b', 'c', 'd']);
});

test('buildNodeIdMap baut korrekte Map', () => {
  const tree = [group('a', [leaf('b'), leaf('c')])];
  const map = buildNodeIdMap(tree);
  assert.equal(map.size, 3);
  assert.equal(map.get('a').id, 'a');
  assert.equal(map.get('c').id, 'c');
});

// =============================================================================
// isNodeCompleteInQuest
// =============================================================================

test('isNodeCompleteInQuest: Blatt ist done wenn in nodeDone markiert', () => {
  const q = quest('q1', [leaf('a'), leaf('b')]);
  const done = { q1: { a: true } };
  assert.equal(isNodeCompleteInQuest(q, 'a', done), true);
  assert.equal(isNodeCompleteInQuest(q, 'b', done), false);
});

test('isNodeCompleteInQuest: Gruppe ist done wenn alle nicht-optionalen Kinder done', () => {
  const q = quest('q1', [
    group('g', [leaf('a'), leaf('b'), leaf('c', { optional: true })]),
  ]);
  // a und b done, c ist optional -> Gruppe g ist done
  assert.equal(isNodeCompleteInQuest(q, 'g', { q1: { a: true, b: true } }), true);
  // Nur a done -> nicht komplett
  assert.equal(isNodeCompleteInQuest(q, 'g', { q1: { a: true } }), false);
});

test('isNodeCompleteInQuest: Lock-Kinder werden ignoriert', () => {
  const q = quest('q1', [
    group('g', [leaf('a'), leaf('lock', { isLock: true })]),
  ]);
  // Lock-Node wird uebersprungen -> nur 'a' zaehlt
  assert.equal(isNodeCompleteInQuest(q, 'g', { q1: { a: true } }), true);
});

test('isNodeCompleteInQuest: dependsOn muss erfuellt sein', () => {
  const q = quest('q1', [
    leaf('a'),
    leaf('b', { dependsOn: ['a'] }),
  ]);
  // b ist markiert, aber Dependency a ist nicht done
  assert.equal(isNodeCompleteInQuest(q, 'b', { q1: { b: true } }), false);
  // Beide done
  assert.equal(isNodeCompleteInQuest(q, 'b', { q1: { a: true, b: true } }), true);
});

test('isNodeCompleteInQuest: Zyklen werden erkannt und nicht-done', () => {
  // Kuenstlicher Zyklus: a dependsOn b, b dependsOn a
  const q = quest('q1', [
    leaf('a', { dependsOn: ['b'] }),
    leaf('b', { dependsOn: ['a'] }),
  ]);
  assert.equal(isNodeCompleteInQuest(q, 'a', { q1: { a: true, b: true } }), false);
});

test('isNodeCompleteInQuest: fehlender Node gibt false', () => {
  const q = quest('q1', [leaf('a')]);
  assert.equal(isNodeCompleteInQuest(q, 'missing', { q1: {} }), false);
});

test('isNodeCompleteInQuest: ungueltige Quest gibt false', () => {
  assert.equal(isNodeCompleteInQuest(null, 'a', {}), false);
  assert.equal(isNodeCompleteInQuest(undefined, 'a', {}), false);
});

// =============================================================================
// canSetNodeDone
// =============================================================================

test('canSetNodeDone: Blatt kann auf done gesetzt werden', () => {
  const q = quest('q1', [leaf('a')]);
  assert.equal(canSetNodeDone(q, 'a', { q1: {} }, true), true);
});

test('canSetNodeDone: Gruppe kann nicht auf done gesetzt werden', () => {
  const q = quest('q1', [group('g', [leaf('a')])]);
  assert.equal(canSetNodeDone(q, 'g', { q1: {} }, true), false);
});

test('canSetNodeDone: undone ist immer erlaubt', () => {
  const q = quest('q1', [leaf('a')]);
  assert.equal(canSetNodeDone(q, 'a', { q1: { a: true } }, false), true);
});

test('canSetNodeDone: Lock muss vorher erledigt sein', () => {
  const q = quest('q1', [
    group('g', [
      leaf('lock', { isLock: true }),
      leaf('a'),
    ]),
  ]);
  // Lock nicht erledigt -> a kann nicht auf done
  assert.equal(canSetNodeDone(q, 'a', { q1: {} }, true), false);
  // Lock erledigt -> a kann auf done
  assert.equal(canSetNodeDone(q, 'a', { q1: { lock: true } }, true), true);
});

test('canSetNodeDone: dependsOn blockiert wenn Dependency nicht done', () => {
  const q = quest('q1', [leaf('a'), leaf('b', { dependsOn: ['a'] })]);
  assert.equal(canSetNodeDone(q, 'b', { q1: {} }, true), false);
  assert.equal(canSetNodeDone(q, 'b', { q1: { a: true } }, true), true);
});

// =============================================================================
// questLeafProgressRatio / questProgressFromNodes / isQuestCompletedFromNodes
// =============================================================================

test('questLeafProgressRatio berechnet Fortschritt korrekt', () => {
  const q = quest('q1', [leaf('a'), leaf('b'), leaf('c')]);
  const r = questLeafProgressRatio(q, { q1: { a: true } });
  assert.equal(r.total, 3);
  assert.equal(r.done, 1);
  assert.equal(r.percent, 33);
});

test('questLeafProgressRatio ignoriert optionale Blaetter', () => {
  const q = quest('q1', [leaf('a'), leaf('b', { optional: true })]);
  const r = questLeafProgressRatio(q, { q1: { a: true } });
  assert.equal(r.total, 1);
  assert.equal(r.done, 1);
  assert.equal(r.percent, 100);
});

test('questLeafProgressRatio ignoriert Lock-Nodes', () => {
  const q = quest('q1', [leaf('a'), leaf('lock', { isLock: true })]);
  const r = questLeafProgressRatio(q, { q1: { a: true } });
  assert.equal(r.total, 1);
  assert.equal(r.done, 1);
  assert.equal(r.percent, 100);
});

test('questLeafProgressRatio gibt 100% bei leerem Quest', () => {
  const q = quest('q1', []);
  const r = questLeafProgressRatio(q, {});
  assert.equal(r.percent, 100);
});

test('questProgressFromNodes gibt Prozentzahl', () => {
  const q = quest('q1', [leaf('a'), leaf('b')]);
  assert.equal(questProgressFromNodes(q, { q1: { a: true } }), 50);
});

test('isQuestCompletedFromNodes erkennt Completion', () => {
  const q = quest('q1', [leaf('a'), leaf('b')]);
  assert.equal(isQuestCompletedFromNodes(q, { q1: { a: true, b: true } }), true);
  assert.equal(isQuestCompletedFromNodes(q, { q1: { a: true } }), false);
});

test('questLeafProgressRatio zaehlt verschachtelte Blaetter korrekt', () => {
  const q = quest('q1', [
    group('g', [leaf('a'), leaf('b')]),
    leaf('c'),
  ]);
  // 3 Pflichtblaetter, 1 done
  const r = questLeafProgressRatio(q, { q1: { a: true } });
  assert.equal(r.total, 3);
  assert.equal(r.done, 1);
  assert.equal(r.percent, 33);
});

// =============================================================================
// questHasUrgentTimeBoundLeaves
// =============================================================================

test('questHasUrgentTimeBoundLeaves erkennt faellige Schritte', () => {
  const now = new Date('2026-04-27T12:00:00').getTime();
  const q = quest('q1', [
    leaf('a', { timeDueAt: '2026-04-28' }), // morgen -> urgent (< 1 Woche)
    leaf('b'),
  ]);
  assert.equal(questHasUrgentTimeBoundLeaves(q, { q1: {} }, now), true);
});

test('questHasUrgentTimeBoundLeaves ignoriert erledigte Schritte', () => {
  const now = new Date('2026-04-27T12:00:00').getTime();
  const q = quest('q1', [
    leaf('a', { timeDueAt: '2026-04-28' }),
  ]);
  // a ist done -> nicht mehr urgent
  assert.equal(questHasUrgentTimeBoundLeaves(q, { q1: { a: true } }, now), false);
});

test('questHasUrgentTimeBoundLeaves gibt false bei weit entfernter Frist', () => {
  const now = new Date('2026-04-27T12:00:00').getTime();
  const q = quest('q1', [
    leaf('a', { timeDueAt: '2026-12-31' }), // Monate entfernt
  ]);
  assert.equal(questHasUrgentTimeBoundLeaves(q, { q1: {} }, now), false);
});

// =============================================================================
// migrateNodeToV2Shape / migrateRpgGraphToV2
// =============================================================================

test('migrateNodeToV2Shape konvertiert label zu title', () => {
  const node = migrateNodeToV2Shape({ id: 'q1', label: 'Alter Titel', children: [] });
  assert.equal(node.title, 'Alter Titel');
  assert.equal(node.parentId, null);
});

test('migrateNodeToV2Shape behalt title wenn vorhanden', () => {
  const node = migrateNodeToV2Shape({ id: 'q1', title: 'Neuer Titel', label: 'Alt', children: [] });
  assert.equal(node.title, 'Neuer Titel');
});

test('migrateNodeToV2Shape konvertiert String-Rewards zu Text-Rewards', () => {
  const node = migrateNodeToV2Shape({
    id: 'q1',
    title: 'Quest',
    children: [],
    rewards: ['Belohnung A', 'Belohnung B'],
  });
  assert.equal(node.rewards.length, 2);
  assert.equal(node.rewards[0].type, 'text');
  assert.equal(node.rewards[0].text, 'Belohnung A');
});

test('migrateRpgGraphToV2 migriert ganzen Graph', () => {
  const graph = {
    nodes: [
      { id: 'q1', label: 'Quest 1', children: [{ id: 'a', label: 'A' }] },
    ],
    edges: [{ from: 'q1', to: 'q1', relation: 'structure' }],
  };
  const migrated = migrateRpgGraphToV2(graph);
  assert.equal(migrated.nodes[0].title, 'Quest 1');
  assert.equal(migrated.nodes[0].children[0].title, 'A');
  assert.equal(migrated.edges.length, 1);
});

// =============================================================================
// getNodeRewardRows / getNodeRewardEntries
// =============================================================================

test('getNodeRewardRows liest neues rewards-Format', () => {
  const node = { id: 'a', rewards: [{ type: 'text', text: 'Belohnung' }] };
  const rows = getNodeRewardRows(node);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.type, 'text');
});

test('getNodeRewardRows liest Legacy questRewards', () => {
  const node = { id: 'a', questRewards: [{ type: 'text', text: 'Legacy' }] };
  const rows = getNodeRewardRows(node);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entry.text, 'Legacy');
});

test('getNodeRewardRows gibt leeres Array bei fehlenden Rewards', () => {
  assert.deepStrictEqual(getNodeRewardRows({ id: 'a' }), []);
});

test('getNodeRewardEntries extrahiert nur Entries ohne Unlock-Info', () => {
  const node = { id: 'a', rewards: [{ type: 'text', text: 'R', unlockAtPercent: 50 }] };
  const entries = getNodeRewardEntries(node);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, 'text');
  // Kein unlockAtPercent auf der Entry-Ebene
  assert.equal(entries[0].unlockAtPercent, undefined);
});

// =============================================================================
// buildRewardDisplayList
// =============================================================================

test('buildRewardDisplayList aggregiert Self- und Sub-Node-Rewards', () => {
  const q = quest('q1', [
    leaf('a', { rewards: [{ type: 'text', text: 'Child-Reward' }] }),
  ], {
    rewards: [{ type: 'text', text: 'Quest-Reward' }],
  });
  const rows = buildRewardDisplayList(q, { q1: {} });
  // Beide Rewards sind enthalten — getrennt erkennbar via nodeId
  const selfRows = rows.filter((r) => r.nodeId === 'q1');
  const subRows = rows.filter((r) => r.nodeId === 'a');
  assert.ok(selfRows.length >= 1, 'Self-Reward (Root) muss enthalten sein');
  assert.ok(subRows.length >= 1, 'Sub-Node-Reward muss enthalten sein');
});

test('buildRewardDisplayList setzt unlocked korrekt fuer Sub-Node-Rewards', () => {
  const q = quest('q1', [
    leaf('a', { rewards: [{ type: 'text', text: 'R' }] }),
  ]);
  const unlocked = buildRewardDisplayList(q, { q1: { a: true } });
  assert.equal(unlocked[0].unlocked, true);
  assert.equal(unlocked[0].nodeId, 'a');

  const locked = buildRewardDisplayList(q, { q1: {} });
  assert.equal(locked[0].unlocked, false);
});

test('buildRewardDisplayList ist tiefenagnostisch: Root und Sub-Node liefern strukturell konsistente Outputs', () => {
  // Root mit zwei Sub-Nodes, jeder mit eigenen Rewards
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [
      { id: 'sub-leaf', parentId: 'sub', title: 'Sub-Leaf', children: [], rewards: [{ type: 'text', text: 'Deep' }] },
    ],
    rewards: [{ type: 'text', text: 'Sub-Self' }],
  };
  const q = quest('q1', [sub], { rewards: [{ type: 'text', text: 'Root-Self' }] });

  // Root-View: Root-Self + Sub-Self + Deep
  const rootRows = buildRewardDisplayList(q, { q1: {} });
  assert.equal(rootRows.length, 3, 'Root-View liefert alle drei Rewards');
  // Reihenfolge: erst self (Root), dann via walkNodesPreOrder die Descendants (sub, sub-leaf)
  assert.equal(rootRows[0].nodeId, 'q1');
  assert.equal(rootRows[0].unlocked, false); // Root nicht komplett

  // Sub-View: Sub-Self + Deep, KEIN Root-Self
  const subRows = buildRewardDisplayList(sub, { q1: {} }, {
    scopeQuestId: 'q1',
  });
  assert.equal(subRows.length, 2, 'Sub-View liefert nur eigene + descendants');
  assert.equal(subRows[0].nodeId, 'sub');
  // Strukturelle Konsistenz: jeder Eintrag hat label, kind, unlocked, nodeId
  for (const row of [...rootRows, ...subRows]) {
    assert.equal(typeof row.label, 'string');
    assert.equal(typeof row.kind, 'string');
    assert.equal(typeof row.unlocked, 'boolean');
    assert.equal(typeof row.nodeId, 'string');
    // KEIN source-Feld mehr — das war die Halluzination
    assert.equal(row.source, undefined);
  }
});

test('buildRewardDisplayList: Self-Reward eines Sub-Nodes wird unlocked wenn der Sub-Node selbst komplett ist', () => {
  const sub = {
    id: 'sub',
    parentId: 'q1',
    title: 'Sub',
    children: [
      { id: 'l1', parentId: 'sub', title: 'L1', children: [] },
    ],
    rewards: [{ type: 'text', text: 'Sub-Self' }],
  };
  const q = quest('q1', [sub]);

  // Sub nicht komplett → Self-Reward locked
  const locked = buildRewardDisplayList(sub, { q1: {} }, { scopeQuestId: 'q1' });
  assert.equal(locked[0].unlocked, false);

  // Sub komplett (l1 done) → Self-Reward unlocked
  const unlocked = buildRewardDisplayList(sub, { q1: { l1: true } }, { scopeQuestId: 'q1' });
  assert.equal(unlocked[0].unlocked, true);
});
