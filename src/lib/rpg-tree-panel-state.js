/**
 * @param {{
 *   selectedRootNode: { id: string } | null;
 *   selectedIsRootNode: boolean;
 *   selectedUnlocked: boolean;
 *   selectedCompleted: boolean;
 *   selectedAdded: boolean;
 }} input
 */
export function deriveRpgTreePanelState(input) {
  const selectedRootNode = input.selectedRootNode || null;
  const selectedIsRootNode = !!input.selectedIsRootNode;
  const selectedUnlocked = !!input.selectedUnlocked;
  const selectedCompleted = !!input.selectedCompleted;
  const selectedAdded = !!input.selectedAdded;
  const panelAddLabel = selectedAdded ? 'Weg' : 'Add';
  const addButtonDisabled = selectedCompleted || !selectedUnlocked;
  const canEditSelected = !!selectedRootNode && selectedIsRootNode;
  return {
    panelAddLabel,
    addButtonDisabled,
    canEditSelected,
    selectedCompleted,
  };
}

/**
 * @param {{
 *   selectedId: string | null;
 *   isSelectedKnown: boolean;
 *   isSelectedUnlocked: boolean;
 *   isSelectedCompleted: boolean;
 }} input
 */
export function canToggleAddedForSelection(input) {
  if (!input.selectedId) return false;
  if (!input.isSelectedKnown) return false;
  if (input.isSelectedCompleted) return false;
  if (!input.isSelectedUnlocked) return false;
  return true;
}
