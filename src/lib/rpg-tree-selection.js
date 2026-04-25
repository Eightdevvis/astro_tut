import { findNodeById } from './rpg-quest-nodes.js';

/**
 * @param {Map<string, import('./rpg-quests-data.js').RpgGraphNode>} byId
 * @param {string | null} selectedId
 * @param {{ questId: string; nodeId: string | null } | null} selectedNode
 */
export function deriveRpgTreeSelectionView(byId, selectedId, selectedNode) {
  const selectedRootNode = selectedId ? byId.get(selectedId) : null;
  const selectedTreeNode =
    selectedRootNode && selectedNode && selectedNode.questId === selectedRootNode.id && selectedNode.nodeId
      ? findNodeById(selectedRootNode.children || [], selectedNode.nodeId)
      : null;
  const selectedNodeView = selectedTreeNode
    ? {
        id: `${selectedRootNode.id}::${selectedTreeNode.id}`,
        title: selectedTreeNode.label || selectedTreeNode.id,
        description: '',
        children: selectedTreeNode.children || [],
        questRewards: [],
      }
    : selectedRootNode
      ? {
          id: selectedRootNode.id,
          title: selectedRootNode.title,
          description: selectedRootNode.description || '',
          children: selectedRootNode.children || [],
          questRewards: selectedRootNode.questRewards || [],
        }
      : null;
  const selectedNodeJson = selectedTreeNode
    ? JSON.stringify(selectedTreeNode, null, 2)
    : selectedRootNode
      ? JSON.stringify(selectedRootNode, null, 2)
      : '';
  const selectedIsRootNode = !!selectedRootNode && !selectedTreeNode;
  return { selectedRootNode, selectedTreeNode, selectedNodeView, selectedNodeJson, selectedIsRootNode };
}
