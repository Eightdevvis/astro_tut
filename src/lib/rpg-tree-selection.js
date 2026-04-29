import { findNodeById } from './rpg-quest-nodes.js';

/**
 * Liefert den View-Node und den nodeDone-Scope-Key fuer das Detail-Panel.
 *
 * Wichtig — keine ID-Spoofs: der View-Node behaelt SEINE eigene ID
 * (also die des Sub-Nodes wenn ausgewaehlt). Der `scopeQuestId`-Wert
 * wird separat zurueckgegeben — Aufrufer reichen ihn an
 * buildRewardDisplayList / RpgQuestNodesView weiter, damit die
 * nodeDone-Lookups korrekt unter der Root-Quest-ID stattfinden.
 *
 * @param {Map<string, import('./rpg-quests-data.js').RpgNode>} byId
 * @param {string | null} selectedId
 * @param {{ questId: string; nodeId: string | null } | null} selectedNode
 * @returns {{
 *   selectedQuest: import('./rpg-quests-data.js').RpgNode | null;
 *   selectedGraphNode: import('./rpg-quests-data.js').RpgNode | null;
 *   selectedNodeView: import('./rpg-quests-data.js').RpgNode | null;
 *   scopeQuestId: string;
 * }}
 */
export function deriveRpgTreeSelectionView(byId, selectedId, selectedNode) {
  const selectedQuest = selectedId ? byId.get(selectedId) : null;
  const selectedGraphNode =
    selectedQuest && selectedNode && selectedNode.questId === selectedQuest.id && selectedNode.nodeId
      ? findNodeById(selectedQuest.children || [], selectedNode.nodeId)
      : null;
  const selectedNodeView = selectedGraphNode || selectedQuest || null;
  return {
    selectedQuest,
    selectedGraphNode,
    selectedNodeView,
    scopeQuestId: selectedQuest?.id || '',
  };
}
