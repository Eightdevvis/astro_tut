import {
  normalizeQuestNodesTree,
  flatLegacyNodesToNormalized,
} from './rpg-quest-nodes.js';
import {
  stringsToTextRewards,
  normalizeRewardEntries,
} from './rpg-quest-rewards.js';

/** @typedef {import('./rpg-quests-data.js').RpgNode} RpgNode */
/** @typedef {import('./rpg-quests-data.js').RpgRewardEntry} RpgRewardEntry */

/**
 * Text-Zeilen zu einfachen Node-Objekten (fuer den Editor).
 * @param {string} text
 */
export function linesToNodes(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((title, i) => ({ id: `s-${i}`, title }));
}

/** @param {string} text */
export function parseRewards(text) {
  return text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @param {string} raw */
export function normalizeQuestId(raw) {
  let x = raw.trim().toLowerCase().replace(/\s+/g, '-');
  x = x.replace(/[^a-z0-9-_]/g, '');
  return x.slice(0, 48);
}

/**
 * Labels/Titel zu Node-Objekten (fuer KI-Generierung).
 * @param {string[]} titles
 * @returns {{ id: string; title: string }[]}
 */
export function labelsToNodes(titles) {
  /** @type {{ id: string; title: string }[]} */
  const out = [];
  for (const raw of titles) {
    const title = String(raw).trim();
    if (!title) continue;
    out.push({ id: `s-${out.length}`, title });
  }
  return out;
}

/**
 * Prueft ob Nodes einfach genug sind fuer den Textfeld-Editor (keine Verschachtelung, keine Features).
 * @param {RpgNode[] | undefined} nodes
 */
export function isSimpleFlatNodesForEditor(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return true;
  return nodes.every(
    (s) =>
      !s?.children?.length &&
      !s?.optional &&
      !(s?.rewards?.length) &&
      !s?.timeDueAt &&
      (!s?.dependsOn || s.dependsOn.length === 0)
  );
}

/**
 * Serialisiert Nodes fuer den Editor (Textfeld oder JSON).
 * @param {RpgNode[]} nodes
 */
export function serializeNodesToEditorText(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '';
  if (isSimpleFlatNodesForEditor(nodes)) {
    return nodes.map((s) => s.title).join('\n');
  }
  return JSON.stringify(nodes, null, 2);
}

/**
 * Parst Nodes aus dem Editor-Textfeld.
 * @param {string} text
 * @returns {RpgNode[]}
 */
export function parseNodesFromEditorText(text) {
  const t = text.trim();
  if (t.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(t);
    } catch {
      throw new Error('Schritte: Ungültiges JSON — Syntax prüfen.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Schritte: JSON muss ein Array sein.');
    }
    return normalizeQuestNodesTree(parsed);
  }
  const flat = linesToNodes(text);
  if (flat.length === 0) return [];
  return flatLegacyNodesToNormalized(flat);
}

/**
 * Serialisiert Rewards eines Nodes fuer den Editor.
 * @param {RpgNode | Record<string, any>} node
 */
export function serializeQuestRewardsToEditorText(node) {
  const n = /** @type {any} */ (node);
  // Neues Format bevorzugt
  if (Array.isArray(n.rewards) && n.rewards.length > 0) {
    return JSON.stringify(n.rewards, null, 2);
  }
  // Legacy: questRewards[]
  if (Array.isArray(n.questRewards) && n.questRewards.length > 0) {
    return JSON.stringify(n.questRewards, null, 2);
  }
  return '';
}

/**
 * Parst Rewards aus dem Editor-Textfeld.
 * @param {string} text
 * @returns {RpgRewardEntry[]}
 */
export function parseQuestRewardsFromEditorText(text) {
  const t = text.trim();
  if (!t.startsWith('[')) {
    return stringsToTextRewards(parseRewards(t));
  }
  let parsed;
  try {
    parsed = JSON.parse(t);
  } catch {
    throw new Error('Belohnungen: Ungültiges JSON — Syntax prüfen.');
  }
  return normalizeRewardEntries(parsed);
}
