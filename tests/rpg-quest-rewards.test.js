/**
 * Tests fuer rpg-quest-rewards.js — Reward-Normalisierung, Display, Unlock-Schedule.
 *
 * Deckt ab:
 * - normalizeRewardEntry (alle Typen: text, item, points, Legacy-Strings, null)
 * - normalizeRewardEntries (Arrays)
 * - normalizeRewardRow / normalizeRewardRows (mit unlockAtPercent)
 * - rewardRowToStored (Persistenz-Serialisierung)
 * - resolveRewardUnlockSchedule (deterministischer Freischaltplan)
 * - resolveRewardRowsWithUnlocks (explizite vs. Auto-Schwellen)
 * - formatRewardPointsAmount (Display)
 * - rewardEntryDisplayLabel (Labels, deckt interne displayLabelForRewardEntry ab)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRewardPointKind,
  normalizeRewardEntry,
  normalizeRewardEntries,
  formatRewardPointsAmount,
  rewardEntryDisplayLabel,
  resolveRewardUnlockSchedule,
  normalizeRewardRow,
  normalizeRewardRows,
  rewardRowToStored,
  resolveRewardRowsWithUnlocks,
  stringsToTextRewards,
} from '../src/lib/rpg-quest-rewards.js';

// =============================================================================
// normalizeRewardPointKind
// =============================================================================

test('normalizeRewardPointKind akzeptiert heart und mana', () => {
  assert.equal(normalizeRewardPointKind('heart'), 'heart');
  assert.equal(normalizeRewardPointKind('mana'), 'mana');
  assert.equal(normalizeRewardPointKind('HEART'), 'heart');
  assert.equal(normalizeRewardPointKind('  Mana  '), 'mana');
});

test('normalizeRewardPointKind gibt null fuer unbekannte Werte', () => {
  assert.equal(normalizeRewardPointKind('gold'), null);
  assert.equal(normalizeRewardPointKind(''), null);
  assert.equal(normalizeRewardPointKind(null), null);
  assert.equal(normalizeRewardPointKind(42), null);
});

// =============================================================================
// normalizeRewardEntry
// =============================================================================

test('normalizeRewardEntry: null/undefined gibt null', () => {
  assert.equal(normalizeRewardEntry(null), null);
  assert.equal(normalizeRewardEntry(undefined), null);
});

test('normalizeRewardEntry: String wird zu Text-Reward', () => {
  const e = normalizeRewardEntry('Goldener Hut');
  assert.deepStrictEqual(e, { type: 'text', text: 'Goldener Hut' });
});

test('normalizeRewardEntry: leerer String gibt null', () => {
  assert.equal(normalizeRewardEntry(''), null);
  assert.equal(normalizeRewardEntry('   '), null);
});

test('normalizeRewardEntry: Text-Objekt', () => {
  const e = normalizeRewardEntry({ type: 'text', text: 'Belohnung' });
  assert.deepStrictEqual(e, { type: 'text', text: 'Belohnung' });
});

test('normalizeRewardEntry: Text-Objekt ohne type aber mit text', () => {
  const e = normalizeRewardEntry({ text: 'Implizit Text' });
  assert.deepStrictEqual(e, { type: 'text', text: 'Implizit Text' });
});

test('normalizeRewardEntry: Text-Objekt mit leerem text gibt null', () => {
  assert.equal(normalizeRewardEntry({ type: 'text', text: '' }), null);
});

test('normalizeRewardEntry: Points-Reward', () => {
  const e = normalizeRewardEntry({ type: 'points', pointKind: 'heart', amount: 5 });
  assert.deepStrictEqual(e, { type: 'points', pointKind: 'heart', amount: 5 });
});

test('normalizeRewardEntry: Points-Reward mit String-Amount', () => {
  const e = normalizeRewardEntry({ type: 'points', pointKind: 'mana', amount: '3' });
  assert.deepStrictEqual(e, { type: 'points', pointKind: 'mana', amount: 3 });
});

test('normalizeRewardEntry: Points-Reward ohne pointKind gibt null', () => {
  assert.equal(normalizeRewardEntry({ type: 'points', amount: 5 }), null);
});

test('normalizeRewardEntry: Points-Reward ohne amount gibt null', () => {
  assert.equal(normalizeRewardEntry({ type: 'points', pointKind: 'heart' }), null);
});

test('normalizeRewardEntry: Item-Reward mit explizitem type', () => {
  const e = normalizeRewardEntry({ type: 'item', itemId: 'schwert-01' });
  assert.deepStrictEqual(e, { type: 'item', itemId: 'schwert-01' });
});

test('normalizeRewardEntry: Item-Reward mit displayName', () => {
  const e = normalizeRewardEntry({ type: 'item', itemId: 'x', displayName: 'Magisches Schwert' });
  assert.equal(e.type, 'item');
  assert.equal(e.itemId, 'x');
  assert.equal(e.displayName, 'Magisches Schwert');
});

test('normalizeRewardEntry: Item-Reward ohne type aber mit itemId', () => {
  const e = normalizeRewardEntry({ itemId: 'hut-01' });
  assert.deepStrictEqual(e, { type: 'item', itemId: 'hut-01' });
});

test('normalizeRewardEntry: Item-Reward mit Legacy id statt itemId', () => {
  const e = normalizeRewardEntry({ id: 'alt-01' });
  assert.deepStrictEqual(e, { type: 'item', itemId: 'alt-01' });
});

test('normalizeRewardEntry: Item-Reward mit leerem itemId gibt null', () => {
  assert.equal(normalizeRewardEntry({ type: 'item', itemId: '' }), null);
});

test('normalizeRewardEntry: unbekanntes Objekt gibt null', () => {
  assert.equal(normalizeRewardEntry({ foo: 'bar' }), null);
  assert.equal(normalizeRewardEntry(42), null);
});

// =============================================================================
// normalizeRewardEntries
// =============================================================================

test('normalizeRewardEntries filtert ungueltige Eintraege', () => {
  const entries = normalizeRewardEntries([
    { type: 'text', text: 'OK' },
    null,
    '',
    { type: 'text', text: '' },
    'Auch OK',
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'OK');
  assert.equal(entries[1].text, 'Auch OK');
});

test('normalizeRewardEntries gibt leeres Array bei non-Array', () => {
  assert.deepStrictEqual(normalizeRewardEntries(null), []);
  assert.deepStrictEqual(normalizeRewardEntries('string'), []);
  assert.deepStrictEqual(normalizeRewardEntries(42), []);
});

// =============================================================================
// formatRewardPointsAmount
// =============================================================================

test('formatRewardPointsAmount formatiert positive Zahlen mit +', () => {
  assert.equal(formatRewardPointsAmount(5), '+5');
  assert.equal(formatRewardPointsAmount(1), '+1');
});

test('formatRewardPointsAmount formatiert 0 und negative Zahlen', () => {
  assert.equal(formatRewardPointsAmount(0), '0');
  assert.equal(formatRewardPointsAmount(-3), '-3');
});

// =============================================================================
// rewardEntryDisplayLabel (displayLabelForRewardEntry ist jetzt intern)
// =============================================================================

test('rewardEntryDisplayLabel: Text-Reward gibt text zurueck', () => {
  assert.equal(rewardEntryDisplayLabel({ type: 'text', text: 'Hut' }, undefined), 'Hut');
});

test('rewardEntryDisplayLabel: Points-Reward gibt formatierte Punkte', () => {
  assert.equal(rewardEntryDisplayLabel({ type: 'points', pointKind: 'heart', amount: 3 }, undefined), '+3');
});

test('rewardEntryDisplayLabel: Item mit displayName ohne Katalog', () => {
  assert.equal(
    rewardEntryDisplayLabel({ type: 'item', itemId: 'x', displayName: 'Schwert' }, undefined),
    'Schwert'
  );
});

test('rewardEntryDisplayLabel: Item ohne displayName gibt itemId', () => {
  assert.equal(rewardEntryDisplayLabel({ type: 'item', itemId: 'schwert-01' }, undefined), 'schwert-01');
});

test('rewardEntryDisplayLabel: nutzt Katalog-Titel wenn vorhanden', () => {
  const catalog = { 'x': { title: 'Katalog-Titel' } };
  const label = rewardEntryDisplayLabel({ type: 'item', itemId: 'x' }, catalog);
  assert.equal(label, 'Katalog-Titel');
});

test('rewardEntryDisplayLabel: Fallback auf displayLabelForRewardEntry ohne Katalog', () => {
  const label = rewardEntryDisplayLabel({ type: 'item', itemId: 'x', displayName: 'DN' }, undefined);
  assert.equal(label, 'DN');
});

// =============================================================================
// resolveRewardUnlockSchedule
// =============================================================================

test('resolveRewardUnlockSchedule verteilt Meilensteine gleichmaessig', () => {
  const entries = [
    { type: 'text', text: 'A' },
    { type: 'text', text: 'B' },
    { type: 'text', text: 'C' },
    { type: 'text', text: 'D' },
  ];
  const schedule = resolveRewardUnlockSchedule('q1', entries);
  assert.equal(schedule.length, 4);
  // Meilensteine: 25, 50, 75, 100 — shuffled, aber alle muessen vorhanden sein
  const percents = schedule.map((s) => s.unlockAtPercent).sort((a, b) => a - b);
  assert.deepStrictEqual(percents, [25, 50, 75, 100]);
});

test('resolveRewardUnlockSchedule ist deterministisch', () => {
  const entries = [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }];
  const a = resolveRewardUnlockSchedule('q1', entries);
  const b = resolveRewardUnlockSchedule('q1', entries);
  assert.deepStrictEqual(
    a.map((s) => s.unlockAtPercent),
    b.map((s) => s.unlockAtPercent)
  );
});

test('resolveRewardUnlockSchedule gibt leeres Array fuer leere Entries', () => {
  assert.deepStrictEqual(resolveRewardUnlockSchedule('q1', []), []);
});

test('resolveRewardUnlockSchedule: einzelner Entry bekommt 100%', () => {
  const schedule = resolveRewardUnlockSchedule('q1', [{ type: 'text', text: 'A' }]);
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].unlockAtPercent, 100);
});

// =============================================================================
// normalizeRewardRow / normalizeRewardRows (deckt parseRewardUnlockFromRaw + clampRewardUnlockPercent indirekt ab)
// =============================================================================

test('normalizeRewardRow parst unlockAtPercent aus verschiedenen Formaten', () => {
  // Numerisch
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: 50 }).unlockAtPercent, 50);
  // String
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: '75' }).unlockAtPercent, 75);
  // Snake_case Alias
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlock_at_percent: 30 }).unlockAtPercent, 30);
});

test('normalizeRewardRow ignoriert fehlendes/leeres unlockAtPercent', () => {
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R' }).unlockAtPercent, undefined);
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: '' }).unlockAtPercent, undefined);
});

test('normalizeRewardRow klemmt unlockAtPercent auf 0-100', () => {
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: -10 }).unlockAtPercent, 0);
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: 200 }).unlockAtPercent, 100);
  assert.equal(normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: 33.7 }).unlockAtPercent, 34);
});

// =============================================================================

test('normalizeRewardRow erzeugt Row mit Entry', () => {
  const row = normalizeRewardRow({ type: 'text', text: 'Belohnung' });
  assert.equal(row.entry.type, 'text');
  assert.equal(row.entry.text, 'Belohnung');
  assert.equal(row.unlockAtPercent, undefined);
});

test('normalizeRewardRow uebertraegt unlockAtPercent', () => {
  const row = normalizeRewardRow({ type: 'text', text: 'R', unlockAtPercent: 50 });
  assert.equal(row.unlockAtPercent, 50);
});

test('normalizeRewardRow gibt null fuer ungueltigen Input', () => {
  assert.equal(normalizeRewardRow(null), null);
  assert.equal(normalizeRewardRow({ type: 'text', text: '' }), null);
});

test('normalizeRewardRows filtert ungueltige Eintraege', () => {
  const rows = normalizeRewardRows([
    { type: 'text', text: 'OK' },
    null,
    { type: 'text', text: '' },
  ]);
  assert.equal(rows.length, 1);
});

// =============================================================================
// rewardRowToStored
// =============================================================================

test('rewardRowToStored serialisiert Text-Reward', () => {
  const stored = rewardRowToStored({ entry: { type: 'text', text: 'Hut' } });
  assert.deepStrictEqual(stored, { type: 'text', text: 'Hut' });
});

test('rewardRowToStored serialisiert Points-Reward', () => {
  const stored = rewardRowToStored({ entry: { type: 'points', pointKind: 'mana', amount: 7 } });
  assert.deepStrictEqual(stored, { type: 'points', pointKind: 'mana', amount: 7 });
});

test('rewardRowToStored serialisiert Item-Reward mit displayName', () => {
  const stored = rewardRowToStored({
    entry: { type: 'item', itemId: 'x', displayName: 'Schwert' },
  });
  assert.deepStrictEqual(stored, { type: 'item', itemId: 'x', displayName: 'Schwert' });
});

test('rewardRowToStored inkludiert unlockAtPercent wenn vorhanden', () => {
  const stored = rewardRowToStored({
    entry: { type: 'text', text: 'R' },
    unlockAtPercent: 50,
  });
  assert.equal(stored.unlockAtPercent, 50);
});

test('rewardRowToStored klemmt unlockAtPercent', () => {
  const stored = rewardRowToStored({
    entry: { type: 'text', text: 'R' },
    unlockAtPercent: 150,
  });
  assert.equal(stored.unlockAtPercent, 100);
});

// =============================================================================
// resolveRewardRowsWithUnlocks
// =============================================================================

test('resolveRewardRowsWithUnlocks nutzt explizite Schwellen', () => {
  const rows = [
    { entry: { type: 'text', text: 'A' }, unlockAtPercent: 25 },
    { entry: { type: 'text', text: 'B' }, unlockAtPercent: 75 },
  ];
  const resolved = resolveRewardRowsWithUnlocks('q1', rows);
  assert.equal(resolved[0].unlockAtPercent, 25);
  assert.equal(resolved[1].unlockAtPercent, 75);
});

test('resolveRewardRowsWithUnlocks nutzt Auto-Plan bei fehlender Schwelle', () => {
  const rows = [
    { entry: { type: 'text', text: 'A' } },
    { entry: { type: 'text', text: 'B' } },
  ];
  const resolved = resolveRewardRowsWithUnlocks('q1', rows);
  // Muss 50 und 100 enthalten (in irgendeiner Reihenfolge)
  const percents = resolved.map((r) => r.unlockAtPercent).sort((a, b) => a - b);
  assert.deepStrictEqual(percents, [50, 100]);
});

// =============================================================================
// stringsToTextRewards
// =============================================================================

test('stringsToTextRewards konvertiert Strings zu Text-Entries', () => {
  const entries = stringsToTextRewards(['Hut', 'Schwert']);
  assert.deepStrictEqual(entries, [
    { type: 'text', text: 'Hut' },
    { type: 'text', text: 'Schwert' },
  ]);
});

test('stringsToTextRewards gibt leeres Array fuer leeren Input', () => {
  assert.deepStrictEqual(stringsToTextRewards([]), []);
});
