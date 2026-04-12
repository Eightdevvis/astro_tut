/**
 * Lokale Entwürfe für abgebrochene manuelle Quest-Erstellung (Browser localStorage).
 */

const STORAGE_KEY = 'rpg-quest-manual-drafts-v1';

/**
 * @typedef {{
 *   id: string;
 *   kind: 'main' | 'side';
 *   title: string;
 *   description: string;
 *   stepDrafts: import('./rpg-quest-editor-draft.js').QuestStepDraft[];
 *   rewardRows: import('./rpg-quest-editor-draft.js').QuestRewardDraftRow[];
 *   orderInLayer: number;
 *   prereqIds: string[];
 * }} ManualQuestDraftPayload
 */

/**
 * @typedef {{
 *   key: string;
 *   savedAt: string;
 *   payload: ManualQuestDraftPayload;
 * }} StoredManualQuestDraft
 */

/**
 * @returns {StoredManualQuestDraft[]}
 */
export function loadManualQuestDrafts() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x &&
        typeof x.key === 'string' &&
        typeof x.savedAt === 'string' &&
        x.payload &&
        typeof x.payload === 'object'
    );
  } catch {
    return [];
  }
}

/**
 * @param {StoredManualQuestDraft[]} list
 */
function persistManualQuestDrafts(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota oder private mode — still ignore
  }
}

/**
 * @param {ManualQuestDraftPayload} payload
 * @returns {string} key des neuen Eintrags
 */
export function addManualQuestDraft(payload) {
  const key =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const next = [{ key, savedAt: new Date().toISOString(), payload }, ...loadManualQuestDrafts()];
  persistManualQuestDrafts(next);
  return key;
}

/**
 * @param {string} key
 */
export function removeManualQuestDraft(key) {
  const next = loadManualQuestDrafts().filter((d) => d.key !== key);
  persistManualQuestDrafts(next);
}
