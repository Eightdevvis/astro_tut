import {
  normalizeQuestStepsTree,
  flatLegacyStepsToNormalized,
  distributeQuestRewardPercents,
  normalizeQuestRewards,
} from './rpg-quest-steps.js';

/** @param {string} text */
export function linesToSteps(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label, i) => ({ id: `s-${i}`, label }));
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
 * @param {string[]} labels
 * @returns {{ id: string; label: string }[]}
 */
export function labelsToSteps(labels) {
  /** @type {{ id: string; label: string }[]} */
  const out = [];
  for (const raw of labels) {
    const label = String(raw).trim();
    if (!label) continue;
    out.push({ id: `s-${out.length}`, label });
  }
  return out;
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestStepNode[] | undefined} steps
 */
export function isSimpleFlatStepsForEditor(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return true;
  return steps.every(
    (s) =>
      !s?.substeps?.length &&
      !s?.optional &&
      !s?.reward &&
      !s?.timeDueAt &&
      (!s?.dependsOn || s.dependsOn.length === 0)
  );
}

/**
 * @param {import('./rpg-quest-steps.js').RpgQuestStepNode[]} steps
 */
export function serializeStepsToEditorText(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  if (isSimpleFlatStepsForEditor(steps)) {
    return steps.map((s) => s.label).join('\n');
  }
  return JSON.stringify(steps, null, 2);
}

/**
 * @param {string} text
 * @returns {import('./rpg-quest-steps.js').RpgQuestStepNode[]}
 */
export function parseStepsFromEditorText(text) {
  const t = text.trim();
  if (t.startsWith('[')) {
    const parsed = JSON.parse(t);
    if (!Array.isArray(parsed)) {
      throw new Error('Schritte: JSON muss ein Array sein.');
    }
    return normalizeQuestStepsTree(parsed);
  }
  const flat = linesToSteps(text);
  if (flat.length === 0) return [];
  return flatLegacyStepsToNormalized(flat);
}

/**
 * @param {import('./rpg-quests-data.js').RpgGraphQuest} quest
 */
export function serializeQuestRewardsToEditorText(quest) {
  if (Array.isArray(quest.questRewards) && quest.questRewards.length > 0) {
    return JSON.stringify(quest.questRewards, null, 2);
  }
  const legacy = quest.rewards;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy.join('\n');
  }
  return '';
}

/**
 * @param {string} text
 * @returns {import('./rpg-quest-steps.js').RpgQuestRewardEntry[]}
 */
export function parseQuestRewardsFromEditorText(text) {
  const t = text.trim();
  if (!t.startsWith('[')) {
    return distributeQuestRewardPercents(parseRewards(t));
  }
  const parsed = JSON.parse(t);
  return normalizeQuestRewards(parsed);
}
