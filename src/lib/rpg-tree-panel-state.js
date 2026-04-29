/**
 * Leitet UI-State fuer das Quest-Panel ab.
 *
 * `canEditSelected` ist tiefenagnostisch: der Editor unterstuetzt
 * Root- UND Sub-Node-Edit ueber denselben Pfad (siehe
 * applyNodeFieldsUpdate in rpg-graph-editor-ops.js). Solange eine
 * Quest selektiert ist (selectedNodeContext != null), ist Editieren
 * erlaubt — egal ob die konkrete Auswahl die Root-Quest selbst oder
 * ein Sub-Node innerhalb dieser Quest ist. Der Aufrufer baut dann
 * eine Composite-ID `${rootId}::${subId}` fuer den Editor.
 *
 * @param {{
 *   selectedNodeContext: { id: string } | null;
 *   selectedUnlocked: boolean;
 *   selectedCompleted: boolean;
 *   selectedAdded: boolean;
 }} input
 */
export function deriveRpgTreePanelState(input) {
  const selectedNodeContext = input.selectedNodeContext || null;
  const selectedUnlocked = !!input.selectedUnlocked;
  const selectedCompleted = !!input.selectedCompleted;
  const selectedAdded = !!input.selectedAdded;
  const panelAddLabel = selectedAdded ? 'Weg' : 'Add';
  const addButtonDisabled = selectedCompleted || !selectedUnlocked;
  const canEditSelected = !!selectedNodeContext;
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
