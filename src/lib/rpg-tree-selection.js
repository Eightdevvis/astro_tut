import { findNodeById } from './rpg-quest-nodes.js';

/**
 * @param {Map<string, import('./rpg-quests-data.js').RpgNode>} byId
 * @param {string | null} selectedId
 * @param {{ questId: string; nodeId: string | null } | null} selectedNode
 */
export function deriveRpgTreeSelectionView(byId, selectedId, selectedNode) {
  const selectedQuest = selectedId ? byId.get(selectedId) : null;
  const selectedGraphNode =
    selectedQuest && selectedNode && selectedNode.questId === selectedQuest.id && selectedNode.nodeId
      ? findNodeById(selectedQuest.children || [], selectedNode.nodeId)
      : null;
  const selectedNodeView = selectedGraphNode
    ? {
        id: `${selectedQuest.id}::${selectedGraphNode.id}`,
        title: selectedGraphNode.title || selectedGraphNode.id,
        description: selectedGraphNode.description || '',
        children: selectedGraphNode.children || [],
        rewards: [],
      }
    : selectedQuest
      ? {
          id: selectedQuest.id,
          title: selectedQuest.title,
          description: selectedQuest.description || '',
          children: selectedQuest.children || [],
          rewards: selectedQuest.rewards || [],
        }
      : null;
  return { selectedQuest, selectedGraphNode, selectedNodeView };
}
