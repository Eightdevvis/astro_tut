/**
 * Lokale Entwürfe für abgebrochene manuelle Quest-Erstellung (Browser localStorage).
 */

const STORAGE_KEY = 'rpg-quest-manual-drafts-v1';
const IN_PROGRESS_STORAGE_KEY = 'rpg-quest-manual-draft-in-progress-v1';

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   nodeDrafts: import('./rpg-quest-editor-draft.js').QuestNodeDraft[];
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

/**
 * @returns {{ savedAt: string; payload: ManualQuestDraftPayload } | null}
 */
export function loadManualQuestInProgressDraft() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(IN_PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'string' || !parsed.payload || typeof parsed.payload !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {ManualQuestDraftPayload} payload
 */
export function saveManualQuestInProgressDraft(payload) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      IN_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        payload,
      })
    );
  } catch {
    // Quota oder private mode — still ignore
  }
}

export function clearManualQuestInProgressDraft() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(IN_PROGRESS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
