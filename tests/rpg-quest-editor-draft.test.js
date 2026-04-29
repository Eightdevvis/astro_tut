/**
 * Tests fuer rpg-quest-editor-draft.js — Draft-Konvertierung, Roundtrips, Normalisierung.
 *
 * Deckt ab:
 * - createEmptyNodeDraft / createEmptyRewardRow (Default-Werte)
 * - questNodeToDraft / questNodesToDrafts (Node -> Draft)
 * - draftNodesToQuestNodes (Draft -> Node, Roundtrip)
 * - isDraftNodeMeaningful (Filterlogik)
 * - reorderDraftNodes (Array-Reorder)
 * - ensureRewardRowFields / ensureNodeDraftFields (Legacy-Normalisierung)
 * - draftRewardRowsToStoredRewards (Persistenz)
 * - draftRewardRowsToQuestRewards (Draft -> Entry)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyNodeDraft,
  createEmptyRewardRow,
  questNodeToDraft,
  questNodesToDrafts,
  draftNodesToQuestNodes,
  isDraftNodeMeaningful,
  reorderDraftNodes,
  ensureRewardRowFields,
  ensureNodeDraftFields,
  draftRewardRowsToStoredRewards,
  draftRewardRowsToQuestRewards,
  aiLabelsToDraftNodes,
} from '../src/lib/rpg-quest-editor-draft.js';

// =============================================================================
// createEmptyNodeDraft / createEmptyRewardRow
// =============================================================================

test('createEmptyNodeDraft erzeugt alle Felder mit Defaults', () => {
  const d = createEmptyNodeDraft();
  assert.equal(d.title, '');
  assert.equal(d.description, '');
  assert.equal(d.optional, false);
  assert.equal(d.rewardOn, false);
  assert.equal(d.rewardKind, 'text');
  assert.equal(d.subnodesOn, false);
  assert.equal(d.saved, false);
  assert.equal(d.orderLinked, false);
  assert.equal(d.isLock, false);
  assert.ok(d.key, 'Key muss vorhanden sein');
  assert.deepStrictEqual(d.children, []);
});

test('createEmptyNodeDraft: saved-Parameter wird durchgereicht', () => {
  assert.equal(createEmptyNodeDraft(true).saved, true);
  assert.equal(createEmptyNodeDraft(false).saved, false);
});

test('createEmptyRewardRow erzeugt leere Reward-Zeile', () => {
  const r = createEmptyRewardRow();
  assert.equal(r.kind, 'text');
  assert.equal(r.text, '');
  assert.equal(r.itemId, '');
  assert.equal(r.pointKind, 'heart');
  assert.equal(r.pointsAmount, '');
  // unlockAtPercent wurde aus dem System entfernt
  assert.equal(r.unlockAtPercent, undefined);
  assert.ok(r.key, 'Key muss vorhanden sein');
});

// =============================================================================
// questNodeToDraft
// =============================================================================

test('questNodeToDraft konvertiert einfachen Blatt-Node', () => {
  const node = { id: 'a', parentId: 'q1', title: 'Schritt A', children: [] };
  const d = questNodeToDraft(node);
  assert.equal(d.key, 'a');
  assert.equal(d.stableId, 'a');
  assert.equal(d.title, 'Schritt A');
  assert.equal(d.saved, true);
  assert.equal(d.subnodesOn, false);
  assert.deepStrictEqual(d.children, []);
});

test('questNodeToDraft konvertiert Node mit Text-Reward', () => {
  const node = {
    id: 'a',
    parentId: 'q1',
    title: 'A',
    children: [],
    rewards: [{ type: 'text', text: 'Belohnung' }],
  };
  const d = questNodeToDraft(node);
  assert.equal(d.rewardOn, true);
  assert.equal(d.rewardKind, 'text');
  assert.equal(d.rewardText, 'Belohnung');
});

test('questNodeToDraft konvertiert Node mit Item-Reward', () => {
  const node = {
    id: 'a',
    parentId: 'q1',
    title: 'A',
    children: [],
    rewards: [{ type: 'item', itemId: 'schwert', displayName: 'Schwert' }],
  };
  const d = questNodeToDraft(node);
  assert.equal(d.rewardOn, true);
  assert.equal(d.rewardKind, 'item');
  assert.equal(d.itemId, 'schwert');
  assert.equal(d.itemDisplayName, 'Schwert');
});

test('questNodeToDraft konvertiert Node mit Points-Reward', () => {
  const node = {
    id: 'a',
    parentId: 'q1',
    title: 'A',
    children: [],
    rewards: [{ type: 'points', pointKind: 'mana', amount: 5 }],
  };
  const d = questNodeToDraft(node);
  assert.equal(d.rewardOn, true);
  assert.equal(d.rewardKind, 'points');
  assert.equal(d.pointKind, 'mana');
  assert.equal(d.pointsAmount, '5');
});

test('questNodeToDraft konvertiert Node mit Children', () => {
  const node = {
    id: 'g',
    parentId: 'q1',
    title: 'Gruppe',
    children: [
      { id: 'a', parentId: 'g', title: 'A', children: [] },
      { id: 'b', parentId: 'g', title: 'B', children: [] },
    ],
  };
  const d = questNodeToDraft(node);
  assert.equal(d.subnodesOn, true);
  assert.equal(d.children.length, 2);
  assert.equal(d.children[0].title, 'A');
});

test('questNodeToDraft konvertiert dependsOn und timeDueAt', () => {
  const node = {
    id: 'a',
    parentId: 'q1',
    title: 'A',
    children: [],
    dependsOn: ['x', 'y'],
    timeDueAt: '2026-05-01',
  };
  const d = questNodeToDraft(node);
  assert.deepStrictEqual(d.legacyDependsOn, ['x', 'y']);
  assert.equal(d.timeLimitOn, true);
  assert.equal(d.timeDueAt, '2026-05-01');
});

// =============================================================================
// questNodesToDrafts
// =============================================================================

test('questNodesToDrafts konvertiert Array von Nodes', () => {
  const nodes = [
    { id: 'a', parentId: null, title: 'A', children: [] },
    { id: 'b', parentId: null, title: 'B', children: [] },
  ];
  const drafts = questNodesToDrafts(nodes);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].title, 'A');
});

test('questNodesToDrafts gibt leeres Array fuer leeren Input', () => {
  assert.deepStrictEqual(questNodesToDrafts([]), []);
  assert.deepStrictEqual(questNodesToDrafts(undefined), []);
});

// =============================================================================
// draftNodesToQuestNodes (Roundtrip)
// =============================================================================

test('draftNodesToQuestNodes konvertiert Drafts zurueck zu Nodes', () => {
  const drafts = [
    { ...createEmptyNodeDraft(true), title: 'Schritt A' },
    { ...createEmptyNodeDraft(true), title: 'Schritt B' },
  ];
  const nodes = draftNodesToQuestNodes(drafts);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].title, 'Schritt A');
  assert.equal(nodes[1].title, 'Schritt B');
  // Alle Nodes muessen kanonische Form haben
  for (const n of nodes) {
    assert.ok(typeof n.id === 'string' && n.id.trim(), 'ID muss nicht-leer sein');
    assert.ok(Array.isArray(n.children), 'Children muss Array sein');
  }
});

test('draftNodesToQuestNodes erzeugt unterschiedliche IDs bei gleichen Titeln', () => {
  const drafts = [
    { ...createEmptyNodeDraft(true), title: 'Zentrale' },
    { ...createEmptyNodeDraft(true), title: 'Zentrale' },
    { ...createEmptyNodeDraft(true), title: 'Zentrale' },
  ];
  const nodes = draftNodesToQuestNodes(drafts);
  const ids = nodes.map((n) => n.id).sort();
  assert.equal(nodes.length, 3);
  assert.deepStrictEqual(ids, ['zentrale', 'zentrale-2', 'zentrale-3']);
});

test('draftNodesToQuestNodes filtert leere Drafts', () => {
  const drafts = [
    { ...createEmptyNodeDraft(), title: '' }, // leer, wird gefiltert
    { ...createEmptyNodeDraft(true), title: 'Valide' },
  ];
  const nodes = draftNodesToQuestNodes(drafts);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].title, 'Valide');
});

test('Node -> Draft -> Node Roundtrip behaelt Titel', () => {
  const original = { id: 'test-node', parentId: null, title: 'Mein Schritt', children: [] };
  const draft = questNodeToDraft(original);
  const restored = draftNodesToQuestNodes([draft]);
  assert.equal(restored[0].title, 'Mein Schritt');
});

// =============================================================================
// isDraftNodeMeaningful
// =============================================================================

test('isDraftNodeMeaningful: leerer Draft ist nicht meaningful', () => {
  assert.equal(isDraftNodeMeaningful(createEmptyNodeDraft()), false);
});

test('isDraftNodeMeaningful: Draft mit Titel ist meaningful', () => {
  assert.equal(isDraftNodeMeaningful({ ...createEmptyNodeDraft(), title: 'Test' }), true);
});

test('isDraftNodeMeaningful: Draft mit meaningful Children ist meaningful', () => {
  const parent = {
    ...createEmptyNodeDraft(),
    children: [{ ...createEmptyNodeDraft(), title: 'Kind' }],
  };
  assert.equal(isDraftNodeMeaningful(parent), true);
});

test('isDraftNodeMeaningful: Draft mit leeren Children ist nicht meaningful', () => {
  const parent = {
    ...createEmptyNodeDraft(),
    children: [createEmptyNodeDraft()],
  };
  assert.equal(isDraftNodeMeaningful(parent), false);
});

// =============================================================================
// reorderDraftNodes
// =============================================================================

test('reorderDraftNodes verschiebt Eintraege korrekt', () => {
  const arr = [
    { ...createEmptyNodeDraft(), title: 'A' },
    { ...createEmptyNodeDraft(), title: 'B' },
    { ...createEmptyNodeDraft(), title: 'C' },
  ];
  const result = reorderDraftNodes(arr, 0, 2);
  assert.equal(result[0].title, 'B');
  assert.equal(result[1].title, 'C');
  assert.equal(result[2].title, 'A');
});

test('reorderDraftNodes gibt Original bei gleichen Indices', () => {
  const arr = [createEmptyNodeDraft()];
  assert.equal(reorderDraftNodes(arr, 0, 0), arr);
});

test('reorderDraftNodes gibt Original bei ungueltigen Indices', () => {
  const arr = [createEmptyNodeDraft()];
  assert.equal(reorderDraftNodes(arr, -1, 0), arr);
  assert.equal(reorderDraftNodes(arr, 0, 5), arr);
});

// =============================================================================
// ensureRewardRowFields
// =============================================================================

test('ensureRewardRowFields: null gibt leere Row', () => {
  const r = ensureRewardRowFields(null);
  assert.equal(r.kind, 'text');
  assert.ok(r.key);
});

test('ensureRewardRowFields: behaelt Item-Felder', () => {
  const r = ensureRewardRowFields({
    key: 'k1',
    kind: 'item',
    itemId: 'schwert',
    displayName: 'Schwert',
    itemCategory: 'alltag',
    itemDescription: 'Ein Schwert',
  });
  assert.equal(r.kind, 'item');
  assert.equal(r.itemId, 'schwert');
  assert.equal(r.displayName, 'Schwert');
});

test('ensureRewardRowFields: behaelt Points-Felder', () => {
  const r = ensureRewardRowFields({
    key: 'k2',
    kind: 'points',
    pointKind: 'mana',
    pointsAmount: '3',
  });
  assert.equal(r.kind, 'points');
  assert.equal(r.pointKind, 'mana');
  assert.equal(r.pointsAmount, '3');
});

// =============================================================================
// ensureNodeDraftFields
// =============================================================================

test('ensureNodeDraftFields: null gibt leeren Draft', () => {
  const d = ensureNodeDraftFields(null);
  assert.equal(d.title, '');
  assert.equal(d.rewardKind, 'text');
  assert.equal(d.saved, false);
});

test('ensureNodeDraftFields: fixiert ungueltigen rewardKind', () => {
  const d = ensureNodeDraftFields({ rewardKind: 'invalid', itemId: 'x' });
  assert.equal(d.rewardKind, 'item'); // weil itemId vorhanden
});

test('ensureNodeDraftFields: normalisiert Children rekursiv', () => {
  const d = ensureNodeDraftFields({
    title: 'Parent',
    children: [{ title: 'Child' }],
  });
  assert.equal(d.subnodesOn, true);
  assert.equal(d.children.length, 1);
  assert.equal(d.children[0].title, 'Child');
  assert.ok(d.children[0].key, 'Child muss Key haben');
});

// =============================================================================
// draftRewardRowsToStoredRewards
// =============================================================================

test('draftRewardRowsToStoredRewards serialisiert Text-Row', () => {
  const rows = [{ ...createEmptyRewardRow(), kind: 'text', text: 'Hut' }];
  const stored = draftRewardRowsToStoredRewards(rows);
  assert.equal(stored.length, 1);
  assert.deepStrictEqual(stored[0], { type: 'text', text: 'Hut' });
});

test('draftRewardRowsToStoredRewards serialisiert Item-Row', () => {
  const rows = [{
    ...createEmptyRewardRow(),
    kind: 'item',
    itemId: 'schwert',
    displayName: 'Schwert',
  }];
  const stored = draftRewardRowsToStoredRewards(rows);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, 'item');
  assert.equal(stored[0].itemId, 'schwert');
  assert.equal(stored[0].displayName, 'Schwert');
});

test('draftRewardRowsToStoredRewards serialisiert Points-Row', () => {
  const rows = [{
    ...createEmptyRewardRow(),
    kind: 'points',
    pointKind: 'mana',
    pointsAmount: '7',
  }];
  const stored = draftRewardRowsToStoredRewards(rows);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, 'points');
  assert.equal(stored[0].pointKind, 'mana');
  assert.equal(stored[0].amount, 7);
});

test('draftRewardRowsToStoredRewards filtert leere Rows', () => {
  const rows = [
    { ...createEmptyRewardRow(), kind: 'text', text: '' },
    { ...createEmptyRewardRow(), kind: 'item', itemId: '' },
    { ...createEmptyRewardRow(), kind: 'points', pointsAmount: '' },
  ];
  const stored = draftRewardRowsToStoredRewards(rows);
  assert.equal(stored.length, 0);
});

test('draftRewardRowsToStoredRewards ohne unlockAtPercent (Feature entfernt)', () => {
  // unlockAtPercent wurde aus dem System entfernt — wird nicht mehr gespeichert
  const rows = [{
    ...createEmptyRewardRow(),
    kind: 'text',
    text: 'R',
  }];
  const stored = draftRewardRowsToStoredRewards(rows);
  assert.equal(stored[0].unlockAtPercent, undefined);
  assert.equal(stored[0].type, 'text');
  assert.equal(stored[0].text, 'R');
});

// =============================================================================
// draftRewardRowsToQuestRewards
// =============================================================================

test('draftRewardRowsToQuestRewards konvertiert zu Reward-Entries', () => {
  const rows = [
    { ...createEmptyRewardRow(), kind: 'text', text: 'Hut' },
    { ...createEmptyRewardRow(), kind: 'points', pointKind: 'heart', pointsAmount: '3' },
  ];
  const entries = draftRewardRowsToQuestRewards(rows);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'text');
  assert.equal(entries[0].text, 'Hut');
  assert.equal(entries[1].type, 'points');
  assert.equal(entries[1].pointKind, 'heart');
  assert.equal(entries[1].amount, 3);
});

// =============================================================================
// aiLabelsToDraftNodes
// =============================================================================

test('aiLabelsToDraftNodes erstellt Drafts aus Labels', () => {
  const drafts = aiLabelsToDraftNodes(['Aufgabe 1', 'Aufgabe 2']);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].title, 'Aufgabe 1');
  assert.equal(drafts[0].saved, true);
  assert.ok(drafts[0].key, 'Key muss vorhanden sein');
});

test('aiLabelsToDraftNodes filtert leere Labels', () => {
  const drafts = aiLabelsToDraftNodes(['OK', '', '  ', 'Auch OK']);
  assert.equal(drafts.length, 2);
});
