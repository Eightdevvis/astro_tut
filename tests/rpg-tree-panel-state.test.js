import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRpgTreePanelState,
  canToggleAddedForSelection,
} from '../src/lib/rpg-tree-panel-state.js';

test('deriveRpgTreePanelState disables add button when selection is locked', () => {
  const got = deriveRpgTreePanelState({
    selectedNodeContext: { id: 'q1' },
    selectedUnlocked: false,
    selectedCompleted: false,
    selectedAdded: false,
  });
  assert.equal(got.panelAddLabel, 'Add');
  assert.equal(got.addButtonDisabled, true);
  assert.equal(got.canEditSelected, true);
});

test('deriveRpgTreePanelState uses Weg label for added node', () => {
  const got = deriveRpgTreePanelState({
    selectedNodeContext: { id: 'q1' },
    selectedUnlocked: true,
    selectedCompleted: false,
    selectedAdded: true,
  });
  assert.equal(got.panelAddLabel, 'Weg');
  assert.equal(got.addButtonDisabled, false);
});

test('canToggleAddedForSelection only allows valid unlocked active selection', () => {
  assert.equal(
    canToggleAddedForSelection({
      selectedId: null,
      isSelectedKnown: false,
      isSelectedUnlocked: false,
      isSelectedCompleted: false,
    }),
    false
  );
  assert.equal(
    canToggleAddedForSelection({
      selectedId: 'q1',
      isSelectedKnown: true,
      isSelectedUnlocked: false,
      isSelectedCompleted: false,
    }),
    false
  );
  assert.equal(
    canToggleAddedForSelection({
      selectedId: 'q1',
      isSelectedKnown: true,
      isSelectedUnlocked: true,
      isSelectedCompleted: true,
    }),
    false
  );
  assert.equal(
    canToggleAddedForSelection({
      selectedId: 'q1',
      isSelectedKnown: true,
      isSelectedUnlocked: true,
      isSelectedCompleted: false,
    }),
    true
  );
});
